"""LLM 프로바이더 선택 + 실패 시 Mock 폴백."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.ai.mock import MockAdapter
from app.ai.ollama import OllamaAdapter
from app.ai.types import LLMAdapter, LLMError, LLMResponse, Message, ToolSpec


class LLMSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    llm_provider: Literal["mock", "ollama"] = "mock"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3:8b"
    ollama_timeout_s: float = 60.0


class FallbackAdapter:
    """주 어댑터가 실패하면 보조 어댑터로 답하고 degraded 표시를 남긴다."""

    def __init__(self, primary: LLMAdapter, fallback: LLMAdapter) -> None:
        self.primary = primary
        self.fallback = fallback
        self.name = primary.name
        self.degraded = False

    def chat(self, messages: list[Message], tools: list[ToolSpec]) -> LLMResponse:
        if not self.degraded:
            try:
                return self.primary.chat(messages, tools)
            except LLMError:
                self.degraded = True
        return self.fallback.chat(messages, tools)


def build_adapter(settings: LLMSettings | None = None) -> LLMAdapter | FallbackAdapter:
    s = settings or LLMSettings()
    if s.llm_provider == "ollama":
        return FallbackAdapter(
            OllamaAdapter(s.ollama_base_url, s.ollama_model, timeout_s=s.ollama_timeout_s),
            MockAdapter(),
        )
    return MockAdapter()


@lru_cache
def llm_settings() -> LLMSettings:
    return LLMSettings()
