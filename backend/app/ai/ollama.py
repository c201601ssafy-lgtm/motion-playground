"""Ollama /api/chat 어댑터. 기본 모델 qwen3:8b (4bit), thinking 끔."""

import json
import time
from typing import Any

import httpx

from app.ai.types import LLMError, LLMResponse, Message, ToolCall, ToolSpec


def _to_ollama(m: Message) -> dict[str, Any]:
    out: dict[str, Any] = {"role": m.role, "content": m.content}
    if m.tool_calls:
        out["tool_calls"] = [
            {"function": {"name": c.name, "arguments": c.arguments}} for c in m.tool_calls
        ]
    if m.role == "tool" and m.tool_name:
        out["tool_name"] = m.tool_name
    return out


def _parse_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


class OllamaAdapter:
    name = "ollama"

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        model: str = "qwen3:8b",
        timeout_s: float = 60.0,
        retries: int = 1,
        keep_alive: str = "30m",
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.model = model
        self.retries = retries
        self.keep_alive = keep_alive
        self._client = httpx.Client(base_url=base_url, timeout=timeout_s, transport=transport)

    def chat(self, messages: list[Message], tools: list[ToolSpec]) -> LLMResponse:
        payload = {
            "model": self.model,
            "messages": [_to_ollama(m) for m in messages],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                }
                for t in tools
            ],
            "stream": False,
            "think": False,
            "options": {"temperature": 0.2},
            "keep_alive": self.keep_alive,
        }
        last: Exception | None = None
        for _ in range(self.retries + 1):
            t0 = time.perf_counter()
            try:
                res = self._client.post("/api/chat", json=payload)
                res.raise_for_status()
                data = res.json()
            except (httpx.HTTPError, ValueError) as err:
                last = err
                continue
            msg = data.get("message") or {}
            calls = [
                ToolCall(
                    name=c["function"]["name"],
                    arguments=_parse_args(c["function"].get("arguments")),
                )
                for c in msg.get("tool_calls") or []
                if isinstance(c, dict)
                and isinstance(c.get("function"), dict)
                and c["function"].get("name")
            ]
            return LLMResponse(
                content=msg.get("content") or "",
                tool_calls=calls,
                model=data.get("model", self.model),
                latency_ms=round((time.perf_counter() - t0) * 1000, 1),
            )
        raise LLMError(f"Ollama 호출 실패: {last}")

    def warmup(self) -> float:
        """모델을 메모리에 미리 올린다(프롬프트 없는 /api/generate). 걸린 시간(ms)을 돌려준다."""
        t0 = time.perf_counter()
        try:
            res = self._client.post(
                "/api/generate", json={"model": self.model, "keep_alive": self.keep_alive}
            )
            res.raise_for_status()
        except httpx.HTTPError as err:
            raise LLMError(f"Ollama 워밍업 실패: {err}") from err
        return round((time.perf_counter() - t0) * 1000, 1)

    def available(self) -> bool:
        try:
            return self._client.get("/api/tags", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False
