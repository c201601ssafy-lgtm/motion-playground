"""AI 튜터 도구 (D-007).

LLM은 이 도구들로만 상태를 조회·변경한다. 모든 값은 AssemblyEngine과 모델 데이터에서 나온다.
입력·출력은 Pydantic으로 검증하고, JSON Schema는 schemas/tool-calls.schema.json 으로 내보낸다.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.ai.types import ToolSpec
from app.assembly.engine import AssemblyEngine
from app.assembly.schemas import AssemblyState, ErrorType, MechanismState
from app.core.db import SessionStore
from app.core.korean import josa
from app.core.model_loader import get_model
from app.core.model_schema import MechanismModel


@dataclass
class ToolContext:
    session_id: str
    store: SessionStore
    model_id: str = "gearbox"
    actions: list[dict[str, Any]] = field(default_factory=list)

    @property
    def model(self) -> MechanismModel:
        return get_model(self.model_id)

    def engine(self) -> AssemblyEngine:
        model_id, state = self.store.get(self.session_id)
        self.model_id = model_id
        return AssemblyEngine(get_model(model_id), state)


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Out(BaseModel):
    pass


# ---------- 입력 ----------


class NoArgs(_In):
    pass


class PartIdIn(_In):
    part_id: str = Field(description="부품 ID")


class RpmIn(_In):
    input_rpm: float = Field(
        default=30.0,
        ge=-600,
        le=600,
        description="입력축 회전 속도 (rpm). 사용자가 값을 말하지 않았으면 30을 쓴다.",
    )


# ---------- 출력 ----------


class PartInfoOut(_Out):
    part_id: str
    name: str
    kind: str
    step: int
    teeth: int | None
    description: str
    function: str
    sits_on: str | None = Field(description="이 부품을 받치는 부품 이름")
    meshes_with: list[str] = Field(description="맞물리는 기어 이름")
    is_placed: bool


class AssemblyStateOut(_Out):
    completed_steps: list[int]
    current_step: int | None
    current_step_title: str | None
    parts_placed: int
    parts_total: int
    is_complete: bool
    placed_parts: list[str]
    remaining_parts: list[str]


class AssemblyErrorOut(_Out):
    has_error: bool
    error_type: ErrorType | None = None
    part_id: str | None = None
    part_name: str | None = None
    target_slot: str | None = None
    message: str | None = None
    expected_rotation: float | None = None
    current_rotation: float | None = None
    axis_angle_deg: float | None = None
    missing_parts: list[str] = Field(default_factory=list)
    hint: str | None = None


class GearOut(_Out):
    part_id: str
    name: str
    teeth: int
    direction: int
    direction_label: str
    speed_ratio: float
    rpm: float


class MechanismOut(_Out):
    operable: bool
    reasons: list[str]
    input_rpm: float
    reduction_ratio: float | None
    gears: list[GearOut]


class SimulationOut(_Out):
    started: bool
    input_rpm: float
    operable: bool
    reasons: list[str]
    reduction_ratio: float | None
    gears: list[GearOut] = Field(description="시각화에 쓰인 기어별 회전 방향과 rpm")


class ResetOut(_Out):
    removed: list[str]
    current_step: int | None


# ---------- 구현 ----------


def _name(model: MechanismModel, part_id: str | None) -> str | None:
    p = model.part(part_id or "")
    return p.name if p else part_id


def get_part_info(ctx: ToolContext, inp: PartIdIn) -> PartInfoOut:
    engine = ctx.engine()
    model = engine.model
    part = model.part(inp.part_id)
    if part is None:
        raise ValueError(f"알 수 없는 part_id: {inp.part_id}")
    slot = model.slot_for_part(part.part_id)
    meshes = []
    for sid in slot.meshes_with if slot else []:
        other = model.slot(sid)
        if other:
            meshes.append(_name(model, other.accepts_part_id) or other.accepts_part_id)
    return PartInfoOut(
        part_id=part.part_id,
        name=part.name,
        kind=part.kind,
        step=part.step,
        teeth=part.teeth,
        description=part.description,
        function=part.function,
        sits_on=_name(model, slot.parent_part_id) if slot and slot.parent_part_id else None,
        meshes_with=meshes,
        is_placed=engine.is_placed(part.part_id),
    )


def get_assembly_state(ctx: ToolContext, _: NoArgs) -> AssemblyStateOut:
    engine = ctx.engine()
    snap = engine.snapshot()
    model = engine.model
    step = next((s for s in model.steps if s.step == snap.current_step), None)
    placed = set(snap.placed.values())
    return AssemblyStateOut(
        completed_steps=snap.completed_steps,
        current_step=snap.current_step,
        current_step_title=step.title if step else None,
        parts_placed=snap.parts_placed,
        parts_total=snap.parts_total,
        is_complete=snap.is_complete,
        placed_parts=[p.name for p in model.parts if p.part_id in placed],
        remaining_parts=[p.name for p in model.parts if p.part_id not in placed],
    )


def _hint(model: MechanismModel, e: AssemblyErrorOut) -> str | None:
    missing = ", ".join(e.missing_parts)
    match e.error_type:
        case ErrorType.MISSING_PARENT | ErrorType.WRONG_ORDER:
            return f"{josa(missing, '을/를')} 먼저 조립한 뒤 다시 놓으세요." if missing else None
        case ErrorType.WRONG_SLOT:
            own = model.slot_for_part(e.part_id or "")
            return f"{e.part_name}의 자리는 {own.slot_id}입니다." if own else None
        case ErrorType.SLOT_OCCUPIED:
            return "이미 다른 부품이 있는 자리입니다. 비어 있는 자기 자리를 찾으세요."
        case ErrorType.WRONG_ORIENTATION:
            if e.expected_rotation is not None:
                return f"부품을 {e.expected_rotation:g}° 방향으로 돌려서 놓으세요 (마우스 휠 또는 [ ] 키)."
            return "부품을 똑바로 세워서 놓으세요."
        case ErrorType.ALREADY_PLACED:
            return "이미 조립된 부품입니다. 다른 부품을 놓으세요."
        case _:
            return None


def get_assembly_error(ctx: ToolContext, _: NoArgs) -> AssemblyErrorOut:
    engine = ctx.engine()
    r = engine.state.last_error
    if r is None:
        return AssemblyErrorOut(has_error=False)
    model = engine.model
    out = AssemblyErrorOut(
        has_error=True,
        error_type=r.error_type,
        part_id=r.part_id,
        part_name=_name(model, r.part_id),
        target_slot=r.target_slot,
        message=r.message,
        expected_rotation=r.expected_rotation,
        current_rotation=r.current_rotation,
        axis_angle_deg=r.axis_angle_deg,
        missing_parts=[_name(model, pid) or pid for pid in r.missing_part_ids],
    )
    out.hint = _hint(model, out)
    return out


def _direction_label(rpm: float) -> str:
    if rpm == 0:
        return "정지"
    return "반시계(위에서 볼 때)" if rpm > 0 else "시계(위에서 볼 때)"


def get_mechanism_state(ctx: ToolContext, inp: RpmIn) -> MechanismOut:
    engine = ctx.engine()
    m = engine.mechanism_state(inp.input_rpm)
    return MechanismOut(
        operable=m.operable,
        reasons=m.reasons,
        input_rpm=m.input_rpm,
        reduction_ratio=m.reduction_ratio,
        gears=_gears(engine, m),
    )


def _gears(engine: AssemblyEngine, m: MechanismState) -> list[GearOut]:
    return [
        GearOut(
            part_id=g.part_id,
            name=_name(engine.model, g.part_id) or g.part_id,
            teeth=g.teeth,
            direction=g.direction,
            direction_label=_direction_label(g.rpm),
            speed_ratio=g.speed_ratio,
            rpm=g.rpm,
        )
        for g in m.gears
    ]


def run_visual_simulation(ctx: ToolContext, inp: RpmIn) -> SimulationOut:
    engine = ctx.engine()
    m = engine.mechanism_state(inp.input_rpm)
    if m.operable:
        ctx.actions.append({"type": "run_simulation", "input_rpm": inp.input_rpm})
    # 답변에 감속비·rpm을 쓸 수 있도록 계산 결과도 함께 돌려준다 (E-01: 미근거 숫자 방지)
    return SimulationOut(
        started=m.operable,
        input_rpm=inp.input_rpm,
        operable=m.operable,
        reasons=m.reasons,
        reduction_ratio=m.reduction_ratio,
        gears=_gears(engine, m),
    )


def reset_assembly_step(ctx: ToolContext, _: NoArgs) -> ResetOut:
    def run(model_id: str, state: AssemblyState) -> ResetOut:
        engine = AssemblyEngine(get_model(model_id), state)
        removed = engine.reset_step()
        return ResetOut(
            removed=[_name(engine.model, pid) or pid for pid in removed],
            current_step=engine.current_step(),
        )

    out = ctx.store.update(ctx.session_id, run)
    ctx.store.log_event(ctx.session_id, "reset_step", {"removed": out.removed, "by": "tutor"})
    ctx.actions.append({"type": "assembly_changed"})
    return out


# ---------- 레지스트리 ----------


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_model: type[_In]
    output_model: type[_Out]
    fn: Callable[[ToolContext, Any], _Out]
    mutates: bool = False


TOOLS: dict[str, Tool] = {
    t.name: t
    for t in [
        Tool(
            "get_part_info",
            "부품의 이름, 기능, 이빨 수, 받침 부품, 맞물리는 기어를 조회한다.",
            PartIdIn,
            PartInfoOut,
            get_part_info,
        ),
        Tool(
            "get_assembly_state",
            "현재 조립 진행 상황(완료 단계, 현재 단계, 조립된 부품)을 조회한다.",
            NoArgs,
            AssemblyStateOut,
            get_assembly_state,
        ),
        Tool(
            "get_assembly_error",
            "규칙 엔진이 판정한 마지막 조립 오류와 수정 힌트를 조회한다.",
            NoArgs,
            AssemblyErrorOut,
            get_assembly_error,
        ),
        Tool(
            "get_mechanism_state",
            (
                "조립된 기어의 작동 가능 여부, 감속비, 기어별 회전 방향과 rpm을 계산 결과로 조회한다. "
                "값을 묻는 질문용이다. 화면에서 돌려 달라는 요청은 run_visual_simulation을 쓴다."
            ),
            RpmIn,
            MechanismOut,
            get_mechanism_state,
        ),
        Tool(
            "run_visual_simulation",
            (
                "작동 모드 화면에서 기어 회전 시각화를 실행한다 (교육용 시각화). "
                "'45rpm으로 돌려 봐', '작동시켜 줘', '돌아가는 거 보여 줘'처럼 "
                "기어를 실제로 돌려 달라는 요청이면 이 도구를 호출한다."
            ),
            RpmIn,
            SimulationOut,
            run_visual_simulation,
        ),
        Tool(
            "reset_assembly_step",
            "현재 조립 단계의 부품을 작업대로 되돌린다.",
            NoArgs,
            ResetOut,
            reset_assembly_step,
            mutates=True,
        ),
    ]
}

ToolName = Literal[
    "get_part_info",
    "get_assembly_state",
    "get_assembly_error",
    "get_mechanism_state",
    "run_visual_simulation",
    "reset_assembly_step",
]


def tool_specs(model: MechanismModel | None = None) -> list[ToolSpec]:
    """LLM에 줄 도구 정의. part_id에는 실제 부품 ID enum을 넣는다."""
    specs = []
    for t in TOOLS.values():
        params = t.input_model.model_json_schema()
        params.pop("title", None)
        if model is not None and "part_id" in params.get("properties", {}):
            params["properties"]["part_id"]["enum"] = [p.part_id for p in model.parts]
            params["properties"]["part_id"]["description"] = "부품 ID: " + ", ".join(
                f"{p.part_id}({p.name})" for p in model.parts
            )
        specs.append(ToolSpec(name=t.name, description=t.description, parameters=params))
    return specs


def execute(name: str, args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    """도구 실행. 실패해도 예외 대신 {"error": ...}를 돌려 LLM이 스스로 고칠 수 있게 한다."""
    tool = TOOLS.get(name)
    if tool is None:
        return {"error": f"존재하지 않는 도구: {name}. 사용 가능: {', '.join(TOOLS)}"}
    try:
        inp = tool.input_model.model_validate(args or {})
    except ValidationError as err:
        return {"error": f"잘못된 인자: {err.errors(include_url=False)}"}
    try:
        out = tool.fn(ctx, inp)
    except ValueError as err:
        return {"error": str(err)}
    return tool.output_model.model_validate(out.model_dump()).model_dump(mode="json")
