"""Shared allow-list validators for names that land in shell, SQL, or configs."""
from __future__ import annotations

import ipaddress
import os
import re
from pathlib import Path
from typing import Optional, Sequence

# Hostname labels (RFC 1123). The whole name must contain a dot so a single
# word cannot be used as a vhost / certificate directory.
_DOMAIN_RE = re.compile(r"^[A-Za-z0-9.-]+$")
_LABEL_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")
_IDENT_RE = re.compile(r"^[A-Za-z0-9_]+$")
_DOC_ROOT_RE = re.compile(r"^/[A-Za-z0-9._/-]+$")

_DEFAULT_WEB_ROOTS = ("/var/www", "/home")


def allowed_web_roots() -> list[str]:
    """Document roots nginx/apache may be pointed at.

    Override with ``COPANEL_ALLOWED_WEB_ROOTS`` (comma-separated absolute paths).
    """
    raw = os.environ.get("COPANEL_ALLOWED_WEB_ROOTS", "")
    if not raw.strip():
        return list(_DEFAULT_WEB_ROOTS)
    roots = [part.strip() for part in raw.split(",") if part.strip()]
    return roots or list(_DEFAULT_WEB_ROOTS)


def validate_domain(domain: str) -> str:
    """Return a normalized domain or raise ``ValueError``.

    Rejects path separators, whitespace, and nginx/shell metacharacters.
    """
    if not domain or not isinstance(domain, str):
        raise ValueError("Domain is required.")
    candidate = domain.strip().lower()
    if not candidate or len(candidate) > 253:
        raise ValueError("Domain is required.")
    if not _DOMAIN_RE.fullmatch(candidate):
        raise ValueError("Domain contains invalid characters.")
    labels = candidate.split(".")
    if len(labels) < 2:
        raise ValueError("Domain must contain at least one dot.")
    for label in labels:
        if not _LABEL_RE.fullmatch(label):
            raise ValueError(f"Domain label '{label}' is invalid.")
    return candidate


def validate_doc_root(
    root: str,
    *,
    allowed_roots: Optional[Sequence[str]] = None,
) -> str:
    """Return a resolved document root under an allowed prefix, or raise."""
    if not root or not str(root).strip():
        raise ValueError("Document root is required.")
    text = str(root).strip()
    if "\x00" in text or "\n" in text or "\r" in text:
        raise ValueError("Document root contains an invalid character.")
    if os.name == "nt":
        return text
    if not _DOC_ROOT_RE.fullmatch(text):
        raise ValueError("Document root contains invalid characters.")
    if ".." in Path(text).parts:
        raise ValueError("Document root must not contain '..'.")
    resolved = Path(text).resolve()
    bases = list(allowed_roots) if allowed_roots is not None else allowed_web_roots()
    for base in bases:
        base_path = Path(base).resolve()
        if resolved == base_path or resolved.is_relative_to(base_path):
            return str(resolved)
    raise ValueError("Document root is outside the allowed web roots.")


def validate_db_username(username: str) -> str:
    """MySQL/PostgreSQL account name: ``[A-Za-z0-9_]{1,32}``."""
    if not username or not _IDENT_RE.fullmatch(username) or len(username) > 32:
        raise ValueError("Username must be 1-32 characters of letters, digits, or underscore.")
    return username


def validate_db_name(name: str) -> str:
    """Schema name: ``[A-Za-z0-9_]{1,64}``."""
    if not name or not _IDENT_RE.fullmatch(name) or len(name) > 64:
        raise ValueError("Database name must be 1-64 characters of letters, digits, or underscore.")
    return name


def validate_mysql_host(host: str) -> str:
    """Allow localhost, loopback, any-host ``%``, or a literal IP."""
    candidate = (host or "").strip()
    if candidate in {"localhost", "127.0.0.1", "%"}:
        return candidate
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError as exc:
        raise ValueError(
            "Host must be localhost, 127.0.0.1, %, or an IP address."
        ) from exc


def escape_mysql_literal(value: str) -> str:
    """Escape a value for a MySQL single-quoted string literal."""
    return (
        value.replace("\\", "\\\\")
        .replace("\x00", "\\0")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("'", "\\'")
        .replace('"', '\\"')
        .replace("\x1a", "\\Z")
    )
