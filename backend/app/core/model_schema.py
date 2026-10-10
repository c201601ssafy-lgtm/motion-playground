"""기계 모델 데이터 스키마 (D-005).

YAML 3종(parts, connections, assembly-steps)이 단일 진실 원천이다.
여기서는 필드 형태만 검증하고, 파일 간 참조 무결성은 `model_loader`가 검사한다.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Vec3 = tuple[float, float, float]
Axis = Literal["x", "y", "z"]
PartKind = Literal["base", "shaft", "gear", "cover"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class BoxGeometry(_Strict):
    type: Literal["box"]
    size: Vec3


class CylinderGeometry(_Strict):
    type: Literal["cylinder"]
    radius: float = Field(gt=0)
    length: float = Field(gt=0)


class GearGeometry(_Strict):
    type: Literal["gear"]
    module: float = Field(gt=0)
    teeth: int = Field(ge=6)
    thickness: float = Field(gt=0)
    bore_radius: float = Field(gt=0)

    @property
    def pitch_radius(self) -> float:
        return self.module * self.teeth / 2


Geometry = Annotated[BoxGeometry | CylinderGeometry | GearGeometry, Field(discriminator="type")]


class Collider(_Strict):
    """물리 충돌체. 시각 메시와 분리된 단순 도형."""

    type: Literal["box", "cylinder"]
    size: list[float] = Field(min_length=2, max_length=3)


class Part(_Strict):
    part_id: str
    name: str
    kind: PartKind
    step: int = Field(ge=1)
    mass: float = Field(gt=0)
    rotation_axis: Axis
    description: str
    function: str
    teeth: int | None = None
    geometry: Geometry
    collider: Collider
    explode_offset: Vec3 = (0.0, 0.0, 0.0)  # 분해도에서 슬롯 위치로부터의 이동량


class Slot(_Strict):
    """부품 하나가 결합되는 지점."""

    slot_id: str
    accepts_part_id: str
    parent_part_id: str | None
    position: Vec3
    axis: Vec3
    orientation_rule: Literal["axis_only", "axis_and_yaw"]
    yaw_deg: float = 0.0
    yaw_symmetry_deg: float = Field(default=360.0, gt=0, le=360)
    snap_radius: float = Field(default=0.25, gt=0)
    meshes_with: list[str] = Field(default_factory=list)


class AssemblyStep(_Strict):
    step: int = Field(ge=1)
    title: str
    slots: list[str] = Field(min_length=1)
    requires_steps: list[int] = Field(default_factory=list)


class ModelMeta(_Strict):
    model_id: str
    name: str
    gear_module: float = Field(gt=0)
    input_part_id: str
    output_part_id: str


class MechanismModel(_Strict):
    meta: ModelMeta
    parts: list[Part]
    slots: list[Slot]
    steps: list[AssemblyStep]

    def part(self, part_id: str) -> Part | None:
        return next((p for p in self.parts if p.part_id == part_id), None)

    def slot(self, slot_id: str) -> Slot | None:
        return next((s for s in self.slots if s.slot_id == slot_id), None)

    def slot_for_part(self, part_id: str) -> Slot | None:
        return next((s for s in self.slots if s.accepts_part_id == part_id), None)

    def step_of_slot(self, slot_id: str) -> AssemblyStep | None:
        return next((st for st in self.steps if slot_id in st.slots), None)
