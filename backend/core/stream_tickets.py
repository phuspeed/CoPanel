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
from collections import OrderedDict, deque
from typing import Any, Callable, Deque, Dict, Optional, Tuple

TICKET_TTL_SECONDS = 60
_MAX_TICKETS = 10_000
# Outstanding (unused, unexpired) tickets one user may hold; the user's own
# oldest ticket is dropped first, never another user's.
MAX_TICKETS_PER_USER = 20
# Issue rate limit per user.
RATE_LIMIT_COUNT = 60
RATE_LIMIT_WINDOW_S = 60.0
# How often long-lived streams re-check that the session is still valid.
REVALIDATE_INTERVAL_S = 30.0


class TicketRateLimited(Exception):
    """Too many tickets requested (per-user rate or global capacity)."""


_lock = threading.Lock()
# ticket -> (expires_at_monotonic, username, token_version); insertion ordered
_tickets: "OrderedDict[str, Tuple[float, str, int]]" = OrderedDict()
_per_user: Dict[str, "OrderedDict[str, None]"] = {}
_issued_at: Dict[str, Deque[float]] = {}


def _drop(ticket: str) -> Optional[Tuple[float, str, int]]:
    entry = _tickets.pop(ticket, None)
    if entry is not None:
        mine = _per_user.get(entry[1])
        if mine is not None:
            mine.pop(ticket, None)
            if not mine:
                _per_user.pop(entry[1], None)
    return entry


def _purge_expired(now: float) -> None:
    # Tickets share one TTL, so insertion order is expiry order.
    while _tickets:
        key, value = next(iter(_tickets.items()))
        if value[0] > now:
            break
        _drop(key)


def issue_ticket(user: Dict[str, Any], ttl: int = TICKET_TTL_SECONDS) -> str:
    """Create a ticket for ``user`` and return it.

    Raises ``TicketRateLimited`` when the user asks too often or the store is
    full (other users' tickets are never evicted).
    """
    username = str(user.get("username") or "")
    ticket = secrets.token_urlsafe(32)
    now = time.monotonic()
    with _lock:
        _purge_expired(now)
        stamps = _issued_at.setdefault(username, deque())
        while stamps and now - stamps[0] > RATE_LIMIT_WINDOW_S:
            stamps.popleft()
        if len(stamps) >= RATE_LIMIT_COUNT:
            raise TicketRateLimited("Too many stream tickets requested; slow down.")
        if len(_tickets) >= _MAX_TICKETS:
            raise TicketRateLimited("Stream ticket store is full; try again shortly.")
        mine = _per_user.setdefault(username, OrderedDict())
        while len(mine) >= MAX_TICKETS_PER_USER:
            oldest = next(iter(mine))
            _drop(oldest)
            mine = _per_user.setdefault(username, OrderedDict())
        stamps.append(now)
        _tickets[ticket] = (now + ttl, username, int(user.get("token_version") or 0))
        mine[ticket] = None
        if len(_issued_at) > 4 * _MAX_TICKETS:
            for key in [k for k, v in _issued_at.items() if not v or now - v[-1] > RATE_LIMIT_WINDOW_S]:
                _issued_at.pop(key, None)
    return ticket


def consume_ticket(ticket: Optional[str]) -> Optional[Dict[str, Any]]:
    """Validate + consume ``ticket``; return the current user or ``None``."""
    if not ticket or not isinstance(ticket, str) or len(ticket) > 128:
        return None
    now = time.monotonic()
    with _lock:
        entry = _drop(ticket)
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


def session_still_valid(user: Optional[Dict[str, Any]]) -> bool:
    """True while ``user`` exists and its ``token_version`` is unchanged.

    Logout-all, password change and user deletion bump or remove the record,
    so long-lived SSE / WebSocket sessions call this periodically and close.
    """
    if not user or not user.get("username"):
        return False
    if user.get("id") == 0 and user.get("username") == "dev":
        return True  # COPANEL_DISABLE_AUTH dev user
    from . import user_model

    current = user_model.get_user_by_username(str(user["username"]))
    if not current:
        return False
    try:
        return int(current.get("token_version") or 0) == int(user.get("token_version") or 0)
    except (TypeError, ValueError):
        return False


def revalidator(user: Optional[Dict[str, Any]]) -> Callable[[], bool]:
    return lambda: session_still_valid(user)


def revoke_user_tickets(username: str) -> int:
    """Drop every outstanding ticket of ``username`` (logout)."""
    with _lock:
        mine = list(_per_user.get(str(username or ""), {}))
        for t in mine:
            _drop(t)
    return len(mine)


# ----- Path-scoped media tokens ----------------------------------------------
#
# <audio>/<img> elements fetch the same URL several times (range requests,
# seeking, re-renders), so a single-use ticket does not work there. A media
# token is an HMAC-signed, reusable value that is valid only for one URL path
# prefix, for at most MEDIA_TOKEN_TTL_SECONDS, and only while the user's
# ``token_version`` is unchanged (logout / password change revokes it). It is
# not a JWT and cannot call any other API. The key is per process, so a
# restart also revokes every media token.

import base64 as _b64
import hashlib as _hashlib
import hmac as _hmac
import json as _json

MEDIA_TOKEN_TTL_SECONDS = 2 * 3600
MEDIA_SCOPES = (
    "/api/audio_station/stream",
    "/api/audio_station/cover",
)
_MEDIA_KEY = secrets.token_bytes(32)


def _b64e(raw: bytes) -> str:
    return _b64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(text: str) -> bytes:
    return _b64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def media_scope_module(scope: str) -> Optional[str]:
    parts = scope.strip("/").split("/")
    return parts[1] if len(parts) >= 2 and parts[0] == "api" else None


def issue_media_token(user: Dict[str, Any], scope: str, ttl: int = MEDIA_TOKEN_TTL_SECONDS) -> str:
    """Signed reusable token for ``scope`` (one of ``MEDIA_SCOPES``)."""
    if scope not in MEDIA_SCOPES:
        raise ValueError("Unknown media scope.")
    username = str(user.get("username") or "")
    now = time.monotonic()
    with _lock:
        stamps = _issued_at.setdefault(username, deque())
        while stamps and now - stamps[0] > RATE_LIMIT_WINDOW_S:
            stamps.popleft()
        if len(stamps) >= RATE_LIMIT_COUNT:
            raise TicketRateLimited("Too many stream tickets requested; slow down.")
        stamps.append(now)
    payload = {
        "u": username,
        "v": int(user.get("token_version") or 0),
        "s": scope,
        "e": int(time.time()) + int(ttl),
    }
    body = _b64e(_json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    sig = _b64e(_hmac.new(_MEDIA_KEY, body.encode(), _hashlib.sha256).digest())
    return f"{body}.{sig}"


def user_from_media_token(token: Optional[str], path: str) -> Optional[Dict[str, Any]]:
    """User for a media token when ``path`` is inside the token's scope."""
    if not token or not isinstance(token, str) or len(token) > 512 or "." not in token:
        return None
    body, _, sig = token.partition(".")
    want = _b64e(_hmac.new(_MEDIA_KEY, body.encode(), _hashlib.sha256).digest())
    if not _hmac.compare_digest(want, sig):
        return None
    try:
        payload = _json.loads(_b64d(body))
        scope = str(payload["s"])
        username = str(payload["u"])
        version = int(payload["v"])
        expires = int(payload["e"])
    except (ValueError, KeyError, TypeError):
        return None
    if scope not in MEDIA_SCOPES or expires < time.time():
        return None
    if not (path == scope or path.startswith(scope + "/")):
        return None
    from . import user_model

    user = user_model.get_user_by_username(username)
    if not user:
        return None
    try:
        if int(user.get("token_version") or 0) != version:
            return None
    except (TypeError, ValueError):
        return None
    return user


def clear_tickets() -> None:
    """Test helper."""
    with _lock:
        _tickets.clear()
        _per_user.clear()
        _issued_at.clear()
