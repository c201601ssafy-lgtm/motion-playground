"""AI 엔지니어링 튜터 (spec §12–13, D-007).

LLM에는 구조화된 컨텍스트만 주고, 사실·수치는 도구 호출로만 얻게 한다.
최종 답변 속 숫자가 도구 결과·질문에 없으면 UNGROUNDED_NUMBER 경고를 단다.
"""

import json
import re
import time
from typing import Any

from pydantic import BaseModel, Field

from app.ai.provider import FallbackAdapter
from app.ai.types import LLMAdapter, Message
from app.tools.registry import TOOLS, ToolContext, execute, tool_specs

MAX_TOOL_ROUNDS = 4

SYSTEM_PROMPT = """너는 HoloForge AI Lab의 공학 튜터다. 학습자는 3D 기어박스를 손동작으로 조립하고 있다.

규칙:
1. 부품·조립 상태·오류·회전 방향·rpm·기어비 같은 사실과 숫자는 반드시 도구로 조회한 값만 쓴다. 숫자를 추측하거나 새로 계산하지 마라.
2. 답하기 전에 반드시 알맞은 도구를 먼저 호출하라. 부품 질문은 get_part_info, 진행 상황은 get_assembly_state,
   오류는 get_assembly_error, 회전·속도·기어비는 get_mechanism_state 를 쓴다. 필요하면 여러 도구를 호출해도 된다.
3. 한국어로 2~4문장, 중고등학생도 이해할 수 있게 설명한다. 공학 용어는 짧게 풀어 쓴다.
4. 조립 오류를 설명할 때는 원인과 고치는 방법을 함께 말한다.
5. 도구로 알 수 없는 것은 모른다고 말한다. 실제 응력·안전·제조 판단은 하지 않는다(교육용 시뮬레이션).

현재 상황(JSON):
{context}"""

FINALIZE_PROMPT = "도구는 더 쓸 수 없다. 지금까지 받은 도구 결과만으로 질문에 답하라."
REQUIRE_TOOL_PROMPT = "아직 도구로 확인하지 않았다. 답하기 전에 알맞은 도구를 먼저 호출하라."

RE_THINK = re.compile(r"<think>.*?</think>", re.DOTALL)
RE_NUMBER = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?")
ALWAYS_ALLOWED = {0.0, 1.0}


class UsedTool(BaseModel):
    name: str
    arguments: dict[str, Any]
    result: dict[str, Any]


class TutorRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    selected_part: str | None = Field(default=None, max_length=64)


class TutorResponse(BaseModel):
    answer: str
    used_tools: list[UsedTool]
    cited_values: list[float] = Field(description="답변 속 숫자 중 도구 결과로 확인된 값")
    warnings: list[str]
    actions: list[dict[str, Any]]
    degraded: bool
    provider: str
    rounds: int
    latency_ms: float


def build_context(ctx: ToolContext, selected_part: str | None) -> dict[str, Any]:
    """spec §12 구조화 컨텍스트. 전체 상태를 덤프하지 않는다."""
    engine = ctx.engine()
    snap = engine.snapshot()
    err = engine.state.last_error
    if snap.is_complete:
        state = "complete"
    elif err is not None:
        state = "invalid"
    else:
        state = "in_progress"
    return {
        "selected_part": selected_part if engine.model.part(selected_part or "") else None,
        "assembly_state": state,
        "detected_error": err.error_type.value if err and err.error_type else None,
        "completed_steps": snap.completed_steps,
        "current_step": snap.current_step,
        "available_tools": list(TOOLS),
    }


def _numbers(value: Any) -> set[float]:
    """JSON 값 안의 모든 숫자 (문자열 속 숫자 포함)."""
    out: set[float] = set()
    if isinstance(value, bool):
        return out
    if isinstance(value, int | float):
        out.add(round(float(value), 2))
    elif isinstance(value, str):
        out |= {round(float(m), 2) for m in RE_NUMBER.findall(value)}
    elif isinstance(value, dict):
        for v in value.values():
            out |= _numbers(v)
    elif isinstance(value, list):
        for v in value:
            out |= _numbers(v)
    return out


def grounding(answer: str, used: list[UsedTool], question: str) -> tuple[list[float], list[float]]:
    """(근거 있는 숫자, 근거 없는 숫자)."""
    allowed = ALWAYS_ALLOWED | _numbers(question)
    for u in used:
        allowed |= _numbers(u.result) | _numbers(u.arguments)
    allowed |= {abs(v) for v in allowed}
    cited, ungrounded = [], []
    for raw in RE_NUMBER.findall(answer):
        v = round(float(raw), 2)
        (cited if v in allowed or abs(v) in allowed else ungrounded).append(v)
    return sorted(set(cited)), sorted(set(ungrounded))


def answer(
    req: TutorRequest, ctx: ToolContext, adapter: LLMAdapter | FallbackAdapter
) -> TutorResponse:
    t0 = time.perf_counter()
    context = build_context(ctx, req.selected_part)
    specs = tool_specs(ctx.model)
    messages = [
        Message(
            role="system",
            content=SYSTEM_PROMPT.format(context=json.dumps(context, ensure_ascii=False)),
        ),
        Message(role="user", content=req.question),
    ]
    used: list[UsedTool] = []
    final: str | None = None
    rounds = 0
    nudged = False
    while rounds < MAX_TOOL_ROUNDS:
        rounds += 1
        resp = adapter.chat(messages, specs)
        if not resp.tool_calls:
            if not used and not nudged:
                # 도구 없이 답하려 하면 한 번 되묻는다 (사실 확인 강제, docs/experiments.md E-01)
                nudged = True
                messages.append(Message(role="assistant", content=resp.content))
                messages.append(Message(role="user", content=REQUIRE_TOOL_PROMPT))
                continue
            final = resp.content
            break
        messages.append(Message(role="assistant", content=resp.content, tool_calls=resp.tool_calls))
        for call in resp.tool_calls:
            result = execute(call.name, call.arguments, ctx)
            used.append(UsedTool(name=call.name, arguments=call.arguments, result=result))
            messages.append(
                Message(
                    role="tool",
                    tool_name=call.name,
                    content=json.dumps(result, ensure_ascii=False),
                )
            )
    if final is None:
        messages.append(Message(role="user", content=FINALIZE_PROMPT))
        final = adapter.chat(messages, []).content

    text = RE_THINK.sub("", final or "").strip() or "답변을 만들지 못했습니다."
    cited, ungrounded = grounding(text, used, req.question)
    warnings: list[str] = []
    if not used:
        warnings.append("NO_TOOLS_USED")
    if ungrounded:
        warnings.append("UNGROUNDED_NUMBER:" + ",".join(f"{v:g}" for v in ungrounded))
    if any("error" in u.result for u in used):
        warnings.append("TOOL_ERROR")
    return TutorResponse(
        answer=text,
        used_tools=used,
        cited_values=cited,
        warnings=warnings,
        actions=ctx.actions,
        degraded=bool(getattr(adapter, "degraded", False)),
        provider=adapter.name,
        rounds=rounds,
        latency_ms=round((time.perf_counter() - t0) * 1000, 1),
    )
