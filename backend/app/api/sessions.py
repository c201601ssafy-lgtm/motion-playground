from datetime import datetime
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


class EventSummary(BaseModel):
    attempts: int
    valid: int
    errors: int
    too_far: int
    by_error_type: dict[str, int]
    resets: int
    auto_assembled: bool
    first_attempt_at: str | None
    completed_at: str | None
    duration_s: float | None


class EventsOut(BaseModel):
    events: list[dict]
    summary: EventSummary


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
    store.log_event(sid, "session_created", {"model_id": body.model_id})
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
        out = store.update(session_id, run)
    except SessionNotFound:
        raise _not_found(session_id) from None
    r = out.result
    store.log_event(
        session_id,
        "attempt",
        {
            "part_id": r.part_id,
            "is_valid": r.is_valid,
            "error_type": r.error_type,
            "target_slot": r.target_slot,
            "distance": r.distance,
            "parts_placed": out.snapshot.parts_placed,
            "assembly_complete": out.snapshot.is_complete,
        },
    )
    return out


@router.post("/{session_id}/reset-step")
def reset_step(session_id: str, store: Store) -> ResetOut:
    def run(model_id: str, state: AssemblyState) -> ResetOut:
        engine = _engine(model_id, state)
        removed = engine.reset_step()
        return ResetOut(removed=removed, snapshot=engine.snapshot())

    try:
        out = store.update(session_id, run)
    except SessionNotFound:
        raise _not_found(session_id) from None
    store.log_event(session_id, "reset_step", {"removed": out.removed})
    return out


@router.post("/{session_id}/assemble-all")
def assemble_all(session_id: str, store: Store) -> AssemblySnapshot:
    """데모용 자동 조립."""

    def run(model_id: str, state: AssemblyState) -> AssemblySnapshot:
        engine = _engine(model_id, state)
        engine.assemble_all()
        return engine.snapshot()

    try:
        out = store.update(session_id, run)
    except SessionNotFound:
        raise _not_found(session_id) from None
    store.log_event(session_id, "assemble_all", {})
    return out


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


def summarize(events: list[dict]) -> EventSummary:
    """시도 = TOO_FAR(조립 시도 아님)를 뺀 판정 횟수."""
    attempts = [e for e in events if e["kind"] == "attempt" and e.get("error_type") != "TOO_FAR"]
    by_type: dict[str, int] = {}
    for e in attempts:
        if not e["is_valid"]:
            by_type[e["error_type"]] = by_type.get(e["error_type"], 0) + 1
    first = attempts[0]["ts"] if attempts else None
    done = next(
        (e["ts"] for e in events if e["kind"] == "attempt" and e.get("assembly_complete")), None
    )
    duration = None
    if first and done:
        duration = round(
            (datetime.fromisoformat(done) - datetime.fromisoformat(first)).total_seconds(), 2
        )
    return EventSummary(
        attempts=len(attempts),
        valid=sum(1 for e in attempts if e["is_valid"]),
        errors=sum(by_type.values()),
        too_far=sum(1 for e in events if e.get("error_type") == "TOO_FAR"),
        by_error_type=by_type,
        resets=sum(1 for e in events if e["kind"] == "reset_step"),
        auto_assembled=any(e["kind"] == "assemble_all" for e in events),
        first_attempt_at=first,
        completed_at=done,
        duration_s=duration,
    )


@router.get("/{session_id}/events")
def read_events(session_id: str, store: Store) -> EventsOut:
    try:
        store.get(session_id)
    except SessionNotFound:
        raise _not_found(session_id) from None
    events = store.events(session_id)
    return EventsOut(events=events, summary=summarize(events))
