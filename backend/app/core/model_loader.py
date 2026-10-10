"""YAML → MechanismModel 로드 및 참조 무결성 검사."""

import math
from functools import lru_cache
from pathlib import Path

import yaml

from app.core.config import settings
from app.core.model_schema import GearGeometry, MechanismModel

GEAR_DISTANCE_TOLERANCE = 1e-6
AXIS_NORM_TOLERANCE = 1e-6


class ModelValidationError(ValueError):
    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("모델 데이터 오류:\n- " + "\n- ".join(errors))


def _read_yaml(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ModelValidationError([f"{path.name}: 최상위가 매핑이 아님"])
    return data


def load_model(model_dir: Path) -> MechanismModel:
    parts_doc = _read_yaml(model_dir / "parts.yaml")
    slots_doc = _read_yaml(model_dir / "connections.yaml")
    steps_doc = _read_yaml(model_dir / "assembly-steps.yaml")
    model = MechanismModel(
        meta=parts_doc.get("model"),
        parts=parts_doc.get("parts", []),
        slots=slots_doc.get("slots", []),
        steps=steps_doc.get("steps", []),
    )
    errors = validate_model(model)
    if errors:
        raise ModelValidationError(errors)
    return model


def _duplicates(ids: list[str]) -> set[str]:
    seen: set[str] = set()
    return {i for i in ids if i in seen or seen.add(i)}


def validate_model(model: MechanismModel) -> list[str]:
    """파일 간 참조 무결성. 오류 메시지 목록을 반환(비어 있으면 정상)."""
    errors: list[str] = []
    part_ids = [p.part_id for p in model.parts]
    slot_ids = [s.slot_id for s in model.slots]
    step_nums = [st.step for st in model.steps]

    for kind, ids in (("part_id", part_ids), ("slot_id", slot_ids), ("step", step_nums)):
        for dup in _duplicates(ids):
            errors.append(f"중복 {kind}: {dup}")

    # 부품 ↔ 슬롯: 부품마다 정확히 하나의 슬롯
    for p in model.parts:
        n = sum(1 for s in model.slots if s.accepts_part_id == p.part_id)
        if n != 1:
            errors.append(f"부품 {p.part_id}의 슬롯 수가 {n}개 (1개여야 함)")
        if p.kind == "gear":
            if not isinstance(p.geometry, GearGeometry):
                errors.append(f"기어 {p.part_id}의 geometry가 gear가 아님")
            elif p.teeth != p.geometry.teeth:
                errors.append(f"기어 {p.part_id}의 teeth와 geometry.teeth 불일치")
            elif not math.isclose(p.geometry.module, model.meta.gear_module):
                errors.append(f"기어 {p.part_id}의 module이 모델 gear_module과 다름")

    for s in model.slots:
        if s.accepts_part_id not in part_ids:
            errors.append(f"슬롯 {s.slot_id}: 없는 부품 {s.accepts_part_id}")
        if s.parent_part_id is not None and s.parent_part_id not in part_ids:
            errors.append(f"슬롯 {s.slot_id}: 없는 부모 부품 {s.parent_part_id}")
        if not math.isclose(math.hypot(*s.axis), 1.0, abs_tol=AXIS_NORM_TOLERANCE):
            errors.append(f"슬롯 {s.slot_id}: axis가 단위 벡터가 아님")
        for other in s.meshes_with:
            if other not in slot_ids:
                errors.append(f"슬롯 {s.slot_id}: 없는 맞물림 슬롯 {other}")

    # 단계 ↔ 슬롯: 모든 슬롯은 정확히 한 단계에 속하고, 부품 step과 일치
    for s in model.slots:
        owners = [st.step for st in model.steps if s.slot_id in st.slots]
        if len(owners) != 1:
            errors.append(f"슬롯 {s.slot_id}이 속한 단계 수가 {len(owners)}개")
        elif (p := model.part(s.accepts_part_id)) is not None and p.step != owners[0]:
            errors.append(f"부품 {p.part_id}의 step {p.step} ≠ 슬롯 단계 {owners[0]}")
    for st in model.steps:
        for sid in st.slots:
            if sid not in slot_ids:
                errors.append(f"단계 {st.step}: 없는 슬롯 {sid}")
        for req in st.requires_steps:
            if req not in step_nums:
                errors.append(f"단계 {st.step}: 없는 선행 단계 {req}")
            elif req >= st.step:
                errors.append(f"단계 {st.step}: 선행 단계 {req}는 더 앞 단계여야 함")

    errors.extend(_check_parent_chain(model))
    errors.extend(_check_gear_meshes(model))
    return errors


def _check_parent_chain(model: MechanismModel) -> list[str]:
    """부모 관계에 순환이 없고, 부모가 더 앞 단계인지."""
    errors: list[str] = []
    for s in model.slots:
        seen = {s.accepts_part_id}
        cur = s
        while cur.parent_part_id is not None:
            if cur.parent_part_id in seen:
                errors.append(f"부모 관계 순환: {s.accepts_part_id}")
                break
            seen.add(cur.parent_part_id)
            parent_slot = model.slot_for_part(cur.parent_part_id)
            if parent_slot is None:
                break
            cur = parent_slot
        child, parent = model.part(s.accepts_part_id), model.part(s.parent_part_id or "")
        if child and parent and parent.step >= child.step:
            errors.append(f"부모 {parent.part_id}가 자식 {child.part_id}보다 앞 단계가 아님")
    return errors


def _check_gear_meshes(model: MechanismModel) -> list[str]:
    """맞물림 대칭 + 중심 거리 = (T1+T2)/2 · m."""
    errors: list[str] = []
    for s in model.slots:
        for other_id in s.meshes_with:
            other = model.slot(other_id)
            if other is None:
                continue
            if s.slot_id not in other.meshes_with:
                errors.append(f"맞물림 비대칭: {s.slot_id} → {other_id}")
            a, b = model.part(s.accepts_part_id), model.part(other.accepts_part_id)
            if a is None or b is None or a.teeth is None or b.teeth is None:
                errors.append(f"맞물림 {s.slot_id}-{other_id}: 기어가 아닌 부품")
                continue
            expected = (a.teeth + b.teeth) / 2 * model.meta.gear_module
            actual = math.dist(s.position, other.position)
            if not math.isclose(actual, expected, abs_tol=GEAR_DISTANCE_TOLERANCE):
                errors.append(
                    f"맞물림 {s.slot_id}-{other_id}: 중심 거리 {actual:.6f} ≠ 기대값 {expected:.6f}"
                )
    return errors


@lru_cache
def get_model(model_id: str) -> MechanismModel:
    model_dir = settings.models_dir / model_id
    if not model_dir.is_dir():
        raise KeyError(model_id)
    return load_model(model_dir)
