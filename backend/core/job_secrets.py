"""Redact secrets from job payloads/results returned by the platform jobs API."""
from __future__ import annotations

import copy
import re
from typing import Any, Dict, Optional

_SECRET_KEY_RE = re.compile(
    r"(password|passwd|secret|credential|api[_-]?key|private[_-]?key|token)$",
    re.IGNORECASE,
)


def _is_secret_key(key: str) -> bool:
    if not isinstance(key, str):
        return False
    lowered = key.lower()
    if lowered in {"password", "database_password", "admin_password", "db_password"}:
        return True
    return bool(_SECRET_KEY_RE.search(lowered))


def redact_secrets(value: Any) -> Any:
    """Return a copy of ``value`` with known secret fields replaced by ``***``."""
    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for key, item in value.items():
            if _is_secret_key(key):
                out[key] = "***" if item not in (None, "") else item
            else:
                out[key] = redact_secrets(item)
        return out
    if isinstance(value, list):
        return [redact_secrets(item) for item in value]
    return value


def job_visible_to_user(job: Dict[str, Any], user: Dict[str, Any]) -> bool:
    """Superadmin sees all jobs; others only jobs they started (``actor`` username)."""
    if user.get("role") == "superadmin":
        return True
    actor = (job.get("actor") or "").strip()
    username = (user.get("username") or "").strip()
    return bool(actor and username and actor == username)


def sanitize_job_for_api(job: Dict[str, Any], *, include_logs: bool = False) -> Dict[str, Any]:
    data = copy.deepcopy(job)
    for field in ("payload", "result"):
        if field in data and data[field] is not None:
            data[field] = redact_secrets(data[field])
    if not include_logs:
        data.pop("logs", None)
    elif "logs" in data and data["logs"]:
        data["logs"] = redact_secrets(data["logs"])
    return data
