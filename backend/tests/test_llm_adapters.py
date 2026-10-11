import json

import httpx
import pytest

from app.ai.mock import MockAdapter, resolve_part, route
from app.ai.ollama import OllamaAdapter
from app.ai.provider import FallbackAdapter, LLMSettings, build_adapter, warmup
from app.ai.types import LLMError, Message, ToolCall, ToolSpec

TOOLS = [
    ToolSpec(name=n, description=n, parameters={"type": "object", "properties": {}})
    for n in [
        "get_part_info",
        "get_assembly_state",
        "get_assembly_error",
        "get_mechanism_state",
        "run_visual_simulation",
        "reset_assembly_step",
    ]
]


@pytest.mark.parametrize(
    ("question", "tools"),
    [
        ("이 작은 기어는 어떤 역할을 해?", ["get_part_info"]),
        ("왜 이쪽으로 돌면 반대쪽 기어가 반대로 돌아?", ["get_mechanism_state"]),
        ("왜 지금 작동하지 않아?", ["get_assembly_error", "get_assembly_state"]),
        ("기어비를 높이면 어떻게 돼?", ["get_mechanism_state"]),
        ("내가 어떤 부품을 잘못 끼웠어?", ["get_assembly_error", "get_assembly_state"]),
        ("60rpm으로 돌려 봐", ["run_visual_simulation"]),
        ("이번 단계 다시 할래", ["reset_assembly_step"]),
        ("지금 몇 단계야?", ["get_assembly_state"]),
    ],
)
def test_mock_routing(question: str, tools: list[str]) -> None:
    assert [c.name for c in route(question)] == tools


def test_part_resolution_prefers_shafts() -> None:
    assert resolve_part("입력축은 뭐야") == "shaft-input"
    assert resolve_part("입력 기어는 뭐야") == "gear-input-12t"
    assert resolve_part("36T 기어") == "gear-output-36t"
    assert resolve_part("날씨 어때") is None


def test_rpm_argument_extracted() -> None:
    assert route("45 rpm으로 돌려줘")[0].arguments == {"input_rpm": 45.0}


def test_mock_two_phase_answer_uses_tool_numbers_only() -> None:
    m = MockAdapter()
    msgs = [Message(role="system", content="ctx"), Message(role="user", content="왜 반대로 돌아?")]
    first = m.chat(msgs, TOOLS)
    assert [c.name for c in first.tool_calls] == ["get_mechanism_state"]
    result = {
        "operable": True,
        "reasons": [],
        "input_rpm": 30.0,
        "reduction_ratio": 3.0,
        "gears": [
            {"name": "입력 기어", "rpm": 30.0, "direction_label": "반시계"},
            {"name": "아이들러", "rpm": -15.0, "direction_label": "시계"},
        ],
    }
    msgs += [
        Message(role="assistant", tool_calls=first.tool_calls),
        Message(role="tool", tool_name="get_mechanism_state", content=json.dumps(result)),
    ]
    second = m.chat(msgs, TOOLS)
    assert not second.tool_calls
    assert "15rpm" in second.content and "3:1" in second.content


def test_mock_uses_selected_part_from_context() -> None:
    msgs = [
        Message(role="system", content='{"selected_part": "gear-idler-24t"}'),
        Message(role="user", content="이건 뭐야?"),
    ]
    calls = MockAdapter().chat(msgs, TOOLS).tool_calls
    assert calls == [ToolCall(name="get_part_info", arguments={"part_id": "gear-idler-24t"})]


def _ollama_with(handler) -> OllamaAdapter:
    return OllamaAdapter(transport=httpx.MockTransport(handler), retries=0)


def test_ollama_parses_tool_calls_and_sends_tools() -> None:
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.update(json.loads(req.content))
        return httpx.Response(
            200,
            json={
                "model": "qwen3:8b",
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {"function": {"name": "get_part_info", "arguments": {"part_id": "x"}}},
                        {"function": {"name": "get_assembly_state", "arguments": "{}"}},
                        {"bogus": True},
                    ],
                },
            },
        )

    res = _ollama_with(handler).chat([Message(role="user", content="hi")], TOOLS)
    assert [c.name for c in res.tool_calls] == ["get_part_info", "get_assembly_state"]
    assert res.tool_calls[0].arguments == {"part_id": "x"}
    assert seen["think"] is False and seen["stream"] is False
    assert seen["tools"][0]["type"] == "function"


def test_ollama_error_raises_llm_error() -> None:
    adapter = _ollama_with(lambda req: httpx.Response(500, text="boom"))
    with pytest.raises(LLMError):
        adapter.chat([Message(role="user", content="hi")], TOOLS)


def test_fallback_marks_degraded() -> None:
    primary = _ollama_with(lambda req: httpx.Response(503))
    fb = FallbackAdapter(primary, MockAdapter())
    res = fb.chat([Message(role="user", content="지금 몇 단계야?")], TOOLS)
    assert fb.degraded
    assert res.tool_calls[0].name == "get_assembly_state"


def test_build_adapter_from_settings() -> None:
    assert build_adapter(LLMSettings(llm_provider="mock")).name == "mock"
    assert isinstance(build_adapter(LLMSettings(llm_provider="ollama")), FallbackAdapter)


def test_ollama_sends_keep_alive_and_warms_up() -> None:
    seen: list[tuple[str, dict]] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.url.path, json.loads(req.content)))
        if req.url.path == "/api/generate":
            return httpx.Response(200, json={"done": True})
        return httpx.Response(200, json={"message": {"role": "assistant", "content": "ok"}})

    adapter = OllamaAdapter(transport=httpx.MockTransport(handler), retries=0, keep_alive="1h")
    assert adapter.warmup() >= 0
    adapter.chat([Message(role="user", content="hi")], TOOLS)
    assert seen[0] == ("/api/generate", {"model": "qwen3:8b", "keep_alive": "1h"})
    assert seen[1][0] == "/api/chat" and seen[1][1]["keep_alive"] == "1h"


def test_ollama_warmup_error_raises_llm_error() -> None:
    with pytest.raises(LLMError):
        _ollama_with(lambda req: httpx.Response(404)).warmup()


def test_warmup_skipped_unless_ollama() -> None:
    assert warmup(LLMSettings(llm_provider="mock")) is None
    assert warmup(LLMSettings(llm_provider="ollama", ollama_warmup=False)) is None
