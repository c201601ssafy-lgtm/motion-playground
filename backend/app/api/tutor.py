from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.ai.provider import FallbackAdapter, build_adapter, llm_settings
from app.ai.tutor import TutorRequest, TutorResponse, answer
from app.ai.types import LLMAdapter
from app.api.sessions import Store
from app.core.db import SessionNotFound
from app.tools.registry import ToolContext

router = APIRouter(prefix="/sessions")


def get_llm() -> LLMAdapter | FallbackAdapter:
    # 요청마다 새로 만든다: 폴백(degraded) 상태가 요청 간에 새지 않도록
    return build_adapter(llm_settings())


LLM = Annotated[LLMAdapter | FallbackAdapter, Depends(get_llm)]


@router.post("/{session_id}/tutor")
def tutor(session_id: str, body: TutorRequest, store: Store, llm: LLM) -> TutorResponse:
    try:
        model_id, _ = store.get(session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail=f"session {session_id} not found") from None
    ctx = ToolContext(session_id=session_id, store=store, model_id=model_id)
    out = answer(body, ctx, llm)
    store.log_event(
        session_id,
        "tutor",
        {
            "question": body.question,
            "tools": [u.name for u in out.used_tools],
            "warnings": out.warnings,
            "provider": out.provider,
            "degraded": out.degraded,
            "latency_ms": out.latency_ms,
        },
    )
    return out
