"""Redact secrets from job payloads/results returned over the API."""
from __future__ import annotations

import copy
import re
from typing import Any, Dict, List, Optional

_SECRET_KEY_RE = re.compile(
    r"(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|auth)",
    re.IGNORECASE,
)

_REDACTED = "***"


def _should_redact_key(key: str) -> bool:
    return bool(_SECRET_KEY_RE.search(key))


def redact_value(obj: Any) -> Any:
    """Deep-copy ``obj`` and replace values under sensitive keys."""
    if isinstance(obj, dict):
        out: Dict[str, Any] = {}
        for key, val in obj.items():
            if _should_redact_key(str(key)):
                out[key] = _REDACTED if val is not None else None
            else:
                out[key] = redact_value(val)
        return out
    if isinstance(obj, list):
        return [redact_value(item) for item in obj]
    return obj


def redact_job_row(row: Dict[str, Any], *, include_logs: bool = False) -> Dict[str, Any]:
    """Return a API-safe job dict (payload/result redacted; logs optional)."""
    data = dict(row)
    if data.get("payload") is not None:
        data["payload"] = redact_value(data["payload"])
    if data.get("result") is not None:
        data["result"] = redact_value(data["result"])
    if not include_logs:
        data.pop("logs", None)
    elif data.get("logs"):
        data["logs"] = redact_value(data["logs"])
    return data


def user_may_access_job(user: Dict[str, Any], job: Dict[str, Any]) -> bool:
    if user.get("role") == "superadmin":
        return True
    actor = (job.get("actor") or "").strip()
    username = (user.get("username") or "").strip()
    return bool(actor and username and actor == username)
