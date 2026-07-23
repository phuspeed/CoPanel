"""One-time pending ACTION store for human-in-the-loop confirmation."""
from __future__ import annotations

import secrets
import threading
import time
from typing import Any, Dict, List, Optional

_LOCK = threading.Lock()
_STORE: Dict[str, Dict[str, Any]] = {}
DEFAULT_TTL_SECONDS = 600  # 10 minutes


def create_pending(
    *,
    tool: str,
    args: Dict[str, Any],
    title: str,
    command_preview: str,
    risk: str = "medium",
    created_by: Optional[str] = None,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
) -> Dict[str, Any]:
    action_id = secrets.token_urlsafe(24)
    now = time.time()
    entry = {
        "action_id": action_id,
        "tool": tool,
        "args": args,
        "title": title,
        "command_preview": command_preview,
        "risk": risk,
        "created_by": created_by,
        "created_at": now,
        "expires_at": now + ttl_seconds,
    }
    with _LOCK:
        _purge_expired_unlocked(now)
        _STORE[action_id] = entry
    return {
        "action_id": action_id,
        "tool": tool,
        "args": args,
        "title": title,
        "command_preview": command_preview,
        "risk": risk,
    }


def get_pending(action_id: str) -> Optional[Dict[str, Any]]:
    with _LOCK:
        _purge_expired_unlocked(time.time())
        entry = _STORE.get(action_id)
        return dict(entry) if entry else None


def consume_pending(action_id: str) -> Optional[Dict[str, Any]]:
    """Return and remove a pending action (one-time use)."""
    with _LOCK:
        _purge_expired_unlocked(time.time())
        entry = _STORE.pop(action_id, None)
        return dict(entry) if entry else None


def cancel_pending(action_id: str) -> bool:
    with _LOCK:
        return _STORE.pop(action_id, None) is not None


def list_pending_for_user(username: Optional[str] = None) -> List[Dict[str, Any]]:
    with _LOCK:
        _purge_expired_unlocked(time.time())
        out = []
        for entry in _STORE.values():
            if username and entry.get("created_by") not in (None, username):
                continue
            out.append(
                {
                    "action_id": entry["action_id"],
                    "tool": entry["tool"],
                    "args": entry["args"],
                    "title": entry["title"],
                    "command_preview": entry["command_preview"],
                    "risk": entry["risk"],
                    "expires_at": entry["expires_at"],
                }
            )
        return out


def _purge_expired_unlocked(now: float) -> None:
    expired = [k for k, v in _STORE.items() if float(v.get("expires_at") or 0) < now]
    for k in expired:
        _STORE.pop(k, None)
