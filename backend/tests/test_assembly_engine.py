import json

import pytest

from app.assembly.engine import AssemblyEngine
from app.assembly.schemas import AssemblyState, AttemptRequest, ErrorType
from app.core.config import REPO_ROOT
from app.core.model_loader import load_model

MODEL = load_model(REPO_ROOT / "models" / "gearbox")
CASES = [
    json.loads(line)
    for line in (REPO_ROOT / "evals" / "assembly-cases.jsonl")
    .read_text(encoding="utf-8")
    .splitlines()
    if line.strip()
]
ORDER = [
    "base-plate",
    "shaft-input",
    "shaft-idler",
    "shaft-output",
    "gear-input-12t",
    "gear-idler-24t",
    "gear-output-36t",
    "top-cover",
]


def place(engine: AssemblyEngine, part_id: str):
    slot = MODEL.slot_for_part(part_id)
    assert slot is not None
    return engine.attempt(
        AttemptRequest(part_id=part_id, position=slot.position, yaw_deg=slot.yaw_deg)
    )


def engine_with(*part_ids: str) -> AssemblyEngine:
    engine = AssemblyEngine(MODEL)
    for pid in part_ids:
        assert place(engine, pid).is_valid, pid
    return engine


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_assembly_cases(case: dict) -> None:
    engine = engine_with(*case["setup"])
    result = engine.attempt(AttemptRequest(**case["attempt"]))
    for key, value in case["expect"].items():
        assert getattr(result, key) == value, (key, result)


def test_every_error_type_covered() -> None:
    covered = {c["expect"].get("error_type") for c in CASES}
    assert {e.value for e in ErrorType} <= covered


def test_full_assembly_in_order() -> None:
    engine = AssemblyEngine(MODEL)
    completed = []
    for pid in ORDER:
        res = place(engine, pid)
        assert res.is_valid, res
        if res.step_completed:
            completed.append(res.step_completed)
    assert completed == [1, 2, 3, 4]
    assert res.assembly_complete
    snap = engine.snapshot()
    assert snap.is_complete and snap.current_step is None
    assert snap.parts_placed == snap.parts_total == 8


def test_current_step_progresses() -> None:
    engine = engine_with("base-plate", "shaft-input")
    snap = engine.snapshot()
    assert snap.completed_steps == [1]
    assert snap.current_step == 2


def test_mechanism_full() -> None:
    engine = engine_with(*ORDER)
    mech = engine.mechanism_state(input_rpm=30)
    assert mech.operable and mech.reasons == []
    assert mech.reduction_ratio == pytest.approx(3.0)
    by_id = {g.part_id: g for g in mech.gears}
    assert by_id["gear-input-12t"].rpm == pytest.approx(30)
    assert by_id["gear-idler-24t"].direction == -1
    assert by_id["gear-idler-24t"].rpm == pytest.approx(-15)
    assert by_id["gear-output-36t"].direction == 1
    assert by_id["gear-output-36t"].rpm == pytest.approx(10)


def test_mechanism_works_without_cover() -> None:
    engine = engine_with(*ORDER[:-1])
    assert engine.mechanism_state().operable


def test_mechanism_not_operable_reports_reason() -> None:
    engine = engine_with(*ORDER[:6])
    mech = engine.mechanism_state()
    assert not mech.operable
    assert "출력 기어 (36T) 미조립" in mech.reasons
    assert mech.gears == []


def test_last_error_tracking() -> None:
    engine = engine_with("base-plate")
    engine.attempt(AttemptRequest(part_id="gear-input-12t", position=(0.0, 0.35, 0.0)))
    assert engine.state.last_error is not None
    assert engine.state.last_error.error_type == ErrorType.MISSING_PARENT
    engine.attempt(AttemptRequest(part_id="shaft-input", position=(9.0, 9.0, 9.0)))
    assert engine.state.last_error.error_type == ErrorType.MISSING_PARENT  # TOO_FAR는 기록 안 함
    place(engine, "shaft-input")
    assert engine.state.last_error is None


def test_reset_step() -> None:
    engine = engine_with("base-plate", "shaft-input", "shaft-idler")
    assert sorted(engine.reset_step()) == ["shaft-idler", "shaft-input"]
    assert engine.snapshot().current_step == 2
    assert engine.snapshot().placed == {"slot-base": "base-plate"}


def test_reset_step_when_complete_resets_last_step() -> None:
    engine = engine_with(*ORDER)
    assert engine.reset_step() == ["top-cover"]


def test_assemble_all() -> None:
    engine = AssemblyEngine(MODEL)
    engine.assemble_all()
    assert engine.snapshot().is_complete


def test_state_roundtrip() -> None:
    engine = engine_with("base-plate", "shaft-input")
    restored = AssemblyEngine(
        MODEL, AssemblyState.model_validate_json(engine.state.model_dump_json())
    )
    assert restored.snapshot() == engine.snapshot()
