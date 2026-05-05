"""
Notification inbox for CoPanel.

A unified, persisted store of user-visible notifications (info, success,
warning, error). Modules call ``notify(...)`` and the frontend Notification
Center subscribes to the ``notifications`` SSE topic to display toasts and
maintain an inbox.
"""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from typing import Any, Dict, List, Optional

from .events import bus
from .user_model import get_db_connection

LEVELS = ("info", "success", "warning", "error")


def init_notifications_table() -> None:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                ts INTEGER NOT NULL,
                level TEXT NOT NULL DEFAULT 'info',
                module TEXT,
                title TEXT NOT NULL,
                body TEXT,
                actor TEXT,
                action_url TEXT,
                read INTEGER NOT NULL DEFAULT 0,
                meta TEXT
            );
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_notif_ts ON notifications(ts DESC);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read, ts DESC);")
        conn.commit()
    finally:
        conn.close()


def notify(
    title: str,
    *,
    level: str = "info",
    body: Optional[str] = None,
    module: Optional[str] = None,
    actor: Optional[str] = None,
    action_url: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if level not in LEVELS:
        level = "info"
    nid = str(uuid.uuid4())
    ts = int(time.time() * 1000)
    record = {
        "id": nid,
        "ts": ts,
        "level": level,
        "module": module,
        "title": title,
        "body": body,
        "actor": actor,
        "action_url": action_url,
        "read": 0,
        "meta": meta,
    }
    try:
        conn = get_db_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO notifications
                    (id, ts, level, module, title, body, actor, action_url, read, meta)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    nid,
                    ts,
                    level,
                    module,
                    title,
                    body,
                    actor,
                    action_url,
                    0,
                    json.dumps(meta) if meta else None,
                ),
            )
            conn.commit()
        finally:
            conn.close()
    except sqlite3.Error:
        pass
    bus.publish_sync("notifications", {"event": "new", "notification": record})
    return record


def list_notifications(*, limit: int = 50, only_unread: bool = False) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        if only_unread:
            cur.execute(
                "SELECT * FROM notifications WHERE read = 0 ORDER BY ts DESC LIMIT ?",
                (int(limit),),
            )
        else:
            cur.execute(
                "SELECT * FROM notifications ORDER BY ts DESC LIMIT ?",
                (int(limit),),
            )
        rows = cur.fetchall()
        out = []
        for r in rows:
            row = dict(r)
            if row.get("meta"):
                try:
                    row["meta"] = json.loads(row["meta"])
                except json.JSONDecodeError:
                    pass
            out.append(row)
        return out
    finally:
        conn.close()


def mark_read(ids: List[str]) -> int:
    if not ids:
        return 0
    placeholders = ",".join("?" * len(ids))
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE notifications SET read = 1 WHERE id IN ({placeholders})",
            ids,
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def mark_all_read() -> int:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE notifications SET read = 1 WHERE read = 0")
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def unread_count() -> int:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM notifications WHERE read = 0")
        row = cur.fetchone()
        return int(row[0]) if row else 0
    finally:
        conn.close()


init_notifications_table()
