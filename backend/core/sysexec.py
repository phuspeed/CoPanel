"""Privileged command helper for CoPanel.

The panel service runs as root. Calling ``sudo`` anyway raises
``FileNotFoundError`` on Debian images that do not install sudo. This module
strips that prefix when already root, adds ``sudo -n`` only when a non-root
process still needs it, and always applies a timeout.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from typing import Dict, List, Optional, Sequence

_PKG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+.:_-]{0,80}$")


class CommandError(RuntimeError):
    """A command could not be started or exceeded its timeout."""

    def __init__(self, message: str, *, output_tail: str = "") -> None:
        super().__init__(message)
        self.output_tail = output_tail


def is_root() -> bool:
    if os.name == "nt":
        return False
    try:
        return os.geteuid() == 0
    except AttributeError:
        return False


def _strip_sudo(cmd: Sequence[str]) -> List[str]:
    argv = [str(part) for part in cmd]
    if argv and argv[0] == "sudo":
        argv = argv[1:]
        if argv and argv[0] == "-n":
            argv = argv[1:]
    if not argv:
        raise CommandError("Empty command.")
    return argv


def prepare_argv(cmd: Sequence[str], *, as_root: bool = False) -> List[str]:
    """Return an argv that does not call sudo when the process is root.

    ``as_root=True`` (or a leading ``sudo``) escalates when the process is
    not root. A missing sudo binary is reported as ``CommandError`` instead
    of ``FileNotFoundError``.
    """
    requested_root = as_root or (bool(cmd) and str(cmd[0]) == "sudo")
    argv = _strip_sudo(cmd)
    if not requested_root or is_root():
        return argv
    sudo = shutil.which("sudo")
    if not sudo:
        raise CommandError(
            "This action needs root, and sudo is not installed. "
            "Run CoPanel as root or install sudo."
        )
    return [sudo, "-n", *argv]


def combined_output(result: subprocess.CompletedProcess, limit: int = 800) -> str:
    text = "\n".join(part for part in ((result.stdout or ""), (result.stderr or "")) if part).strip()
    if len(text) > limit:
        return text[-limit:]
    return text


def run(
    cmd: Sequence[str],
    timeout: int,
    *,
    as_root: bool = False,
    env_extra: Optional[Dict[str, str]] = None,
    input: Optional[str] = None,
    check: bool = False,
    cwd: Optional[str] = None,
) -> subprocess.CompletedProcess:
    """Run ``cmd`` with captured output and a hard timeout."""
    argv = prepare_argv(cmd, as_root=as_root)
    env = None
    if env_extra:
        env = {**os.environ, **env_extra}
    try:
        result = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            input=input,
            env=env,
            cwd=cwd,
            check=False,
            shell=False,
        )
    except subprocess.TimeoutExpired as exc:
        tail = ""
        if exc.stdout or exc.stderr:
            stdout = exc.stdout if isinstance(exc.stdout, str) else ""
            stderr = exc.stderr if isinstance(exc.stderr, str) else ""
            tail = "\n".join(part for part in (stdout, stderr) if part)[-800:]
        raise CommandError(
            f"Command timed out after {timeout}s: {argv[0]}",
            output_tail=tail,
        ) from exc
    except FileNotFoundError as exc:
        raise CommandError(f"Command not found: {argv[0]}") from exc
    if check and result.returncode != 0:
        raise subprocess.CalledProcessError(result.returncode, argv, result.stdout, result.stderr)
    return result


def service_is_active(unit: str) -> bool:
    try:
        result = run(["systemctl", "is-active", unit], timeout=15)
    except CommandError:
        return False
    return (result.stdout or "").strip() == "active"


def service_enable_now(unit: str, timeout: int = 60) -> None:
    result = run(["systemctl", "enable", "--now", unit], timeout=timeout, as_root=True)
    if result.returncode != 0:
        raise CommandError(
            f"Could not start service {unit}. {combined_output(result)}".strip()
        )


def _validate_packages(packages: Sequence[str]) -> List[str]:
    cleaned: List[str] = []
    for package in packages:
        name = (package or "").strip()
        if not _PKG_RE.fullmatch(name):
            raise CommandError(f"Invalid package name: {package!r}")
        if name not in cleaned:
            cleaned.append(name)
    return cleaned


def _apt_needs_update(text: str) -> bool:
    lowered = text.lower()
    return (
        "unable to locate package" in lowered
        or "404  not found" in lowered
        or "failed to fetch" in lowered
    )


def _missing_deb(packages: Sequence[str]) -> List[str]:
    missing: List[str] = []
    for package in packages:
        try:
            result = run(["dpkg-query", "-W", "-f=${Status}", package], timeout=20)
        except CommandError:
            missing.append(package)
            continue
        if "install ok installed" not in (result.stdout or ""):
            missing.append(package)
    return missing


def _missing_rpm(packages: Sequence[str]) -> List[str]:
    missing: List[str] = []
    for package in packages:
        try:
            result = run(["rpm", "-q", package], timeout=20)
        except CommandError:
            missing.append(package)
            continue
        if result.returncode != 0:
            missing.append(package)
    return missing


def pkg_install(packages: Sequence[str], timeout: int = 900) -> Dict[str, object]:
    """Install distro packages and verify them afterwards.

    Returns ``{ok, missing, output_tail}``. Apt retries once after
    ``apt-get update`` when the failure looks like a stale package index.
    """
    try:
        cleaned = _validate_packages(packages)
    except CommandError as exc:
        return {"ok": False, "missing": [str(packages[0]) if packages else ""], "output_tail": str(exc)}
    if not cleaned:
        return {"ok": True, "missing": [], "output_tail": ""}

    env = {"DEBIAN_FRONTEND": "noninteractive", "NEEDRESTART_MODE": "a"}
    if shutil.which("apt-get"):
        def _install() -> subprocess.CompletedProcess:
            return run(
                ["apt-get", "-o", "DPkg::Lock::Timeout=300", "install", "-y", *cleaned],
                timeout=timeout,
                as_root=True,
                env_extra=env,
            )

        result = _install()
        text = combined_output(result, limit=4000)
        if result.returncode != 0 and _apt_needs_update(text):
            run(["apt-get", "update"], timeout=min(timeout, 300), as_root=True, env_extra=env)
            result = _install()
            text = combined_output(result, limit=4000)
        missing = _missing_deb(cleaned)
        return {
            "ok": result.returncode == 0 and not missing,
            "missing": missing,
            "output_tail": text[-800:],
        }

    tool = "dnf" if shutil.which("dnf") else ("yum" if shutil.which("yum") else "")
    if not tool:
        return {
            "ok": False,
            "missing": cleaned,
            "output_tail": "No supported package manager (apt-get, dnf, or yum).",
        }
    result = run([tool, "install", "-y", *cleaned], timeout=timeout, as_root=True)
    missing = _missing_rpm(cleaned)
    return {
        "ok": result.returncode == 0 and not missing,
        "missing": missing,
        "output_tail": combined_output(result),
    }


def pipe_to_file(
    producer: Sequence[str],
    consumer: Sequence[str],
    out_path: str,
    *,
    timeout: int = 3600,
    producer_as_root: bool = False,
) -> subprocess.CompletedProcess:
    """Run ``producer | consumer > out_path`` without a shell.

    Returns a CompletedProcess whose returncode is the first non-zero exit
    code of the two (producer first) and whose stderr joins both.
    """
    p_argv = prepare_argv(producer, as_root=producer_as_root)
    c_argv = prepare_argv(consumer)
    fd = os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as out:
        p1 = subprocess.Popen(p_argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            p2 = subprocess.Popen(c_argv, stdin=p1.stdout, stdout=out, stderr=subprocess.PIPE)
        except BaseException:
            p1.kill()
            p1.wait()
            raise
        assert p1.stdout is not None
        p1.stdout.close()  # let p1 get SIGPIPE if p2 exits
        try:
            _, err2 = p2.communicate(timeout=timeout)
            err1 = p1.stderr.read() if p1.stderr else b""
            p1.wait(timeout=60)
        except subprocess.TimeoutExpired:
            p1.kill()
            p2.kill()
            p1.wait()
            p2.wait()
            raise CommandError(f"Command timed out after {timeout}s.")
        finally:
            if p1.stderr:
                p1.stderr.close()
    rc = p1.returncode or p2.returncode
    stderr = (err1 or b"").decode("utf-8", "replace") + (err2 or b"").decode("utf-8", "replace")
    return subprocess.CompletedProcess([*p_argv, "|", *c_argv], rc, "", stderr)
