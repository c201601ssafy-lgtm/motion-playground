import shutil
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from app.core.config import REPO_ROOT
from app.core.model_loader import ModelValidationError, load_model
from app.main import app

GEARBOX_DIR = REPO_ROOT / "models" / "gearbox"


def test_gearbox_loads() -> None:
    model = load_model(GEARBOX_DIR)
    assert len(model.parts) == 8
    assert len(model.slots) == 8
    assert [st.step for st in model.steps] == [1, 2, 3, 4]
    gears = {p.part_id: p.teeth for p in model.parts if p.kind == "gear"}
    assert gears == {"gear-input-12t": 12, "gear-idler-24t": 24, "gear-output-36t": 36}


@pytest.fixture
def model_copy(tmp_path: Path) -> Path:
    dst = tmp_path / "gearbox"
    shutil.copytree(GEARBOX_DIR, dst)
    return dst


def _edit(path: Path, fn) -> None:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    fn(data)
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")


def _slot(data: dict, slot_id: str) -> dict:
    return next(s for s in data["slots"] if s["slot_id"] == slot_id)


def _errors(model_dir: Path) -> str:
    with pytest.raises(ModelValidationError) as exc:
        load_model(model_dir)
    return "\n".join(exc.value.errors)


def test_unknown_part_reference(model_copy: Path) -> None:
    _edit(
        model_copy / "connections.yaml",
        lambda d: _slot(d, "slot-gear-a").update(accepts_part_id="gear-ghost"),
    )
    assert "없는 부품 gear-ghost" in _errors(model_copy)


def test_unknown_parent(model_copy: Path) -> None:
    _edit(
        model_copy / "connections.yaml",
        lambda d: _slot(d, "slot-gear-a").update(parent_part_id="shaft-ghost"),
    )
    assert "없는 부모 부품 shaft-ghost" in _errors(model_copy)


def test_gear_center_distance(model_copy: Path) -> None:
    _edit(
        model_copy / "connections.yaml",
        lambda d: _slot(d, "slot-gear-c").update(position=[2.5, 0.35, 0.0]),
    )
    assert "중심 거리" in _errors(model_copy)


def test_mesh_symmetry(model_copy: Path) -> None:
    _edit(
        model_copy / "connections.yaml",
        lambda d: _slot(d, "slot-gear-c").update(meshes_with=[]),
    )
    assert "맞물림 비대칭" in _errors(model_copy)


def test_parent_cycle(model_copy: Path) -> None:
    _edit(
        model_copy / "connections.yaml",
        lambda d: _slot(d, "slot-base").update(parent_part_id="top-cover"),
    )
    assert "순환" in _errors(model_copy)


def test_step_requires_later_step(model_copy: Path) -> None:
    _edit(model_copy / "assembly-steps.yaml", lambda d: d["steps"][1].update(requires_steps=[3]))
    assert "더 앞 단계" in _errors(model_copy)


def test_unknown_field_rejected(model_copy: Path) -> None:
    _edit(model_copy / "parts.yaml", lambda d: d["parts"][0].update(colour="red"))
    with pytest.raises(ValueError):
        load_model(model_copy)


def test_model_endpoint() -> None:
    client = TestClient(app)
    res = client.get("/api/models/gearbox")
    assert res.status_code == 200
    body = res.json()
    assert body["meta"]["model_id"] == "gearbox"
    assert len(body["parts"]) == 8
    assert client.get("/api/models/unknown").status_code == 404
    assert client.get("/api/models/..%2Fsecrets").status_code == 404
