"""규칙 기반 Mock LLM. CI·데모 백업용.

1) 사용자 질문 → 키워드로 도구 선택 (도구 호출 응답)
2) 도구 결과 → 템플릿 답변 (모든 숫자는 도구 결과에서만 가져온다)
"""

import json
import re
from typing import Any

from app.ai.types import LLMResponse, Message, ToolCall, ToolSpec

# 질문 속 표현 → part_id. 위에서부터 먼저 맞는 것을 쓴다 (축이 기어보다 먼저).
PART_ALIASES: list[tuple[str, str]] = [
    (r"입력\s*축", "shaft-input"),
    (r"아이들러\s*축", "shaft-idler"),
    (r"출력\s*축", "shaft-output"),
    (r"작은\s*기어|12\s*T|입력\s*기어", "gear-input-12t"),
    (r"아이들러|중간\s*기어|24\s*T", "gear-idler-24t"),
    (r"큰\s*기어|36\s*T|출력\s*기어", "gear-output-36t"),
    (r"베이스|바닥\s*판", "base-plate"),
    (r"커버|덮개", "top-cover"),
]

RE_ERROR = re.compile(
    r"왜.*(안\s*되|안\s*돼|작동하지|안\s*돌|틀렸|실패)|잘못|틀렸|오류|에러|뭘\s*잘못"
)
RE_MECH = re.compile(r"반대|방향|기어\s*비|감속|속도|rpm|빨라|느려|토크|돌아")
RE_SIM = re.compile(r"돌려\s*(봐|줘)|시뮬레이션|작동시켜|움직여\s*(봐|줘)")
RE_RESET = re.compile(r"되돌|리셋|다시\s*(해|하|할|시작)|초기화")
RE_STATE = re.compile(r"진행|몇\s*단계|어디까지|다음\s*(은|에|뭐)|남은")
RE_PART_Q = re.compile(r"역할|무슨|뭐야|뭐예요|기능|하는\s*일|왜\s*필요|설명")
RE_RPM = re.compile(r"(-?\d+(?:\.\d+)?)\s*rpm", re.IGNORECASE)


def resolve_part(text: str) -> str | None:
    for pattern, part_id in PART_ALIASES:
        if re.search(pattern, text, re.IGNORECASE):
            return part_id
    return None


def route(question: str, selected_part: str | None = None) -> list[ToolCall]:
    """질문 → 호출할 도구 목록 (Mock의 '추론')."""
    q = question.strip()
    part = resolve_part(q) or selected_part
    rpm_m = RE_RPM.search(q)
    rpm = float(rpm_m.group(1)) if rpm_m else 30.0
    if RE_RESET.search(q):
        return [ToolCall(name="reset_assembly_step")]
    if RE_SIM.search(q):
        return [ToolCall(name="run_visual_simulation", arguments={"input_rpm": rpm})]
    if RE_ERROR.search(q):
        return [ToolCall(name="get_assembly_error"), ToolCall(name="get_assembly_state")]
    if RE_MECH.search(q):
        calls = [ToolCall(name="get_mechanism_state", arguments={"input_rpm": rpm})]
        if part and resolve_part(q):
            calls.insert(0, ToolCall(name="get_part_info", arguments={"part_id": part}))
        return calls
    if RE_STATE.search(q):
        return [ToolCall(name="get_assembly_state")]
    if part and (RE_PART_Q.search(q) or resolve_part(q)):
        return [ToolCall(name="get_part_info", arguments={"part_id": part})]
    if part:
        return [ToolCall(name="get_part_info", arguments={"part_id": part})]
    return [ToolCall(name="get_assembly_state")]


def _fmt(v: Any) -> str:
    if isinstance(v, float):
        return f"{v:g}"
    return str(v)


def _answer_part(r: dict) -> str:
    s = f"{r['name']}: {r['description']} {r['function']}"
    if r.get("teeth"):
        s += f" 이빨은 {r['teeth']}개입니다."
    if r.get("meshes_with"):
        s += f" {', '.join(r['meshes_with'])}와(과) 맞물립니다."
    return s


def _answer_error(r: dict) -> str:
    if not r.get("has_error"):
        return "지금은 판정된 조립 오류가 없습니다."
    s = f"{r['part_name']}: {r['message']}"
    if r.get("expected_rotation") is not None and r.get("current_rotation") is not None:
        s += f" (기대 방향 {_fmt(r['expected_rotation'])}°, 현재 {_fmt(r['current_rotation'])}°)"
    if r.get("hint"):
        s += f" {r['hint']}"
    return s


def _answer_mechanism(r: dict) -> str:
    if not r.get("operable"):
        return "아직 작동할 수 없습니다: " + ", ".join(r.get("reasons", [])) + "."
    gears = r.get("gears", [])
    parts = [f"{g['name']} {_fmt(abs(g['rpm']))}rpm {g['direction_label']}" for g in gears]
    return (
        f"입력 {_fmt(r['input_rpm'])}rpm일 때 " + ", ".join(parts) + ". "
        "맞물린 두 기어는 접점에서 이빨이 서로 밀어 주기 때문에 반대 방향으로 돕니다. "
        f"전체 감속비는 {_fmt(r['reduction_ratio'])}:1이라 출력은 입력보다 느리게 돌고, "
        "손실이 없다면 그만큼 토크가 커집니다."
    )


def _answer_state(r: dict) -> str:
    if r.get("is_complete"):
        return f"모든 부품({r['parts_placed']}/{r['parts_total']})을 조립했습니다. 작동 모드에서 돌려 보세요."
    return (
        f"{len(r.get('completed_steps', []))}개 단계를 마쳤고 부품은 {r['parts_placed']}/{r['parts_total']}개 조립했습니다. "
        f"지금은 {r['current_step']}단계({r.get('current_step_title', '')})입니다."
    )


def _answer_sim(r: dict) -> str:
    if not r.get("operable"):
        return "작동 시뮬레이션을 할 수 없습니다: " + ", ".join(r.get("reasons", [])) + "."
    return f"입력축을 {_fmt(r['input_rpm'])}rpm으로 돌리는 작동 화면을 실행했습니다."


def _answer_reset(r: dict) -> str:
    removed = r.get("removed", [])
    if not removed:
        return "되돌릴 부품이 없습니다."
    return f"{', '.join(removed)}을(를) 작업대로 되돌렸습니다. 지금은 {r.get('current_step')}단계입니다."


ANSWERERS = {
    "get_part_info": _answer_part,
    "get_assembly_error": _answer_error,
    "get_mechanism_state": _answer_mechanism,
    "get_assembly_state": _answer_state,
    "run_visual_simulation": _answer_sim,
    "reset_assembly_step": _answer_reset,
}


class MockAdapter:
    name = "mock"
    model = "mock-rules-v1"

    def chat(self, messages: list[Message], tools: list[ToolSpec]) -> LLMResponse:
        last_user = max((i for i, m in enumerate(messages) if m.role == "user"), default=-1)
        tool_msgs = [m for m in messages[last_user + 1 :] if m.role == "tool"]
        if not tool_msgs:
            question = messages[last_user].content if last_user >= 0 else ""
            selected = None
            for m in messages:
                if m.role == "system":
                    found = re.search(r'"selected_part":\s*"([^"]+)"', m.content)
                    selected = found.group(1) if found else selected
            available = {t.name for t in tools}
            calls = [c for c in route(question, selected) if c.name in available]
            return LLMResponse(tool_calls=calls, model=self.model)

        lines: list[str] = []
        error_shown = False
        for m in tool_msgs:
            try:
                data = json.loads(m.content)
            except json.JSONDecodeError:
                continue
            if "error" in data:
                lines.append(f"도구 실행 오류: {data['error']}")
                continue
            if m.tool_name == "get_assembly_error":
                error_shown = bool(data.get("has_error"))
            if m.tool_name == "get_assembly_state" and error_shown:
                continue  # 오류 설명이 있으면 진행 상황은 생략
            fn = ANSWERERS.get(m.tool_name or "")
            if fn:
                lines.append(fn(data))
        return LLMResponse(
            content=" ".join(lines) or "답할 수 있는 정보가 없습니다.", model=self.model
        )
