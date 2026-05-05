"""
Lightweight audit log for CoPanel administrative actions.

Persists to the same SQLite database used by ``user_model``. Every important
mutating action (create site, restart service, change SSL cert, restore
backup, ...) should call ``record_audit(...)``.
"""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from typing import Any, Dict, Iterable, Optional

from .user_model import get_db_connection


def init_audit_table() -> None:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                actor TEXT,
                actor_id INTEGER,
                module TEXT,
                action TEXT NOT NULL,
                target TEXT,
                status TEXT NOT NULL DEFAULT 'success',
                request_id TEXT,
                ip TEXT,
                meta TEXT
            );
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_log(module, ts DESC);"
        )
        conn.commit()
    finally:
        conn.close()


def record_audit(
    action: str,
    *,
    module: Optional[str] = None,
    target: Optional[str] = None,
    actor: Optional[str] = None,
    actor_id: Optional[int] = None,
    status: str = "success",
    request_id: Optional[str] = None,
    ip: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> int:
    """Insert an audit record. Returns the row id.

    This function is intentionally robust: any failure to write an audit row
    must NOT break the parent request.
    """
    try:
        conn = get_db_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO audit_log
                    (ts, actor, actor_id, module, action, target, status,
                     request_id, ip, meta)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    int(time.time()),
                    actor,
                    actor_id,
                    module,
                    action,
                    target,
                    status,
                    request_id,
                    ip,
                    json.dumps(meta) if meta else None,
                ),
            )
            conn.commit()
            return int(cur.lastrowid or 0)
        finally:
            conn.close()
    except sqlite3.Error:
        return 0


def query_audit(
    *,
    module: Optional[str] = None,
    actor: Optional[str] = None,
    limit: int = 100,
    before_id: Optional[int] = None,
) -> Iterable[Dict[str, Any]]:
    """Return recent audit rows filtered by optional module/actor.

    Results are returned newest-first.
    """
    conn = get_db_connection()
    try:
        clauses = []
        params: list = []
        if module:
            clauses.append("module = ?")
            params.append(module)
        if actor:
            clauses.append("actor = ?")
            params.append(actor)
        if before_id is not None:
            clauses.append("id < ?")
            params.append(before_id)

        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        params.append(int(limit))
        cur = conn.cursor()
        cur.execute(
            f"SELECT * FROM audit_log {where} ORDER BY id DESC LIMIT ?",
            params,
        )
        rows = cur.fetchall()
        result = []
        for r in rows:
            row = dict(r)
            if row.get("meta"):
                try:
                    row["meta"] = json.loads(row["meta"])
                except json.JSONDecodeError:
                    pass
            result.append(row)
        return result
    finally:
        conn.close()


@contextmanager
def audit_block(
    action: str,
    *,
    module: Optional[str] = None,
    target: Optional[str] = None,
    actor: Optional[str] = None,
    actor_id: Optional[int] = None,
    request_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
):
    """Context manager that records ``success`` on clean exit, ``error`` on raise.

    Example:
        with audit_block("site.create", module="web_manager", target=domain, actor=user["username"]):
            do_create(...)
    """
    try:
        yield
    except Exception as exc:
        record_audit(
            action,
            module=module,
            target=target,
            actor=actor,
            actor_id=actor_id,
            status="error",
            request_id=request_id,
            meta={**(meta or {}), "error": str(exc)},
        )
        raise
    else:
        record_audit(
            action,
            module=module,
            target=target,
            actor=actor,
            actor_id=actor_id,
            status="success",
            request_id=request_id,
            meta=meta,
        )


init_audit_table()
