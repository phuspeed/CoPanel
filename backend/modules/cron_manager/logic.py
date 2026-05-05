"""
Cron Manager logic.

Reads/writes the system crontab via the ``crontab`` command. Each entry is
identified by a stable comment marker (``# copanel-id=<uuid>``) so we can
edit/remove a single line without touching ones the user added by hand.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import uuid
from typing import Any, Dict, List, Optional

IS_WINDOWS = os.name == "nt"

# Track CoPanel-managed jobs by tagging the line with this comment marker.
MARKER = "# copanel-id="


def _has_crontab() -> bool:
    return not IS_WINDOWS and shutil.which("crontab") is not None


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


def _parse_lines(raw: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for line in raw.splitlines():
        line = line.rstrip("\n")
        if not line or line.startswith("#") and MARKER not in line:
            continue
        marker_match = re.search(r"copanel-id=([a-f0-9-]+)", line)
        cid = marker_match.group(1) if marker_match else None
        body = re.sub(r"\s*" + re.escape(MARKER) + r"[a-f0-9-]+\s*$", "", line)
        parts = body.split(maxsplit=5)
        if len(parts) < 6:
            continue
        out.append({
            "id": cid,
            "minute": parts[0],
            "hour": parts[1],
            "day": parts[2],
            "month": parts[3],
            "weekday": parts[4],
            "command": parts[5],
            "managed": cid is not None,
        })
    return out


def list_jobs() -> List[Dict[str, Any]]:
    return _parse_lines(_read_crontab())


def add_job(schedule: Dict[str, str], command: str) -> Dict[str, Any]:
    if not command or not command.strip():
        raise ValueError("Command is required.")
    cid = str(uuid.uuid4())
    entry = (
        f"{schedule.get('minute', '*')} "
        f"{schedule.get('hour', '*')} "
        f"{schedule.get('day', '*')} "
        f"{schedule.get('month', '*')} "
        f"{schedule.get('weekday', '*')} "
        f"{command.strip()} {MARKER}{cid}"
    )
    raw = _read_crontab()
    raw = (raw.rstrip() + "\n" + entry + "\n") if raw.strip() else (entry + "\n")
    _write_crontab(raw)
    return {"id": cid, **schedule, "command": command, "managed": True}


def remove_job(cid: str) -> bool:
    raw = _read_crontab()
    keep: List[str] = []
    removed = False
    for line in raw.splitlines():
        if MARKER + cid in line:
            removed = True
            continue
        keep.append(line)
    if removed:
        _write_crontab("\n".join(keep) + ("\n" if keep else ""))
    return removed
