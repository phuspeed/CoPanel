"""
Panel self-update: compare local install vs the latest GitHub release and
locate install.sh for scripted upgrades.
"""
from __future__ import annotations

import json
import re
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
GITHUB_RELEASES = f"https://github.com/{REPO_OWNER}/{REPO_NAME}/releases"
RELEASE_TAG_API = (
    f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/releases/tags/{{tag}}"
)

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


def release_url_for_version(version: str) -> str:
    """GitHub release page for a semver, aligned with remote_version from VERSION."""
    v = normalize_version(version)
    if not v or v == "0.0.0":
        return f"{GITHUB_COMPARE}/main"
    return f"{GITHUB_RELEASES}/tag/v{v}"


def _fetch_release_by_tag(version: str) -> Optional[Dict[str, Any]]:
    tag = f"v{normalize_version(version)}"
    try:
        return _http_get_json(RELEASE_TAG_API.format(tag=tag))
    except (urllib.error.URLError, OSError, TimeoutError, json.JSONDecodeError, ValueError):
        return None


RELEASES_LATEST_PAGE = f"{GITHUB_RELEASES}/latest"
_TAG_RE = re.compile(r"/releases/tag/(v\d+\.\d+\.\d+)$")


def _latest_release_tag_from_redirect() -> Optional[str]:
    """``github.com/<repo>/releases/latest`` redirects to the newest tag (no API quota)."""
    req = urllib.request.Request(RELEASES_LATEST_PAGE, headers={"User-Agent": "CoPanel-Updater"}, method="HEAD")
    with urllib.request.urlopen(req, timeout=15) as resp:  # noqa: S310 - fixed https URL
        final = resp.geturl()
    m = _TAG_RE.search(final or "")
    return m.group(1) if m else None


def _fetch_remote_version() -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Return (version, fetch_error, fetch_error_kind) of the latest *release*.

    Panel Update installs the latest signed GitHub release (not main), so
    the version shown as available comes from the release too.
    """
    last_error: Optional[str] = None
    last_kind: Optional[str] = None
    try:
        rel = _http_get_json(RELEASES_LATEST_API)
        version = normalize_version(str(rel.get("tag_name", "")))
        if version and version != "0.0.0":
            return version, None, None
    except (urllib.error.URLError, OSError, TimeoutError, ValueError, json.JSONDecodeError) as e:
        last_kind, last_error = _classify_fetch_error(e)
    try:
        tag = _latest_release_tag_from_redirect()
        if tag:
            return normalize_version(tag), None, None
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
        release_url = release_url_for_version(remote)
        rel = _fetch_release_by_tag(remote)
        if rel:
            if rel.get("body"):
                changelog = rel.get("body")
            if rel.get("html_url"):
                release_url = str(rel["html_url"])
        else:
            try:
                rel_latest = _http_get_json(RELEASES_LATEST_API)
                tag = normalize_version(str(rel_latest.get("tag_name", "")))
                if tag == remote:
                    if rel_latest.get("body"):
                        changelog = rel_latest.get("body")
                    if rel_latest.get("html_url"):
                        release_url = str(rel_latest["html_url"])
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


# ----- Detached self-update -------------------------------------------------
#
# The web "Start upgrade" used to run install.sh as a child of the uvicorn
# process, i.e. inside copanel.service's cgroup. When the service stops or its
# cgroup is killed (OOM during the frontend build on small VPSes), the update
# died with it. It now runs in its own transient unit
# (``systemd-run --unit=copanel-update``) and reports through files.

import shutil as _shutil  # noqa: E402
import subprocess as _subprocess  # noqa: E402
import sys as _sys  # noqa: E402

from core import panel_update_runner as _runner  # noqa: E402

UPDATE_UNIT = "copanel-update"
_LOG_CHUNK_MAX = 64 * 1024
_START_GRACE_S = 20


class UpdateAlreadyRunning(RuntimeError):
    pass


def update_state_dir() -> Path:
    override = os.environ.get("COPANEL_UPDATE_STATE_DIR", "").strip()
    return Path(override) if override else Path("/var/lib/copanel-update")


def _updater_python() -> str:
    # install.sh may rebuild the panel venv; prefer the system python.
    for cand in ("/usr/bin/python3", "/usr/local/bin/python3"):
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return _sys.executable


def systemd_run_available() -> bool:
    return bool(_shutil.which("systemd-run")) and Path("/run/systemd/system").is_dir()


def build_launch_command(python: str, runner: Path, state_dir: Path, home: Path) -> list:
    """argv for the detached updater (list form, never a shell string)."""
    return [
        "systemd-run",
        f"--unit={UPDATE_UNIT}",
        "--collect",
        "--quiet",
        "--description=CoPanel panel update",
        "--setenv=COPANEL_NONINTERACTIVE=1",
        python,
        str(runner),
        "--state-dir",
        str(state_dir),
        "--home",
        str(home),
    ]


def _unit_active() -> Optional[bool]:
    if not _shutil.which("systemctl"):
        return None
    try:
        out = _subprocess.run(
            ["systemctl", "is-active", f"{UPDATE_UNIT}.service"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, _subprocess.SubprocessError):
        return None
    return out.stdout.strip() in ("active", "activating", "reloading")


def _pid_alive(pid: Any) -> bool:
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError, TypeError):
        return False


def _is_alive(state: Dict[str, Any]) -> bool:
    if state.get("mode") == "systemd":
        active = _unit_active()
        if active is not None:
            return active
    return _pid_alive(state.get("pid"))


class UnsafeStateDir(RuntimeError):
    pass


def prepare_state_dir(state_dir: Path) -> Path:
    """Create the updater state dir and insist it is a root-only directory.

    Fails closed: a symlink, a directory owned by someone else, or one whose
    mode cannot be forced to 0700 raises ``UnsafeStateDir``.
    """
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    st = os.lstat(state_dir)
    import stat as _stat

    if not _stat.S_ISDIR(st.st_mode):
        raise UnsafeStateDir(f"{state_dir} is not a directory (symlink?); refusing to run the updater.")
    if hasattr(os, "geteuid") and st.st_uid != os.geteuid():
        raise UnsafeStateDir(f"{state_dir} is not owned by the panel user; refusing to run the updater.")
    try:
        os.chmod(state_dir, 0o700)
    except OSError as exc:
        raise UnsafeStateDir(f"Could not make {state_dir} private (chmod 0700): {exc}") from exc
    if _stat.S_IMODE(os.lstat(state_dir).st_mode) & 0o077:
        raise UnsafeStateDir(f"{state_dir} is readable by other users; refusing to run the updater.")
    return state_dir


def launch_update(actor: Optional[str] = None) -> Dict[str, Any]:
    """Start install.sh detached from copanel.service. Raises UpdateAlreadyRunning.

    An exclusive ``flock`` on ``<state>/lock`` serialises launches, and the
    runner holds the same lock for the whole install. A refused launch (lock
    busy, unit already active, ``systemd-run`` reporting the unit exists)
    raises ``UpdateAlreadyRunning`` without touching the log or state.
    """
    state_dir = prepare_state_dir(update_state_dir())
    with _runner.update_lock(state_dir, blocking=False) as locked:
        if not locked:
            raise UpdateAlreadyRunning("A panel update is already running.")
        current = _runner.read_state(state_dir)
        if current.get("status") in ("starting", "running") and _is_alive(current):
            raise UpdateAlreadyRunning("A panel update is already running.")
        systemd = systemd_run_available()
        if systemd and _unit_active():
            raise UpdateAlreadyRunning("A panel update is already running.")

        # Run a copy of the runner: git reset during the install must not touch it.
        runner = state_dir / "runner.py"
        _shutil.copyfile(Path(_runner.__file__), runner)
        os.chmod(runner, 0o600)
        home = copanel_home()
        try:
            target = check_for_update().get("remote_version")
        except Exception:  # network trouble is not fatal here
            target = None
        python = _updater_python()
        previous = dict(current)
        _runner.write_state(
            state_dir,
            status="starting",
            mode="systemd" if systemd else "process",
            unit=UPDATE_UNIT if systemd else None,
            started_at=time.time(),
            finished_at=None,
            exit_code=None,
            pid=None,
            from_version=read_local_version(),
            target_version=target,
            actor=actor,
        )
        if systemd:
            cmd = build_launch_command(python, runner, state_dir, home)
            proc = _subprocess.run(cmd, capture_output=True, text=True, timeout=30, check=False)
            if proc.returncode != 0:
                err = (proc.stderr or proc.stdout or "").strip()
                if "already" in err.lower() and ("exist" in err.lower() or "loaded" in err.lower()):
                    _runner.replace_state(state_dir, previous)
                    raise UpdateAlreadyRunning("A panel update is already running.")
                _runner.write_state(state_dir, status="failed", exit_code=-1, finished_at=time.time())
                raise RuntimeError(f"systemd-run failed: {err}")
        else:
            # No systemd (dev box / container): own session, best effort.
            child = _subprocess.Popen(
                [python, str(runner), "--state-dir", str(state_dir), "--home", str(home)],
                stdin=_subprocess.DEVNULL,
                stdout=_subprocess.DEVNULL,
                stderr=_subprocess.DEVNULL,
                start_new_session=True,
                close_fds=True,
            )
            _runner.write_state(state_dir, pid=child.pid)
    return update_status(0)


def update_status(offset: int = 0) -> Dict[str, Any]:
    """Updater state plus the log from byte ``offset`` (survives backend restarts)."""
    state_dir = update_state_dir()
    state = _runner.read_state(state_dir)
    status = state.get("status") or "idle"
    if status in ("starting", "running") and not _is_alive(state):
        started = float(state.get("started_at") or 0)
        if status == "running" or time.time() - started > _START_GRACE_S:
            status = "interrupted"
    log_path = state_dir / _runner.LOG_FILE
    chunk = ""
    next_offset = max(0, int(offset or 0))
    try:
        size = log_path.stat().st_size
        if next_offset > size:
            next_offset = 0
        with open(log_path, "rb") as fh:
            fh.seek(next_offset)
            data = fh.read(_LOG_CHUNK_MAX)
        next_offset += len(data)
        chunk = data.decode("utf-8", errors="replace")
    except OSError:
        pass
    return {
        "status": status,
        "exit_code": state.get("exit_code"),
        "mode": state.get("mode"),
        "unit": state.get("unit"),
        "started_at": state.get("started_at"),
        "finished_at": state.get("finished_at"),
        "from_version": state.get("from_version"),
        "target_version": state.get("target_version"),
        "local_version": read_local_version(),
        "log": chunk,
        "offset": next_offset,
        "log_path": str(log_path),
    }
