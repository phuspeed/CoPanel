"""
Panel self-update: compare local install vs GitHub main (VERSION file) and
locate install.sh for scripted upgrades.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from packaging.version import InvalidVersion, Version

REPO_OWNER = "phuspeed"
REPO_NAME = "CoPanel"
VERSION_API_URL = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/contents/VERSION?ref=main"
RELEASES_LATEST_API = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/releases/latest"
REMOTE_VERSION_RAW = f"https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/main/VERSION"
GITHUB_COMPARE = f"https://github.com/{REPO_OWNER}/{REPO_NAME}/compare"

_CACHE: Dict[str, Any] = {}
_CACHE_AT: float = 0.0
_CACHE_TTL_OK = 3600
_CACHE_TTL_ERR = 300


def copanel_home() -> Path:
    return Path(os.environ.get("COPANEL_HOME", "/opt/copanel")).resolve()


def install_script_path() -> Path:
    return copanel_home() / "scripts" / "install.sh"


def normalize_version(v: str) -> str:
    s = (v or "").strip().lstrip("v")
    if not s:
        return "0.0.0"
    return s.split()[0]


def read_local_version() -> str:
    for base in (copanel_home(), Path(__file__).resolve().parent.parent.parent):
        vf = base / "VERSION"
        if vf.is_file():
            try:
                raw = vf.read_text(encoding="utf-8").strip()
                if raw:
                    return normalize_version(raw)
            except OSError:
                continue
    return "0.0.0-dev"


def compare_versions(a: str, b: str) -> int:
    try:
        va, vb = Version(normalize_version(a)), Version(normalize_version(b))
        if va < vb:
            return -1
        if va > vb:
            return 1
        return 0
    except InvalidVersion:
        return 0


def _github_headers(*, raw: bool = False) -> Dict[str, str]:
    headers = {
        "User-Agent": "CoPanel-PanelUpdate/1.0",
        "Accept": "application/vnd.github.v3.raw" if raw else "application/vnd.github+json",
    }
    token = (os.environ.get("COPANEL_GITHUB_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _http_get_text(url: str, *, headers: Optional[Dict[str, str]] = None, timeout: int = 15) -> str:
    req = urllib.request.Request(url, headers=headers or _github_headers())
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _http_get_json(url: str, *, headers: Optional[Dict[str, str]] = None, timeout: int = 15) -> Dict[str, Any]:
    req = urllib.request.Request(url, headers=headers or _github_headers())
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _classify_fetch_error(exc: BaseException) -> Tuple[str, str]:
    msg = str(exc)
    lowered = msg.lower()
    if "429" in msg or ("403" in msg and "rate" in lowered):
        return "rate_limit", msg
    if isinstance(exc, (urllib.error.URLError, TimeoutError, OSError)):
        return "network", msg
    return "unknown", msg


def _fetch_remote_version() -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Return (version, fetch_error, fetch_error_kind)."""
    attempts: Tuple[Tuple[str, bool], ...] = (
        (VERSION_API_URL, True),
        (REMOTE_VERSION_RAW, False),
    )
    last_error: Optional[str] = None
    last_kind: Optional[str] = None
    for url, use_raw in attempts:
        try:
            text = _http_get_text(url, headers=_github_headers(raw=use_raw))
            version = normalize_version(text.strip())
            if version and version != "0.0.0":
                return version, None, None
        except (urllib.error.URLError, OSError, TimeoutError, ValueError) as e:
            last_kind, last_error = _classify_fetch_error(e)
    return None, last_error, last_kind


def check_for_update() -> Dict[str, Any]:
    global _CACHE, _CACHE_AT

    now = time.time()
    if _CACHE:
        ttl = _CACHE_TTL_OK if not _CACHE.get("fetch_error") else _CACHE_TTL_ERR
        if (now - _CACHE_AT) < ttl:
            return dict(_CACHE)

    local = read_local_version()
    remote, fetch_error, fetch_error_kind = _fetch_remote_version()

    changelog: Optional[str] = None
    release_url = f"{GITHUB_COMPARE}/{local}...main"

    if remote:
        try:
            rel = _http_get_json(RELEASES_LATEST_API)
            tag = normalize_version(str(rel.get("tag_name", "")))
            if tag == remote:
                changelog = rel.get("body")
            if rel.get("html_url"):
                release_url = str(rel["html_url"])
        except (urllib.error.URLError, OSError, TimeoutError, json.JSONDecodeError, ValueError):
            pass

    update_available = bool(remote) and compare_versions(local, remote) < 0

    result = {
        "local_version": local,
        "remote_version": remote,
        "update_available": update_available,
        "changelog": changelog,
        "release_url": release_url,
        "fetch_error": fetch_error,
        "fetch_error_kind": fetch_error_kind,
    }
    _CACHE = result
    _CACHE_AT = now
    return dict(result)
