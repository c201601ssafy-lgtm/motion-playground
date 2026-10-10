from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.sessions import get_store
from app.core.db import SessionStore
from app.core.model_loader import get_model
from app.main import app

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


@pytest.fixture
def client(tmp_path: Path):
    store = SessionStore(tmp_path / "test.sqlite3")
    app.dependency_overrides[get_store] = lambda: store
    yield TestClient(app)
    app.dependency_overrides.clear()


def _slot_pose(part_id: str) -> dict:
    slot = get_model("gearbox").slot_for_part(part_id)
    assert slot is not None
    return {"part_id": part_id, "position": list(slot.position), "yaw_deg": slot.yaw_deg}


def test_full_flow(client: TestClient) -> None:
    res = client.post("/api/sessions", json={})
    assert res.status_code == 201
    sid = res.json()["session_id"]
    assert res.json()["snapshot"]["current_step"] == 1

    mech = client.get(f"/api/sessions/{sid}/mechanism").json()
    assert mech["operable"] is False

    for pid in ORDER:
        body = client.post(f"/api/sessions/{sid}/attempt", json=_slot_pose(pid)).json()
        assert body["result"]["is_valid"], body

    snap = client.get(f"/api/sessions/{sid}").json()["snapshot"]
    assert snap["is_complete"] and snap["parts_placed"] == 8

    mech = client.get(f"/api/sessions/{sid}/mechanism", params={"input_rpm": 60}).json()
    assert mech["operable"] is True
    assert mech["reduction_ratio"] == pytest.approx(3.0)
    rpm = {g["part_id"]: g["rpm"] for g in mech["gears"]}
    assert rpm == pytest.approx(
        {"gear-input-12t": 60, "gear-idler-24t": -30, "gear-output-36t": 20}
    )


def test_error_persists_as_last_error(client: TestClient) -> None:
    sid = client.post("/api/sessions", json={}).json()["session_id"]
    body = client.post(
        f"/api/sessions/{sid}/attempt",
        json={"part_id": "shaft-input", "position": [0.0, 0.5, 0.0]},
    ).json()
    assert body["result"]["error_type"] == "MISSING_PARENT"
    snap = client.get(f"/api/sessions/{sid}").json()["snapshot"]
    assert snap["last_error"]["error_type"] == "MISSING_PARENT"


def test_reset_step_and_assemble_all(client: TestClient) -> None:
    sid = client.post("/api/sessions", json={}).json()["session_id"]
    for pid in ORDER[:3]:
        client.post(f"/api/sessions/{sid}/attempt", json=_slot_pose(pid))
    body = client.post(f"/api/sessions/{sid}/reset-step").json()
    assert sorted(body["removed"]) == ["shaft-idler", "shaft-input"]
    snap = client.post(f"/api/sessions/{sid}/assemble-all").json()
    assert snap["is_complete"]


def test_not_found_and_validation(client: TestClient) -> None:
    assert client.get("/api/sessions/nope").status_code == 404
    assert (
        client.post("/api/sessions/nope/attempt", json=_slot_pose("base-plate")).status_code == 404
    )
    assert client.post("/api/sessions", json={"model_id": "robot-arm"}).status_code == 404
    sid = client.post("/api/sessions", json={}).json()["session_id"]
    assert client.post(f"/api/sessions/{sid}/attempt", json={"part_id": "x"}).status_code == 422
    assert (
        client.get(f"/api/sessions/{sid}/mechanism", params={"input_rpm": 10_000}).status_code
        == 422
    )


def test_event_log_and_summary(client: TestClient) -> None:
    sid = client.post("/api/sessions", json={}).json()["session_id"]
    # 오류 2회(순서·부모), 멂 1회(시도 아님), 그다음 전체 조립
    client.post(
        f"/api/sessions/{sid}/attempt",
        json={"part_id": "shaft-input", "position": [0.0, 0.5, 0.0]},
    )
    client.post(
        f"/api/sessions/{sid}/attempt", json={"part_id": "shaft-input", "position": [9, 9, 9]}
    )
    client.post(f"/api/sessions/{sid}/attempt", json=_slot_pose("base-plate"))
    client.post(
        f"/api/sessions/{sid}/attempt",
        json={"part_id": "gear-input-12t", "position": [0.0, 0.35, 0.0]},
    )
    client.post(f"/api/sessions/{sid}/reset-step")
    for pid in ORDER:
        client.post(f"/api/sessions/{sid}/attempt", json=_slot_pose(pid))

    body = client.get(f"/api/sessions/{sid}/events").json()
    kinds = [e["kind"] for e in body["events"]]
    assert kinds[0] == "session_created"
    assert "reset_step" in kinds
    s = body["summary"]
    assert s["too_far"] == 1
    assert s["errors"] == 3  # MISSING_PARENT ×2 + ALREADY_PLACED(리셋은 2단계라 베이스는 남음)
    assert s["by_error_type"] == {"MISSING_PARENT": 2, "ALREADY_PLACED": 1}
    assert s["valid"] == 8
    assert s["attempts"] == 11
    assert s["completed_at"] is not None and s["duration_s"] is not None
    assert s["auto_assembled"] is False
    assert client.get("/api/sessions/nope/events").status_code == 404
