"""rsync_manager: SSH target checks and rsync orchestration (Linux servers)."""
from __future__ import annotations

import os
import re
import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

Severity = Literal["ok", "warn", "block"]

# Suggested excludes when syncing CoPanel tree (paths relative to source root).
PRESET_EXCLUDES_COPANEL: List[str] = [
    "venv/",
    "**/__pycache__/",
    "*.pyc",
    ".git/",
    "frontend/node_modules/",
]

_HOST_RE = re.compile(r"^[a-zA-Z0-9._-]+$")
_USER_RE = re.compile(r"^[a-zA-Z0-9._-]+$")
_REMOTE_PATH_RE = re.compile(r"^/[a-zA-Z0-9/_.~-]*$")


def _is_windows() -> bool:
    return os.name == "nt"


def _item(
    item_id: str,
    severity: Severity,
    message: str,
    source: str = "",
    target: str = "",
) -> Dict[str, Any]:
    return {
        "id": item_id,
        "severity": severity,
        "message": message,
        "source": source,
        "target": target,
    }


def validate_ssh_target(host: str, port: int, user: str, identity_file: Optional[str]) -> None:
    if not host or len(host) > 253 or not _HOST_RE.match(host):
        raise ValueError("Invalid SSH host.")
    if not (1 <= port <= 65535):
        raise ValueError("Invalid SSH port.")
    if not user or len(user) > 64 or not _USER_RE.match(user):
        raise ValueError("Invalid SSH user.")
    if identity_file:
        p = Path(identity_file).expanduser().resolve()
        if not p.is_file():
            raise ValueError("SSH identity file not found.")


def validate_local_path(local_path: str) -> Path:
    p = Path(local_path).expanduser().resolve()
    if not p.exists():
        raise ValueError("Local path does not exist.")
    return p


def validate_remote_path(remote_path: str) -> str:
    rp = (remote_path or "").strip()
    if not rp or len(rp) > 2048 or not _REMOTE_PATH_RE.match(rp):
        raise ValueError("Remote path must be an absolute path (e.g. /opt/copanel).")
    return rp


def validate_excludes(excludes: List[str]) -> List[str]:
    out: List[str] = []
    for raw in excludes[:500]:
        s = (raw or "").strip()
        if not s or "\n" in s or "\x00" in s or ".." in s:
            raise ValueError("Invalid exclude pattern.")
        if len(s) > 512:
            s = s[:512]
        out.append(s)
    return out


def _ssh_cmd(host: str, port: int, user: str, identity_file: Optional[str], remote_argv: List[str]) -> List[str]:
    cmd = [
        "ssh",
        "-p",
        str(port),
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]
    if identity_file:
        cmd.extend(["-i", identity_file])
    cmd.append(f"{user}@{host}")
    cmd.extend(remote_argv)
    return cmd


def _run_capture(argv: List[str], timeout: int = 60) -> Tuple[int, str, str]:
    try:
        r = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return r.returncode, (r.stdout or "").strip(), (r.stderr or "").strip()
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except Exception as e:
        return 1, "", str(e)


def _read_local_os_release() -> Dict[str, str]:
    data: Dict[str, str] = {}
    path = Path("/etc/os-release")
    if not path.is_file():
        return data
    try:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                data[k.strip()] = v.strip().strip('"')
    except OSError:
        pass
    return data


def _parse_os_release_text(text: str) -> Dict[str, str]:
    data: Dict[str, str] = {}
    for line in text.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            data[k.strip()] = v.strip().strip('"')
    return data


def local_rsync_available() -> bool:
    return shutil.which("rsync") is not None


def compatibility_check(
    host: str,
    port: int,
    user: str,
    identity_file: Optional[str] = None,
    *,
    min_free_bytes: int = 0,
) -> Dict[str, Any]:
    """Compare local vs remote for migration-style sync (MVP)."""
    if _is_windows():
        return {
            "items": [_item("platform", "block", "rsync_manager runs on Linux panel hosts only.")],
            "can_proceed": False,
        }

    validate_ssh_target(host, port, user, identity_file)

    items: List[Dict[str, Any]] = []
    blocking = False

    if not local_rsync_available():
        items.append(_item("rsync_local", "block", "rsync is not installed on this server.", target="missing"))
        blocking = True
    else:
        vcode, vout, _ = _run_capture(["rsync", "--version"], 10)
        ver = (vout.splitlines()[0] if vout else "rsync")[:120]
        items.append(_item("rsync_local", "ok", "rsync available on panel host.", source=ver))

    code, arch_out, _ = _run_capture(["uname", "-m"], 10)
    local_arch = arch_out if code == 0 else "unknown"

    local_os = _read_local_os_release()
    local_id = local_os.get("ID", "unknown")
    local_ver = local_os.get("VERSION_ID", "")

    ssh = _ssh_cmd(host, port, user, identity_file, ["uname", "-m"])
    rcode, remote_arch, rerr = _run_capture(ssh, 45)
    if rcode != 0:
        items.append(
            _item(
                "ssh",
                "block",
                f"Cannot run remote uname via SSH: {rerr or 'connection failed'}",
                source=local_arch,
                target="",
            )
        )
        blocking = True
        return {"items": items, "can_proceed": False}

    if local_arch != remote_arch:
        items.append(
            _item(
                "arch",
                "block",
                "CPU architecture must match between source and target for CoPanel file sync.",
                source=local_arch,
                target=remote_arch,
            )
        )
        blocking = True
    else:
        items.append(_item("arch", "ok", "Architecture matches.", source=local_arch, target=remote_arch))

    ssh_cat = _ssh_cmd(host, port, user, identity_file, ["cat", "/etc/os-release"])
    oc, remote_os_text, _ = _run_capture(ssh_cat, 30)
    remote_os = _parse_os_release_text(remote_os_text) if oc == 0 else {}
    remote_id = remote_os.get("ID", "unknown")
    remote_ver = remote_os.get("VERSION_ID", "")

    if local_id != remote_id:
        items.append(
            _item(
                "os_family",
                "warn",
                f"OS ID differs (source {local_id} vs target {remote_id}). Prefer matching Alma/Rocky/RHEL or matching Debian/Ubuntu.",
                source=f"{local_id} {local_ver}".strip(),
                target=f"{remote_id} {remote_ver}".strip(),
            )
        )
    else:
        items.append(
            _item(
                "os_family",
                "ok",
                "Same OS ID.",
                source=f"{local_id} {local_ver}".strip(),
                target=f"{remote_id} {remote_ver}".strip(),
            )
        )

    ssh_rsync = _ssh_cmd(host, port, user, identity_file, ["command", "-v", "rsync"])
    rc_rsync, _, _ = _run_capture(ssh_rsync, 30)
    if rc_rsync != 0:
        items.append(_item("rsync_remote", "block", "rsync not found on target. Install: dnf install -y rsync or apt install -y rsync."))
        blocking = True
    else:
        items.append(_item("rsync_remote", "ok", "rsync is available on target."))

    if min_free_bytes > 0:
        ssh_df = _ssh_cmd(
            host,
            port,
            user,
            identity_file,
            ["df", "-B1", "--output=avail", "/"],
        )
        dcode, df_out, _ = _run_capture(ssh_df, 30)
        avail = 0
        if dcode == 0 and df_out:
            lines = [ln.strip() for ln in df_out.splitlines() if ln.strip()]
            if len(lines) >= 2:
                last_cell = lines[-1].split()[-1]
                if last_cell.isdigit():
                    avail = int(last_cell)
        if dcode != 0 and min_free_bytes > 0:
            items.append(
                _item(
                    "disk_target",
                    "warn",
                    "Could not read free space on target (df). Verify disk manually before a large sync.",
                )
            )
        elif avail > 0 and avail < min_free_bytes:
            items.append(
                _item(
                    "disk_target",
                    "block",
                    "Not enough free space on target root filesystem for estimated transfer.",
                    target=str(avail),
                )
            )
            blocking = True
        elif avail > 0:
            items.append(_item("disk_target", "ok", "Target root has free space per estimate.", target=str(avail)))

    can_proceed = not blocking and not any(x["severity"] == "block" for x in items)
    return {"items": items, "can_proceed": can_proceed}


def run_rsync(
    host: str,
    port: int,
    user: str,
    identity_file: Optional[str],
    local_path: str,
    remote_path: str,
    excludes: List[str],
    *,
    dry_run: bool,
    delete: bool,
    timeout_sec: int = 3600,
) -> Dict[str, Any]:
    if _is_windows():
        raise RuntimeError("rsync_manager is Linux-only.")

    validate_ssh_target(host, port, user, identity_file)
    lp = validate_local_path(local_path)
    rp = validate_remote_path(remote_path)
    ex = validate_excludes(excludes)

    if not shutil.which("rsync"):
        raise RuntimeError("rsync not installed on panel host.")

    ssh_part = f"ssh -p {int(port)} -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
    if identity_file:
        ssh_part += f" -i {shlex.quote(identity_file)}"

    src = str(lp).rstrip("/") + "/"
    dst = f"{user}@{host}:{rp.rstrip('/')}/"

    args = ["rsync", "-a", "--info=stats2"]
    if dry_run:
        args.append("--dry-run")
    if delete:
        args.append("--delete")
    for pat in ex:
        args.extend(["--exclude", pat])
    args.extend(["-e", ssh_part, src, dst])

    try:
        r = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=max(30, min(timeout_sec, 86400)),
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "exit_code": 124,
            "stdout_tail": "",
            "stderr_tail": "rsync timed out",
        }

    out = (r.stdout or "")[-24000:]
    err = (r.stderr or "")[-12000:]
    return {
        "ok": r.returncode == 0,
        "exit_code": r.returncode,
        "stdout_tail": out,
        "stderr_tail": err,
    }
