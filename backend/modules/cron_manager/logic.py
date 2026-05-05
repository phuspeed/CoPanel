"""
Cron Manager logic.

Persists CoPanel-managed jobs in SQLite under ``/opt/copanel/config`` and
syncs them to system crontab on Linux. This gives us a single source of truth
for settings while still executing through native cron.
"""
from __future__ import annotations

import os
import sqlite3
import shutil
import subprocess
import uuid
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List

IS_WINDOWS = os.name == "nt"

MARKER = "# copanel-id="
BLOCK_START = "# BEGIN COPANEL CRON"
BLOCK_END = "# END COPANEL CRON"
DB_PATH = Path("./test_nginx/cron_manager.db") if IS_WINDOWS else Path("/opt/copanel/config/cron_manager.db")


def _has_crontab() -> bool:
    return not IS_WINDOWS and shutil.which("crontab") is not None


def _db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    with _db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cron_jobs (
                id TEXT PRIMARY KEY,
                minute TEXT NOT NULL,
                hour TEXT NOT NULL,
                day TEXT NOT NULL,
                month TEXT NOT NULL,
                weekday TEXT NOT NULL,
                command TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(cron_jobs)").fetchall()]
        if "is_active" not in cols:
            conn.execute("ALTER TABLE cron_jobs ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")


def _read_crontab() -> str:
    if not _has_crontab():
        return ""
    res = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    if res.returncode != 0:
        return ""
    return res.stdout


def _write_crontab(content: str) -> None:
    if not _has_crontab():
        return
    proc = subprocess.run(["crontab", "-"], input=content, text=True, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "Failed to write crontab")


def _parse_manual_lines(raw: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    in_copanel_block = False
    for line in raw.splitlines():
        line = line.rstrip("\n")
        if line.strip() == BLOCK_START:
            in_copanel_block = True
            continue
        if line.strip() == BLOCK_END:
            in_copanel_block = False
            continue
        if in_copanel_block:
            continue
        if not line or line.startswith("#"):
            continue
        if MARKER in line:
            # Ignore legacy unmanaged parsing of tagged lines; managed lines come from DB.
            continue
        parts = line.split(maxsplit=5)
        if len(parts) < 6:
            continue
        out.append({
            "id": None,
            "minute": parts[0],
            "hour": parts[1],
            "day": parts[2],
            "month": parts[3],
            "weekday": parts[4],
            "command": parts[5],
            "managed": False,
        })
    return out


def _cron_line(job: Dict[str, Any]) -> str:
    return (
        f"{job['minute']} {job['hour']} {job['day']} {job['month']} {job['weekday']} "
        f"{job['command']} {MARKER}{job['id']}"
    )


def _sync_managed_crontab() -> None:
    if not _has_crontab():
        return
    with _db() as conn:
        rows = conn.execute(
            """
            SELECT id, minute, hour, day, month, weekday, command
            FROM cron_jobs
            WHERE is_active = 1
            ORDER BY created_at DESC
            """
        ).fetchall()
    managed_lines = [_cron_line(dict(r)) for r in rows]

    existing = _read_crontab().splitlines()
    keep: List[str] = []
    in_copanel_block = False
    for line in existing:
        if line.strip() == BLOCK_START:
            in_copanel_block = True
            continue
        if line.strip() == BLOCK_END:
            in_copanel_block = False
            continue
        if not in_copanel_block:
            keep.append(line)

    if managed_lines:
        keep.extend([BLOCK_START, *managed_lines, BLOCK_END])
    content = "\n".join(keep).rstrip() + ("\n" if keep else "")
    _write_crontab(content)


def list_jobs() -> List[Dict[str, Any]]:
    _init_db()
    with _db() as conn:
        rows = conn.execute(
            """
            SELECT id, minute, hour, day, month, weekday, command, is_active
            FROM cron_jobs
            ORDER BY created_at DESC
            """
        ).fetchall()
    managed = [{**dict(r), "managed": True, "is_active": bool(r["is_active"])} for r in rows]
    manual = _parse_manual_lines(_read_crontab())
    return managed + manual


def add_job(schedule: Dict[str, str], command: str) -> Dict[str, Any]:
    _init_db()
    if not command or not command.strip():
        raise ValueError("Command is required.")
    cid = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    job = {
        "id": cid,
        "minute": schedule.get("minute", "*"),
        "hour": schedule.get("hour", "*"),
        "day": schedule.get("day", "*"),
        "month": schedule.get("month", "*"),
        "weekday": schedule.get("weekday", "*"),
        "command": command.strip(),
    }
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO cron_jobs (id, minute, hour, day, month, weekday, command, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job["id"],
                job["minute"],
                job["hour"],
                job["day"],
                job["month"],
                job["weekday"],
                job["command"],
                1,
                now,
                now,
            ),
        )
    _sync_managed_crontab()
    return {**job, "managed": True, "is_active": True}


def remove_job(cid: str) -> bool:
    _init_db()
    removed = False
    with _db() as conn:
        cur = conn.execute("DELETE FROM cron_jobs WHERE id = ?", (cid,))
        removed = cur.rowcount > 0
    if removed:
        _sync_managed_crontab()
    return removed


def set_job_active(cid: str, active: bool) -> bool:
    _init_db()
    now = datetime.utcnow().isoformat()
    with _db() as conn:
        cur = conn.execute(
            "UPDATE cron_jobs SET is_active = ?, updated_at = ? WHERE id = ?",
            (1 if active else 0, now, cid),
        )
        changed = cur.rowcount > 0
    if changed:
        _sync_managed_crontab()
    return changed


_init_db()
