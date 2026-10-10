"""세션 상태 저장소 (SQLite, stdlib)."""

import sqlite3
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import TypeVar

from app.assembly.schemas import AssemblyState

T = TypeVar("T")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""


class SessionNotFound(KeyError):
    pass


def _now() -> str:
    return datetime.now(UTC).isoformat()


class SessionStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        with self._connect() as conn:
            conn.execute(_SCHEMA)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, isolation_level=None, timeout=5)
        try:
            yield conn
        finally:
            conn.close()

    def create(self, model_id: str) -> str:
        session_id = uuid.uuid4().hex
        now = _now()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
                (session_id, model_id, AssemblyState().model_dump_json(), now, now),
            )
        return session_id

    def get(self, session_id: str) -> tuple[str, AssemblyState]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT model_id, state_json FROM sessions WHERE id = ?", (session_id,)
            ).fetchone()
        if row is None:
            raise SessionNotFound(session_id)
        return row[0], AssemblyState.model_validate_json(row[1])

    def update(self, session_id: str, fn: Callable[[str, AssemblyState], T]) -> T:
        """상태를 읽고 fn으로 변경한 뒤 같은 트랜잭션에서 저장한다."""
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute(
                    "SELECT model_id, state_json FROM sessions WHERE id = ?", (session_id,)
                ).fetchone()
                if row is None:
                    raise SessionNotFound(session_id)
                state = AssemblyState.model_validate_json(row[1])
                out = fn(row[0], state)
                conn.execute(
                    "UPDATE sessions SET state_json = ?, updated_at = ? WHERE id = ?",
                    (state.model_dump_json(), _now(), session_id),
                )
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
        return out
