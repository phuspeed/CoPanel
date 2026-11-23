"""Detached panel updater (stdlib only).

Started by ``core.panel_update.launch_update`` in its own systemd transient
unit (``systemd-run --unit=copanel-update``), so stopping or restarting
``copanel.service`` during the install does not kill it.

Steps:
1. Stage the newest ``scripts/install.sh`` from ``origin/main`` (falls back to
   the installed copy) into the state dir. Running a copy outside the panel
   tree means ``install.sh`` takes its git-update path and that ``git reset``
   cannot rewrite the script while bash is reading it.
2. Run it with output appended to ``update.log``.
3. Record the exit code in ``state.json``.

Everything goes to files, so the panel can report progress again after the
backend restarts.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

STATE_FILE = "state.json"
LOG_FILE = "update.log"
STAGED_SCRIPT = "install.sh"
LOCK_FILE = "lock"
EXIT_MARKER = "__COPANEL_EXIT__"


def read_state(state_dir: Path) -> dict:
    try:
        data = json.loads((state_dir / STATE_FILE).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write_state(state_dir: Path, **fields) -> dict:
    state = read_state(state_dir)
    state.update(fields)
    tmp = state_dir / (STATE_FILE + ".tmp")
    tmp.write_text(json.dumps(state), encoding="utf-8")
    os.replace(tmp, state_dir / STATE_FILE)
    return state


def replace_state(state_dir: Path, state: dict) -> None:
    tmp = state_dir / (STATE_FILE + ".tmp")
    tmp.write_text(json.dumps(state or {}), encoding="utf-8")
    os.replace(tmp, state_dir / STATE_FILE)


@contextlib.contextmanager
def update_lock(state_dir: Path, *, blocking: bool):
    """Exclusive flock on ``<state>/lock``; yields True when held."""
    import fcntl

    fd = os.open(str(state_dir / LOCK_FILE), os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        except BlockingIOError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def _git(home: Path, *args: str, log, capture: bool = False, timeout: int = 300):
    return subprocess.run(
        ["git", "-c", f"safe.directory={home}", "-C", str(home), *args],
        stdout=subprocess.PIPE if capture else log,
        stderr=log,
        timeout=timeout,
        check=False,
    )


def stage_install_script(home: Path, state_dir: Path, log) -> Path:
    staged = state_dir / STAGED_SCRIPT
    if (home / ".git").exists() and shutil.which("git"):
        try:
            _git(home, "fetch", "--quiet", "origin", "main", log=log)
            shown = _git(home, "show", "origin/main:scripts/install.sh", log=log, capture=True, timeout=60)
            if shown.returncode == 0 and shown.stdout:
                staged.write_bytes(shown.stdout)
                staged.chmod(0o700)
                log.write(b"[copanel-update] Using install.sh from origin/main.\n")
                return staged
        except (OSError, subprocess.SubprocessError) as exc:
            log.write(f"[copanel-update] git fetch failed: {exc}\n".encode())
    shutil.copyfile(home / "scripts" / "install.sh", staged)
    staged.chmod(0o700)
    log.write(b"[copanel-update] Using the installed install.sh.\n")
    return staged


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--home", required=True)
    args = parser.parse_args(argv)
    state_dir = Path(args.state_dir)
    home = Path(args.home)
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Same lock as the launcher: waits for the launch to finish, then keeps
    # any second update out until this install is done.
    with update_lock(state_dir, blocking=True):
        return _run_locked(state_dir, home)


def _run_locked(state_dir: Path, home: Path) -> int:
    write_state(state_dir, status="running", pid=os.getpid(), runner_started_at=time.time())

    rc = -1
    # A new run starts a fresh log (only once the lock is held).
    with open(state_dir / LOG_FILE, "wb", buffering=0) as log:
        try:
            script = stage_install_script(home, state_dir, log)
            env = {k: v for k, v in os.environ.items() if k != "COPANEL_ENV"}
            env["COPANEL_NONINTERACTIVE"] = "1"
            env["COPANEL_HOME"] = str(home)
            rc = subprocess.run(
                ["/bin/bash", str(script)],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                cwd=str(state_dir),
                env=env,
                check=False,
            ).returncode
        except Exception as exc:  # report, never leave the state at "running"
            log.write(f"\n[copanel-update] updater error: {exc}\n".encode())
            rc = -1
        log.write(f"\n{EXIT_MARKER}:{rc}\n".encode())
    write_state(
        state_dir,
        status="success" if rc == 0 else "failed",
        exit_code=rc,
        finished_at=time.time(),
    )
    return 0 if rc == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
