from enum import StrEnum

from pydantic import BaseModel, Field

from app.core.model_schema import Vec3


class ErrorType(StrEnum):
    UNKNOWN_PART = "UNKNOWN_PART"
    ALREADY_PLACED = "ALREADY_PLACED"
    TOO_FAR = "TOO_FAR"
    WRONG_SLOT = "WRONG_SLOT"
    SLOT_OCCUPIED = "SLOT_OCCUPIED"
    MISSING_PARENT = "MISSING_PARENT"
    WRONG_ORDER = "WRONG_ORDER"
    WRONG_ORIENTATION = "WRONG_ORIENTATION"


class AttemptRequest(BaseModel):
    """부품을 놓은 순간의 자세."""

    part_id: str
    position: Vec3
    axis: Vec3 = (0.0, 1.0, 0.0)
    yaw_deg: float = 0.0


class AssemblyResult(BaseModel):
    is_valid: bool
    part_id: str
    target_slot: str | None = None
    error_type: ErrorType | None = None
    message: str
    distance: float | None = None
    expected_rotation: float | None = None
    current_rotation: float | None = None
    axis_angle_deg: float | None = None
    snapped_position: Vec3 | None = None
    missing_part_ids: list[str] = Field(default_factory=list)
    step_completed: int | None = None
    assembly_complete: bool = False


class AssemblyState(BaseModel):
    """세션에 저장되는 엔진 상태."""

    placed: dict[str, str] = Field(default_factory=dict)  # slot_id → part_id
    last_error: AssemblyResult | None = None


class AssemblySnapshot(BaseModel):
    placed: dict[str, str]
    completed_steps: list[int]
    current_step: int | None
    parts_placed: int
    parts_total: int
    is_complete: bool
    last_error: AssemblyResult | None


class GearState(BaseModel):
    part_id: str
    teeth: int
    direction: int  # +1 = 입력과 같은 방향, -1 = 반대
    speed_ratio: float  # 입력 기어 대비 회전 속도 비
    rpm: float


class MechanismState(BaseModel):
    operable: bool
    reasons: list[str]
    input_rpm: float
    reduction_ratio: float | None  # 출력 이빨 수 / 입력 이빨 수
    gears: list[GearState]
