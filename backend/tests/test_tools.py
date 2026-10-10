import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from app.assembly.engine import AssemblyEngine
from app.assembly.schemas import AttemptRequest
from app.core.config import REPO_ROOT
from app.core.db import SessionStore
from app.core.model_loader import get_model
from app.tools.registry import TOOLS, ToolContext, execute, tool_specs

MODEL = get_model("gearbox")
ORDER = [
    s.accepts_part_id for s in sorted(MODEL.slots, key=lambda s: MODEL.part(s.accepts_part_id).step)
]


@pytest.fixture
def ctx(tmp_path: Path) -> ToolContext:
    store = SessionStore(tmp_path / "t.sqlite3")
    return ToolContext(session_id=store.create("gearbox"), store=store)


def place(ctx: ToolContext, *part_ids: str, **override) -> None:
    def run(model_id, state):
        engine = AssemblyEngine(MODEL, state)
        for pid in part_ids:
            slot = MODEL.slot_for_part(pid)
            req = {"part_id": pid, "position": slot.position, "yaw_deg": slot.yaw_deg} | override
            engine.attempt(AttemptRequest(**req))

    ctx.store.update(ctx.session_id, run)


def test_part_info(ctx: ToolContext) -> None:
    r = execute("get_part_info", {"part_id": "gear-idler-24t"}, ctx)
    assert r["name"] == "아이들러 기어 (24T)"
    assert r["teeth"] == 24
    assert r["sits_on"] == "아이들러축"
    assert set(r["meshes_with"]) == {"입력 기어 (12T)", "출력 기어 (36T)"}
    assert r["is_placed"] is False


def test_assembly_state(ctx: ToolContext) -> None:
    place(ctx, "base-plate", "shaft-input")
    r = execute("get_assembly_state", {}, ctx)
    assert r["completed_steps"] == [1]
    assert r["current_step"] == 2
    assert r["current_step_title"] == "축 3개 세우기"
    assert r["parts_placed"] == 2
    assert "아이들러축" in r["remaining_parts"]


def test_assembly_error_with_hint(ctx: ToolContext) -> None:
    assert execute("get_assembly_error", {}, ctx)["has_error"] is False
    place(ctx, "base-plate")
    place(ctx, "gear-input-12t")
    r = execute("get_assembly_error", {}, ctx)
    assert r["has_error"] and r["error_type"] == "MISSING_PARENT"
    assert r["missing_parts"] == ["입력축"]
    assert "입력축을 먼저" in r["hint"]


def test_orientation_error_hint(ctx: ToolContext) -> None:
    place(ctx, "base-plate", yaw_deg=90)
    r = execute("get_assembly_error", {}, ctx)
    assert r["error_type"] == "WRONG_ORIENTATION"
    assert r["expected_rotation"] == 0 and r["current_rotation"] == 90
    assert "0°" in r["hint"]


def test_mechanism_and_simulation(ctx: ToolContext) -> None:
    r = execute("run_visual_simulation", {"input_rpm": 30}, ctx)
    assert r["started"] is False and r["reasons"]
    assert ctx.actions == []
    place(ctx, *ORDER)
    m = execute("get_mechanism_state", {"input_rpm": 60}, ctx)
    assert m["operable"] and m["reduction_ratio"] == 3
    rpm = {g["name"]: g["rpm"] for g in m["gears"]}
    assert rpm == {"입력 기어 (12T)": 60, "아이들러 기어 (24T)": -30, "출력 기어 (36T)": 20}
    assert {g["direction_label"] for g in m["gears"]} == {
        "반시계(위에서 볼 때)",
        "시계(위에서 볼 때)",
    }
    s = execute("run_visual_simulation", {"input_rpm": 45}, ctx)
    assert s["started"]
    assert ctx.actions == [{"type": "run_simulation", "input_rpm": 45.0}]


def test_reset_step_mutates_and_logs(ctx: ToolContext) -> None:
    place(ctx, "base-plate", "shaft-input")
    r = execute("reset_assembly_step", {}, ctx)
    assert r == {"removed": ["입력축"], "current_step": 2}
    assert ctx.store.events(ctx.session_id)[-1]["by"] == "tutor"
    assert {"type": "assembly_changed"} in ctx.actions


def test_execute_errors_are_returned_not_raised(ctx: ToolContext) -> None:
    assert "존재하지 않는 도구" in execute("delete_everything", {}, ctx)["error"]
    assert "잘못된 인자" in execute("get_part_info", {}, ctx)["error"]
    assert "잘못된 인자" in execute("get_assembly_state", {"x": 1}, ctx)["error"]
    assert "알 수 없는 part_id" in execute("get_part_info", {"part_id": "nope"}, ctx)["error"]
    assert "잘못된 인자" in execute("get_mechanism_state", {"input_rpm": 9999}, ctx)["error"]


def test_specs_include_part_enum() -> None:
    specs = {s.name: s for s in tool_specs(MODEL)}
    assert set(specs) == set(TOOLS)
    enum = specs["get_part_info"].parameters["properties"]["part_id"]["enum"]
    assert set(enum) == {p.part_id for p in MODEL.parts}
    for s in specs.values():
        Draft202012Validator.check_schema(s.parameters)


def test_exported_schema_is_up_to_date() -> None:
    from scripts.export_schemas import build  # noqa: PLC0415

    path = REPO_ROOT / "schemas" / "tool-calls.schema.json"
    assert json.loads(path.read_text(encoding="utf-8")) == build(), (
        "uv run python scripts/export_schemas.py"
    )
