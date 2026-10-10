from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.ai.mock import MockAdapter
from app.ai.tutor import TutorRequest, UsedTool, answer, grounding
from app.ai.types import LLMResponse, Message, ToolCall, ToolSpec
from app.api.sessions import get_store
from app.api.tutor import get_llm
from app.core.db import SessionStore
from app.core.model_loader import get_model
from app.main import app
from app.tools.registry import ToolContext

MODEL = get_model("gearbox")
ORDER = [
    s.accepts_part_id for s in sorted(MODEL.slots, key=lambda s: MODEL.part(s.accepts_part_id).step)
]


@pytest.fixture
def store(tmp_path: Path) -> SessionStore:
    return SessionStore(tmp_path / "t.sqlite3")


@pytest.fixture
def client(store: SessionStore):
    app.dependency_overrides[get_store] = lambda: store
    app.dependency_overrides[get_llm] = MockAdapter
    yield TestClient(app)
    app.dependency_overrides.clear()


def _pose(pid: str, **kw) -> dict:
    slot = MODEL.slot_for_part(pid)
    return {"part_id": pid, "position": list(slot.position), "yaw_deg": slot.yaw_deg} | kw


def test_part_question_uses_tool(client: TestClient) -> None:
    sid = client.post("/api/sessions", json={}).json()["session_id"]
    r = client.post(
        f"/api/sessions/{sid}/tutor", json={"question": "이 작은 기어는 어떤 역할을 해?"}
    ).json()
    assert [u["name"] for u in r["used_tools"]] == ["get_part_info"]
    assert r["used_tools"][0]["arguments"] == {"part_id": "gear-input-12t"}
    assert "입력 기어" in r["answer"]
    assert r["warnings"] == []
    assert r["provider"] == "mock" and r["degraded"] is False


def test_error_question_explains_cause_and_fix(client: TestClient) -> None:
    sid = client.post("/api/sessions", json={}).json()["session_id"]
    client.post(f"/api/sessions/{sid}/attempt", json=_pose("base-plate", yaw_deg=90))
    r = client.post(
        f"/api/sessions/{sid}/tutor", json={"question": "내가 어떤 부품을 잘못 끼웠어?"}
    ).json()
    names = [u["name"] for u in r["used_tools"]]
    assert "get_assembly_error" in names
    assert "베이스 플레이트" in r["answer"] and "90°" in r["answer"] and "0°" in r["answer"]
    assert r["warnings"] == []


def test_direction_question_grounded_numbers(client: TestClient) -> None:
    sid = client.post("/api/sessions", json={}).json()["session_id"]
    for pid in ORDER:
        client.post(f"/api/sessions/{sid}/attempt", json=_pose(pid))
    r = client.post(
        f"/api/sessions/{sid}/tutor",
        json={"question": "왜 이쪽으로 돌면 반대쪽 기어가 반대로 돌아?"},
    ).json()
    assert r["used_tools"][0]["name"] == "get_mechanism_state"
    assert "반대 방향" in r["answer"]
    assert 15.0 in r["cited_values"] and 3.0 in r["cited_values"]
    assert not any(w.startswith("UNGROUNDED") for w in r["warnings"])


def test_simulation_question_returns_action(client: TestClient) -> None:
    sid = client.post("/api/sessions", json={}).json()["session_id"]
    client.post(f"/api/sessions/{sid}/assemble-all")
    r = client.post(f"/api/sessions/{sid}/tutor", json={"question": "45rpm으로 돌려 봐"}).json()
    assert r["actions"] == [{"type": "run_simulation", "input_rpm": 45.0}]


def test_tutor_logs_event_and_validates(client: TestClient) -> None:
    sid = client.post("/api/sessions", json={}).json()["session_id"]
    client.post(f"/api/sessions/{sid}/tutor", json={"question": "지금 몇 단계야?"})
    ev = client.get(f"/api/sessions/{sid}/events").json()["events"]
    assert ev[-1]["kind"] == "tutor" and ev[-1]["tools"] == ["get_assembly_state"]
    assert client.post(f"/api/sessions/{sid}/tutor", json={"question": ""}).status_code == 422
    assert client.post("/api/sessions/nope/tutor", json={"question": "hi"}).status_code == 404


class _HallucinatingLLM:
    """도구를 부르지 않고 숫자를 지어내는 가짜 LLM."""

    name = "fake"

    def chat(self, messages: list[Message], tools: list[ToolSpec]) -> LLMResponse:
        return LLMResponse(content="<think>음</think>출력 기어는 42rpm으로 돕니다.", model="fake")


class _LoopingLLM:
    """끝없이 도구만 부르는 LLM → 최대 횟수 후 강제 마무리."""

    name = "loop"

    def __init__(self) -> None:
        self.calls = 0

    def chat(self, messages: list[Message], tools: list[ToolSpec]) -> LLMResponse:
        self.calls += 1
        if not tools:
            return LLMResponse(content="지금까지 결과로 답합니다.", model="loop")
        return LLMResponse(tool_calls=[ToolCall(name="get_assembly_state")], model="loop")


def test_flags_ungrounded_numbers_and_strips_think(store: SessionStore) -> None:
    ctx = ToolContext(session_id=store.create("gearbox"), store=store)
    r = answer(TutorRequest(question="출력 기어 속도는?"), ctx, _HallucinatingLLM())
    assert "<think>" not in r.answer
    assert "NO_TOOLS_USED" in r.warnings
    assert "UNGROUNDED_NUMBER:42" in r.warnings


def test_tool_rounds_are_capped(store: SessionStore) -> None:
    ctx = ToolContext(session_id=store.create("gearbox"), store=store)
    llm = _LoopingLLM()
    r = answer(TutorRequest(question="상태?"), ctx, llm)
    assert r.rounds == 4 and len(r.used_tools) == 4
    assert llm.calls == 5
    assert r.answer == "지금까지 결과로 답합니다."


def test_grounding_accepts_values_from_results_and_question() -> None:
    used = [
        UsedTool(name="x", arguments={"input_rpm": 30}, result={"rpm": -15.0, "note": "이빨 36개"})
    ]
    cited, bad = grounding("30rpm 입력에 15rpm, 36개, 2.5배, 7단계", used, "7단계는?")
    assert cited == [7.0, 15.0, 30.0, 36.0]
    assert bad == [2.5]


class _LazyThenToolLLM:
    """처음엔 도구 없이 답하려다, 되묻으면 도구를 쓰는 LLM."""

    name = "lazy"

    def __init__(self) -> None:
        self.seen_nudge = False

    def chat(self, messages: list[Message], tools: list[ToolSpec]) -> LLMResponse:
        last = messages[-1]
        if last.role == "user" and "도구를 먼저" in last.content:
            self.seen_nudge = True
            return LLMResponse(tool_calls=[ToolCall(name="get_assembly_state")], model="lazy")
        if last.role == "tool":
            return LLMResponse(content="지금은 1단계입니다.", model="lazy")
        return LLMResponse(content="아마 3단계일 거예요.", model="lazy")


def test_nudges_once_when_model_skips_tools(store: SessionStore) -> None:
    ctx = ToolContext(session_id=store.create("gearbox"), store=store)
    llm = _LazyThenToolLLM()
    r = answer(TutorRequest(question="지금 몇 단계야?"), ctx, llm)
    assert llm.seen_nudge
    assert [u.name for u in r.used_tools] == ["get_assembly_state"]
    assert r.answer == "지금은 1단계입니다."
    assert r.warnings == []
