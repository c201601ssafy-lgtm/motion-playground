from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.assembly.engine import AssemblyEngine
from app.assembly.schemas import (
    AssemblyResult,
    AssemblySnapshot,
    AssemblyState,
    AttemptRequest,
    MechanismState,
)
from app.core.config import settings
from app.core.db import SessionNotFound, SessionStore
from app.core.model_loader import get_model

router = APIRouter(prefix="/sessions")


@lru_cache
def get_store() -> SessionStore:
    return SessionStore(settings.db_path)


Store = Annotated[SessionStore, Depends(get_store)]


class CreateSessionRequest(BaseModel):
    model_id: str = "gearbox"


class SessionOut(BaseModel):
    session_id: str
    model_id: str
    snapshot: AssemblySnapshot


class AttemptOut(BaseModel):
    result: AssemblyResult
    snapshot: AssemblySnapshot


class ResetOut(BaseModel):
    removed: list[str]
    snapshot: AssemblySnapshot


def _engine(model_id: str, state: AssemblyState) -> AssemblyEngine:
    return AssemblyEngine(get_model(model_id), state)


def _not_found(session_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"session {session_id} not found")


@router.post("", status_code=201)
def create_session(body: CreateSessionRequest, store: Store) -> SessionOut:
    try:
        get_model(body.model_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="model not found") from None
    sid = store.create(body.model_id)
    return SessionOut(
        session_id=sid,
        model_id=body.model_id,
        snapshot=_engine(body.model_id, AssemblyState()).snapshot(),
    )


@router.get("/{session_id}")
def read_session(session_id: str, store: Store) -> SessionOut:
    try:
        model_id, state = store.get(session_id)
    except SessionNotFound:
        raise _not_found(session_id) from None
    return SessionOut(
        session_id=session_id, model_id=model_id, snapshot=_engine(model_id, state).snapshot()
    )


@router.post("/{session_id}/attempt")
def attempt(session_id: str, body: AttemptRequest, store: Store) -> AttemptOut:
    def run(model_id: str, state: AssemblyState) -> AttemptOut:
        engine = _engine(model_id, state)
        result = engine.attempt(body)
        return AttemptOut(result=result, snapshot=engine.snapshot())

    try:
        return store.update(session_id, run)
    except SessionNotFound:
        raise _not_found(session_id) from None


@router.post("/{session_id}/reset-step")
def reset_step(session_id: str, store: Store) -> ResetOut:
    def run(model_id: str, state: AssemblyState) -> ResetOut:
        engine = _engine(model_id, state)
        removed = engine.reset_step()
        return ResetOut(removed=removed, snapshot=engine.snapshot())

    try:
        return store.update(session_id, run)
    except SessionNotFound:
        raise _not_found(session_id) from None


@router.post("/{session_id}/assemble-all")
def assemble_all(session_id: str, store: Store) -> AssemblySnapshot:
    """데모용 자동 조립."""

    def run(model_id: str, state: AssemblyState) -> AssemblySnapshot:
        engine = _engine(model_id, state)
        engine.assemble_all()
        return engine.snapshot()

    try:
        return store.update(session_id, run)
    except SessionNotFound:
        raise _not_found(session_id) from None


@router.get("/{session_id}/mechanism")
def mechanism(
    session_id: str,
    store: Store,
    input_rpm: Annotated[float, Query(ge=-600, le=600)] = 30.0,
) -> MechanismState:
    try:
        model_id, state = store.get(session_id)
    except SessionNotFound:
        raise _not_found(session_id) from None
    return _engine(model_id, state).mechanism_state(input_rpm)
