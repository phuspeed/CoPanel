"""Input sanitizers for CoAgent tool arguments (anti command-injection)."""
from __future__ import annotations

import re
from typing import Optional

SERVICE_NAME_RE = re.compile(r"^[a-zA-Z0-9@._+-]{1,128}$")
DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-z0-9-]{1,63}(?<!-))+$"
)
PROTOCOL_ALLOWED = frozenset({"tcp", "udp"})
FIREWALL_ACTIONS = frozenset({"allow", "deny", "delete"})
NGINX_ACTIONS = frozenset({"create", "update", "delete"})
PROTECTED_PORTS = frozenset({22, 8686})


class SanitizeError(ValueError):
    """Raised when AI-supplied arguments fail validation."""


def sanitize_service_name(value: str) -> str:
    name = (value or "").strip()
    if not name or ".." in name or "/" in name or "\\" in name:
        raise SanitizeError("Invalid service name.")
    if not SERVICE_NAME_RE.match(name):
        raise SanitizeError("Service name contains illegal characters.")
    return name


def sanitize_domain(value: str) -> str:
    raw = (value or "").strip().lower()
    raw = re.sub(r"^https?://", "", raw)
    raw = raw.split("/")[0].split(":")[0].strip(".")
    if raw.startswith("www."):
        # keep www if user/AI explicitly wants it; otherwise normalize bare host
        pass
    if not raw or not DOMAIN_RE.match(raw):
        raise SanitizeError("Invalid domain name.")
    return raw


def sanitize_port(value) -> int:
    try:
        port = int(value)
    except (TypeError, ValueError) as exc:
        raise SanitizeError("Port must be an integer.") from exc
    if port < 1 or port > 65535:
        raise SanitizeError("Port must be between 1 and 65535.")
    return port


def sanitize_protocol(value: str) -> str:
    proto = (value or "tcp").strip().lower()
    if proto not in PROTOCOL_ALLOWED:
        raise SanitizeError("Protocol must be tcp or udp.")
    return proto


def sanitize_firewall_action(value: str) -> str:
    action = (value or "").strip().lower()
    if action not in FIREWALL_ACTIONS:
        raise SanitizeError("Firewall action must be allow, deny, or delete.")
    return action


def sanitize_nginx_action(value: str) -> str:
    action = (value or "create").strip().lower()
    if action not in NGINX_ACTIONS:
        raise SanitizeError("Nginx action must be create, update, or delete.")
    return action


def sanitize_log_lines(value, default: int = 50, max_lines: int = 200) -> int:
    try:
        lines = int(value) if value is not None else default
    except (TypeError, ValueError):
        lines = default
    return max(1, min(lines, max_lines))


def assert_firewall_port_safe(port: int, action: str) -> None:
    """Refuse operations that could lock out SSH or the panel."""
    if port in PROTECTED_PORTS and action in ("deny", "delete"):
        raise SanitizeError(
            f"Refusing to {action} protected port {port} (SSH/panel safety)."
        )


def truncate_text(text: Optional[str], max_chars: int = 8000) -> str:
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 20] + "\n...[truncated]..."
