"""Runtime config directory for CoPanel.

Production installs live under ``/opt/copanel``. A checkout that is not
installed there uses the repo-root ``config/`` directory. Tests set
``COPANEL_TEST_CONFIG_DIR`` so they never touch either of those.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Iterable, Optional

PRIVATE_FILE_MODE = 0o600

_CONFIG_SECRET_NAMES = frozenset(
    {
        "jwt_secret",
        "copanel.env",
        "admin_password.txt",
        "mysql_credentials.txt",
        "security_entrance.json",
    }
)


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


def harden_private_file(path: Path) -> None:
    """Force mode 0600 on an existing credential-bearing file."""
    try:
        if path.is_file():
            os.chmod(path, PRIVATE_FILE_MODE)
    except OSError:
        pass


def connect_private_sqlite(path: Path) -> sqlite3.Connection:
    """Open (or create) a SQLite file and keep it owner-readable only.

    sqlite3 uses the process umask for new files (often 0644). Create an
    empty 0600 file first when missing, then chmod again after connect so
    upgrades tighten an existing world-readable database.
    """
    path = Path(path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    if not path.exists():
        try:
            fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, PRIVATE_FILE_MODE)
            os.close(fd)
        except OSError:
            # Directory may be unwritable here (import-time module probes).
            # sqlite3.connect still creates the file when the path is usable.
            pass
    conn = sqlite3.connect(str(path))
    harden_private_file(path)
    return conn


def harden_config_private_files(directory: Optional[Path] = None) -> None:
    """chmod 0600 SQLite DBs and known secret files under the config dir."""
    root = Path(directory) if directory is not None else config_dir()
    if not root.is_dir():
        return
    try:
        entries: Iterable[Path] = root.iterdir()
    except OSError:
        return
    for item in entries:
        if item.suffix == ".db" or item.name in _CONFIG_SECRET_NAMES:
            harden_private_file(item)
    harden_private_file(root / "ssl" / "panel.key")


def write_private_text(path: Path, content: str) -> None:
    """Write ``content`` and force mode 0600 (owner read/write only)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, PRIVATE_FILE_MODE)
    try:
        os.write(fd, content.encode("utf-8"))
    finally:
        os.close(fd)
    harden_private_file(path)
