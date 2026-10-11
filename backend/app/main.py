import logging
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.ai.provider import llm_settings, warmup
from app.ai.types import LLMError
from app.api import health, models, reports, sessions, tutor

log = logging.getLogger("holoforge")


def _warmup() -> None:
    try:
        ms = warmup(llm_settings())
    except LLMError as err:
        log.warning("LLM 워밍업 실패(첫 질문 때 로딩): %s", err)
        return
    if ms is not None:
        log.warning("LLM 워밍업 완료: %.0f ms", ms)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # 기동을 막지 않도록 백그라운드에서 예열한다
    threading.Thread(target=_warmup, name="llm-warmup", daemon=True).start()
    yield


app = FastAPI(title="HoloForge AI Lab", version="0.1.0", lifespan=lifespan)
app.include_router(health.router, prefix="/api")
app.include_router(models.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(tutor.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
