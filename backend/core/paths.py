"""Runtime config directory for CoPanel.

Production installs live under ``/opt/copanel``. A checkout that is not
installed there uses the repo-root ``config/`` directory. Tests set
``COPANEL_TEST_CONFIG_DIR`` so they never touch either of those.
"""
from __future__ import annotations

import os
from pathlib import Path


def config_dir() -> Path:
    """Directory that holds the SQLite DB, JWT secret, and credential files."""
    override = os.environ.get("COPANEL_TEST_CONFIG_DIR", "").strip()
    if override:
        path = Path(override)
        path.mkdir(parents=True, exist_ok=True)
        return path
    installed = Path("/opt/copanel")
    if installed.is_dir():
        return installed / "config"
    return Path(__file__).resolve().parent.parent.parent / "config"


def write_private_text(path: Path, content: str) -> None:
    """Write ``content`` and force mode 0600 (owner read/write only)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, content.encode("utf-8"))
    finally:
        os.close(fd)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
