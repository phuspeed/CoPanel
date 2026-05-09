"""
Panel self-update: compare local install vs GitHub main (VERSION file) and
locate install.sh for scripted upgrades.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

from packaging.version import InvalidVersion, Version

REMOTE_VERSION_URL = "https://raw.githubusercontent.com/phuspeed/CoPanel/main/VERSION"
RELEASES_LATEST_API = "https://api.github.com/repos/phuspeed/CoPanel/releases/latest"
GITHUB_COMPARE = "https://github.com/phuspeed/CoPanel/compare"


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


def _http_get_text(url: str, timeout: int = 15) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "CoPanel-PanelUpdate/1.0", "Accept": "*/*"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _http_get_json(url: str, timeout: int = 15) -> Dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "CoPanel-PanelUpdate/1.0",
            "Accept": "application/vnd.github+json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def check_for_update() -> Dict[str, Any]:
    local = read_local_version()
    remote: Optional[str] = None
    fetch_error: Optional[str] = None
    try:
        remote = normalize_version(_http_get_text(REMOTE_VERSION_URL).strip())
    except (urllib.error.URLError, OSError, TimeoutError, ValueError) as e:
        fetch_error = str(e)

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

    return {
        "local_version": local,
        "remote_version": remote,
        "update_available": update_available,
        "changelog": changelog,
        "release_url": release_url,
        "fetch_error": fetch_error,
    }
