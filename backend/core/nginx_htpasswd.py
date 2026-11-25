"""Permissions for nginx Basic Auth htpasswd files.

1.1.16 locked ``config/`` to ``0700 root:root``, which blocked nginx workers
(``www-data`` on Debian/Ubuntu, ``nginx`` on RHEL) from reading
``panel_access.htpasswd`` and ``config/web_auth/*.htpasswd``. Sites and the
panel with Basic Auth enabled then returned HTTP 500.

This module keeps those paths in place (existing vhosts already point at them)
and applies a narrower exception:

* ``config/`` and ``config/web_auth/`` are ``0711 root:root`` (traverse by
  exact path, no listing).
* htpasswd files are ``0640 root:<nginx-user>``.
* ``jwt_secret``, SQLite DBs, JSON metadata, TLS keys, and ``config/ssl/``
  (``0700``) stay root-only and are never relaxed here.
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

from core.paths import config_dir

HTPASSWD_FILE_MODE = 0o640
HTPASSWD_DIR_MODE = 0o711

_NGINX_CONF_CANDIDATES = (
    Path("/etc/nginx/nginx.conf"),
    Path("/usr/local/nginx/conf/nginx.conf"),
)
_NGINX_USER_RE = re.compile(r"^\s*user\s+([A-Za-z0-9_-]+)")
_NGINX_USER_FALLBACKS = ("www-data", "nginx")


def _user_exists(name: str) -> bool:
    try:
        import pwd

        pwd.getpwnam(name)
        return True
    except (KeyError, ImportError, OSError):
        return False


def _parse_nginx_user(conf: Path) -> str | None:
    try:
        text = conf.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = _NGINX_USER_RE.match(line)
        if match:
            return match.group(1)
    return None


def detect_nginx_user(nginx_conf: Path | None = None) -> str | None:
    """Return the nginx worker user, or None if it cannot be determined.

    Preference order: an explicit conf path, ``COPANEL_TEST_NGINX_CONF``,
    standard nginx.conf ``user`` directives, then ``www-data`` / ``nginx``
    if that account exists on the host.
    """
    candidates: list[Path] = []
    if nginx_conf is not None:
        candidates.append(Path(nginx_conf))
    env_conf = os.environ.get("COPANEL_TEST_NGINX_CONF", "").strip()
    if env_conf:
        candidates.append(Path(env_conf))
    candidates.extend(_NGINX_CONF_CANDIDATES)

    seen: set[Path] = set()
    for conf in candidates:
        try:
            resolved = conf if not conf.exists() else conf.resolve()
        except OSError:
            resolved = conf
        if resolved in seen:
            continue
        seen.add(resolved)
        if not conf.is_file():
            continue
        user = _parse_nginx_user(conf)
        if user and _user_exists(user):
            return user

    for user in _NGINX_USER_FALLBACKS:
        if _user_exists(user):
            return user
    return None


def _chmod(path: Path, mode: int) -> None:
    try:
        os.chmod(path, mode)
    except OSError:
        pass


def _chown_root_nginx(path: Path) -> None:
    user = detect_nginx_user()
    if not user:
        return
    try:
        shutil.chown(path, user="root", group=user)
    except (PermissionError, LookupError, OSError):
        # Non-root test runs and missing accounts must still leave 0640 in place.
        pass


def is_htpasswd_file(path: Path) -> bool:
    return path.is_file() and path.name.endswith(".htpasswd")


def ensure_htpasswd_parent_dirs(path: Path) -> None:
    """Make ``config/`` and ``config/web_auth/`` traversable (0711)."""
    parent = Path(path).parent
    if parent.is_dir():
        _chmod(parent, HTPASSWD_DIR_MODE)
    if parent.name == "web_auth" and parent.parent.is_dir():
        _chmod(parent.parent, HTPASSWD_DIR_MODE)


def secure_htpasswd_file(path: Path) -> None:
    """Set ``0640 root:<nginx-user>`` on one htpasswd file if it exists."""
    path = Path(path)
    if not is_htpasswd_file(path):
        return
    _chmod(path, HTPASSWD_FILE_MODE)
    _chown_root_nginx(path)
    ensure_htpasswd_parent_dirs(path)


def write_htpasswd_text(path: Path, content: str) -> None:
    """Write an htpasswd file and immediately apply nginx-readable permissions."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    secure_htpasswd_file(path)


def repair_nginx_htpasswd_permissions(config_root: Path | None = None) -> None:
    """Repair config / web_auth / htpasswd modes after a 1.1.16-style lock-down.

    Never relaxes ``config/ssl/``, ``jwt_secret``, databases, JSON, or keys.
    """
    root = Path(config_root) if config_root is not None else config_dir()
    if not root.is_dir():
        return
    _chmod(root, HTPASSWD_DIR_MODE)
    web_auth = root / "web_auth"
    if web_auth.is_dir():
        _chmod(web_auth, HTPASSWD_DIR_MODE)
        for child in web_auth.iterdir():
            if is_htpasswd_file(child):
                secure_htpasswd_file(child)
    panel = root / "panel_access.htpasswd"
    if is_htpasswd_file(panel):
        secure_htpasswd_file(panel)
