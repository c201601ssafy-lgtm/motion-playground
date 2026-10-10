from fastapi.testclient import TestClient

from app.main import app


def test_reports_endpoint_returns_known_reports_only() -> None:
    body = TestClient(app).get("/api/reports").json()
    assert set(body) == {
        "gesture",
        "tool_calls_mock",
        "tool_calls_ollama",
        "tool_calls_ollama_baseline",
    }
    assert body["gesture"]["clips"] > 0
    mock = body["tool_calls_mock"]
    assert mock["provider"] == "mock"
    assert "tool_selection_rate" in mock["summary"]
    assert "answer" not in mock["cases"][0]
