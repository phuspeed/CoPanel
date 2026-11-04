"""Short-lived, single-use tickets for EventSource / WebSocket auth.

Browsers cannot attach ``Authorization`` headers to EventSource or WebSocket
upgrades. Putting the 24h JWT in the query string leaks it into nginx access
logs, proxies and browser history. Instead the SPA POSTs (with its Bearer
header) to ``/api/auth/stream-ticket`` and receives an opaque random ticket
that lives ~60 seconds, is consumed on first use, and is bound to the user's
``token_version`` (logout / password change invalidates outstanding tickets).
Tickets are kept in process memory only.
"""
from __future__ import annotations

import secrets
import threading
import time
from typing import Any, Dict, Optional, Tuple

TICKET_TTL_SECONDS = 60
_MAX_TICKETS = 10_000

_lock = threading.Lock()
# ticket -> (expires_at_monotonic, username, token_version)
_tickets: Dict[str, Tuple[float, str, int]] = {}


def _purge_expired(now: float) -> None:
    for key in [k for k, v in _tickets.items() if v[0] <= now]:
        _tickets.pop(key, None)


def issue_ticket(user: Dict[str, Any], ttl: int = TICKET_TTL_SECONDS) -> str:
    """Create a ticket for ``user`` and return it."""
    ticket = secrets.token_urlsafe(32)
    now = time.monotonic()
    with _lock:
        _purge_expired(now)
        if len(_tickets) >= _MAX_TICKETS:
            # Drop the oldest-expiring entries to bound memory.
            for key, _ in sorted(_tickets.items(), key=lambda kv: kv[1][0])[: len(_tickets) - _MAX_TICKETS + 1]:
                _tickets.pop(key, None)
        _tickets[ticket] = (
            now + ttl,
            str(user.get("username") or ""),
            int(user.get("token_version") or 0),
        )
    return ticket


def consume_ticket(ticket: Optional[str]) -> Optional[Dict[str, Any]]:
    """Validate + consume ``ticket``; return the current user or ``None``."""
    if not ticket or not isinstance(ticket, str) or len(ticket) > 128:
        return None
    now = time.monotonic()
    with _lock:
        entry = _tickets.pop(ticket, None)
        _purge_expired(now)
    if entry is None:
        return None
    expires_at, username, token_version = entry
    if expires_at <= now or not username:
        return None
    from . import user_model

    user = user_model.get_user_by_username(username)
    if not user:
        return None
    try:
        if int(user.get("token_version") or 0) != token_version:
            return None
    except (TypeError, ValueError):
        return None
    return user


def clear_tickets() -> None:
    """Test helper."""
    with _lock:
        _tickets.clear()
