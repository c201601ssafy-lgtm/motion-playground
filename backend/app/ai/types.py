"""LLM 어댑터 공통 타입 (D-007). 모델 호출은 교체 가능한 adapter로만 한다."""

from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field


class ToolCall(BaseModel):
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class Message(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)
    tool_name: str | None = None  # role=tool 일 때 어떤 도구의 결과인지


class ToolSpec(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema


class LLMResponse(BaseModel):
    content: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)
    model: str
    latency_ms: float = 0.0


class LLMError(RuntimeError):
    pass


class LLMAdapter(Protocol):
    name: str

    def chat(self, messages: list[Message], tools: list[ToolSpec]) -> LLMResponse: ...
