"""
WebDAV + SMB file sharing — CoPanel superadmin credentials.

Clients connect via server IP:port. Login uses the same username/password
as the panel root (superadmin) account.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from core import user_model
from core.security import verify_password

from . import webdav_server

IS_WINDOWS = os.name == "nt"

STORE_PATH = (
    Path("./test_nginx/webdav.json")
    if IS_WINDOWS
    else Path("/var/lib/copanel/webdav.json")
)
SMB_CONF_PATH = Path("/etc/samba/smb.conf.d/copanel-webdav.conf")
SMB_CONF_MARKERS = (
    "include = /etc/samba/smb.conf.d/*.conf",
    "include = smb.conf.d/*.conf",
    "copanel-webdav.conf",
)

DEFAULT_CONFIG: Dict[str, Any] = {
    "bind_address": "0.0.0.0",
    "webdav_port": 8085,
    "smb_port": 445,
    "share_path": "/",
    "share_name": "copanel",
    "webdav_enabled": False,
    "smb_enabled": False,
    "updated_at": 0.0,
}


def _default_store() -> Dict[str, Any]:
    return dict(DEFAULT_CONFIG)


def _load_store() -> Dict[str, Any]:
    if not STORE_PATH.exists():
        STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        STORE_PATH.write_text(json.dumps(_default_store(), indent=2), encoding="utf-8")
    try:
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except Exception:
        data = _default_store()
    for key, val in DEFAULT_CONFIG.items():
        if key not in data:
            data[key] = val
    return data


def _save_store(data: Dict[str, Any]) -> None:
    data["updated_at"] = time.time()
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STORE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _run(cmd: List[str], *, input_text: Optional[str] = None, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        input=input_text,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _run_privileged(cmd: List[str], *, input_text: Optional[str] = None, timeout: int = 60) -> subprocess.CompletedProcess:
    """Run as root; retry with sudo -n when the panel service is not root."""
    proc = _run(cmd, input_text=input_text, timeout=timeout)
    if proc.returncode == 0:
        return proc
    if IS_WINDOWS:
        return proc
    sudo_cmd = ["sudo", "-n", *cmd]
    return _run(sudo_cmd, input_text=input_text, timeout=timeout)


def _unix_user_exists(username: str) -> bool:
    return _run(["id", "-u", username]).returncode == 0


def _ensure_unix_user(username: str) -> None:
    """Samba requires a real Linux account matching the SMB login name."""
    if _unix_user_exists(username):
        return
    proc = _run_privileged(
        ["useradd", "-M", "-s", "/usr/sbin/nologin", username],
    )
    if proc.returncode != 0 and not _unix_user_exists(username):
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(
            f"Cannot create Linux user '{username}' for SMB (Samba needs a system account): {err}"
        )


def _smb_user_exists(username: str) -> bool:
    proc = _run_privileged(["pdbedit", "-L"])
    if proc.returncode != 0:
        return False
    prefix = f"{username}:"
    return any(line.startswith(prefix) for line in (proc.stdout or "").splitlines())


def _write_file_privileged(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_text(content, encoding="utf-8")
        return
    except OSError:
        pass
    proc = _run_privileged(["tee", str(path)], input_text=content)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"Cannot write {path}: {err}")


def _ensure_smb_main_include() -> None:
    """Ensure smb.conf loads smb.conf.d snippets (Debian/Ubuntu default pattern)."""
    main_conf = Path("/etc/samba/smb.conf")
    if not main_conf.is_file():
        return
    try:
        content = main_conf.read_text(encoding="utf-8")
    except OSError:
        return
    if any(marker in content for marker in SMB_CONF_MARKERS):
        return
    include_line = "\n# CoPanel webdav\ninclude = /etc/samba/smb.conf.d/*.conf\n"
    try:
        main_conf.write_text(content.rstrip() + include_line, encoding="utf-8")
        return
    except OSError:
        pass
    _run_privileged(["tee", "-a", str(main_conf)], input_text=include_line)


def _build_smb_conf_text(
    share_name: str,
    share_path: str,
    admin_user: str,
    smb_port: int,
) -> str:
    return f"""# Managed by CoPanel webdav module — do not edit manually
[global]
    map to guest = never
    load printers = no
    printing = bsd
    disable spoolss = yes
    server min protocol = SMB2
    client min protocol = SMB2
    smb ports = {smb_port}

[homes]
    browseable = no
    available = no

[{share_name}]
    comment = CoPanel file share
    path = {share_path}
    browseable = yes
    available = yes
    read only = no
    guest ok = no
    valid users = {admin_user}
    force user = root
    force group = root
    create mask = 0664
    directory mask = 0775
    acl allow execute always = yes
"""


def _smb_diagnostics(share_name: str, share_path: str) -> Dict[str, Any]:
    diag: Dict[str, Any] = {
        "share_name": share_name,
        "share_path": share_path,
        "config_file": str(SMB_CONF_PATH),
        "config_exists": SMB_CONF_PATH.is_file(),
        "shares_registered": [],
        "share_registered": False,
        "testparm_ok": False,
        "path_entry_count": 0,
    }
    if IS_WINDOWS:
        return diag

    if SMB_CONF_PATH.is_file():
        try:
            diag["config_preview"] = SMB_CONF_PATH.read_text(encoding="utf-8")[:800]
        except OSError:
            pass

    tp = _run_privileged(["testparm", "-s"])
    if tp.returncode == 0:
        diag["testparm_ok"] = True
        for line in (tp.stdout or "").splitlines():
            stripped = line.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                name = stripped[1:-1]
                if name not in ("global", "homes"):
                    diag["shares_registered"].append(name)
        diag["share_registered"] = share_name in diag["shares_registered"]
    else:
        diag["testparm_error"] = (tp.stderr or tp.stdout or "").strip()[:500]

    try:
        p = Path(share_path)
        if p.is_dir():
            diag["path_entry_count"] = len(list(p.iterdir()))
    except OSError:
        pass

    return diag


def _smb_set_password(username: str, password: str) -> None:
    _ensure_unix_user(username)
    pwd_input = f"{password}\n{password}\n"
    if _smb_user_exists(username):
        proc = _run_privileged(
            ["smbpasswd", "-s", username],
            input_text=pwd_input,
        )
    else:
        proc = _run_privileged(
            ["smbpasswd", "-s", "-a", username],
            input_text=pwd_input,
        )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"smbpasswd failed: {err}")
    _run_privileged(["smbpasswd", "-e", username])


def _get_superadmin() -> Optional[Dict[str, Any]]:
    for user in user_model.get_all_users():
        if user.get("role") == "superadmin":
            return user_model.get_user_by_username(user["username"])
    return None


def _admin_password_plain() -> Optional[str]:
    pwd_path = user_model.PWD_PATH
    if pwd_path.is_file():
        try:
            text = pwd_path.read_text(encoding="utf-8").strip()
            if text:
                return text
        except Exception:
            pass
    return None


def _save_admin_password_file(password: str) -> None:
    user_model.PWD_PATH.parent.mkdir(parents=True, exist_ok=True)
    user_model.PWD_PATH.write_text(password)


def _resolve_admin_password(plain: Optional[str] = None) -> str:
    """Return superadmin plaintext password for smbpasswd (file or verified input)."""
    if plain:
        admin = _get_superadmin()
        if not admin:
            raise ValueError("No superadmin user found in CoPanel.")
        if not verify_password(plain, admin.get("password_hash", "")):
            raise ValueError("Password does not match the panel superadmin account.")
        _save_admin_password_file(plain)
        return plain

    stored = _admin_password_plain()
    if stored:
        admin = _get_superadmin()
        if admin and verify_password(stored, admin.get("password_hash", "")):
            return stored
        # Stale file — ignore and ask user to re-enter
    raise ValueError(
        "Enter your panel superadmin password below to sync SMB. "
        "It must match the account you use to log in to CoPanel."
    )


def _local_ips() -> List[str]:
    ips: List[str] = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and ip not in ips:
                ips.insert(0, ip)
    except Exception:
        pass
    return ips or ["127.0.0.1"]


def _validate_share_path(path: str) -> str:
    p = Path(path).expanduser()
    if not p.is_absolute():
        raise ValueError("Share path must be an absolute path.")
    resolved = p.resolve()
    if not IS_WINDOWS and not resolved.exists():
        raise ValueError(f"Share path does not exist: {resolved}")
    return str(resolved)


def _validate_bind_address(addr: str) -> str:
    addr = (addr or "0.0.0.0").strip()
    if addr in {"0.0.0.0", "::", "::0", "*"}:
        return "0.0.0.0"
    try:
        socket.inet_aton(addr)
    except OSError as exc:
        raise ValueError(f"Invalid bind address: {addr}") from exc
    return addr


def _validate_share_name(name: str) -> str:
    name = (name or "copanel").strip().strip("/")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", name):
        raise ValueError("Share name must be 1-32 chars: letters, digits, _ or -.")
    return name


def get_module_version() -> Dict[str, str]:
    version_file = Path(__file__).resolve().parent / "version.txt"
    version = version_file.read_text(encoding="utf-8").strip() if version_file.is_file() else "0.0.0"
    return {"module": "webdav", "version": version}


def get_public_config() -> Dict[str, Any]:
    cfg = _load_store()
    admin = _get_superadmin()
    return {
        "bind_address": cfg["bind_address"],
        "webdav_port": cfg["webdav_port"],
        "smb_port": cfg["smb_port"],
        "share_path": cfg["share_path"],
        "share_name": cfg["share_name"],
        "webdav_enabled": bool(cfg.get("webdav_enabled")),
        "smb_enabled": bool(cfg.get("smb_enabled")),
        "updated_at": cfg.get("updated_at", 0),
        "admin_username": admin["username"] if admin else "admin",
        "local_ips": _local_ips(),
        "is_linux": not IS_WINDOWS,
        "samba_installed": shutil.which("smbd") is not None or Path("/usr/sbin/smbd").exists(),
        "wsgidav_available": _wsgidav_available(),
        "admin_password_file_present": user_model.PWD_PATH.is_file(),
    }


def _wsgidav_available() -> bool:
    try:
        import wsgidav  # noqa: F401
        import cheroot  # noqa: F401
        return True
    except ImportError:
        return False


def save_config(updates: Dict[str, Any]) -> Dict[str, Any]:
    smb_password = updates.pop("smb_password", None)
    cfg = _load_store()
    if updates.get("bind_address") is not None:
        cfg["bind_address"] = _validate_bind_address(updates["bind_address"])
    if updates.get("webdav_port") is not None:
        cfg["webdav_port"] = int(updates["webdav_port"])
    if updates.get("smb_port") is not None:
        cfg["smb_port"] = int(updates["smb_port"])
    if updates.get("share_path") is not None:
        cfg["share_path"] = _validate_share_path(updates["share_path"])
    if updates.get("share_name") is not None:
        cfg["share_name"] = _validate_share_name(updates["share_name"])
    if updates.get("webdav_enabled") is not None:
        cfg["webdav_enabled"] = bool(updates["webdav_enabled"])
    if updates.get("smb_enabled") is not None:
        cfg["smb_enabled"] = bool(updates["smb_enabled"])
    _save_store(cfg)
    _apply_services(cfg, smb_password=smb_password)
    return get_public_config()


def _apply_services(cfg: Dict[str, Any], *, smb_password: Optional[str] = None) -> None:
    if cfg.get("webdav_enabled"):
        if not _wsgidav_available():
            raise RuntimeError("wsgidav is not installed. Run: pip install wsgidav")
        webdav_server.start_server(
            cfg["bind_address"],
            int(cfg["webdav_port"]),
            cfg["share_path"],
            cfg["share_name"],
        )
    else:
        webdav_server.stop_server()

    if cfg.get("smb_enabled"):
        apply_smb_config(cfg, admin_password=smb_password)


def get_status() -> Dict[str, Any]:
    cfg = _load_store()
    webdav_running = webdav_server.is_running()
    webdav_cfg = webdav_server.running_config()
    smb_status = _smb_service_status()
    ips = _local_ips()
    host = ips[0] if ips else "127.0.0.1"
    share = cfg["share_name"]
    return {
        "webdav": {
            "enabled": bool(cfg.get("webdav_enabled")),
            "running": webdav_running,
            "url": f"http://{host}:{cfg['webdav_port']}/{share}/",
            "bind_address": cfg["bind_address"],
            "port": cfg["webdav_port"],
            "running_config": webdav_cfg,
        },
        "smb": {
            "enabled": bool(cfg.get("smb_enabled")),
            "running": smb_status.get("active", False),
            "unc_path": f"\\\\{host}\\{share}",
            "port": cfg["smb_port"],
            "service": smb_status,
            "diagnostics": _smb_diagnostics(share, cfg["share_path"]),
        },
        "share_path": cfg["share_path"],
        "share_name": cfg["share_name"],
        "admin_username": get_public_config()["admin_username"],
        "connection_hint": (
            f"WebDAV: http://<IP>:{cfg['webdav_port']}/{share}/ — "
            f"SMB: \\\\<IP>\\{share} — login = panel root user"
        ),
    }


def _smb_service_status() -> Dict[str, Any]:
    if IS_WINDOWS:
        return {"active": False, "message": "SMB management is Linux-only."}
    for unit in ("smbd", "samba"):
        proc = _run(["systemctl", "is-active", unit])
        state = (proc.stdout or proc.stderr or "").strip()
        if state in {"active", "inactive", "failed", "unknown"}:
            return {"unit": unit, "active": state == "active", "state": state}
    return {"active": False, "state": "unknown"}


def apply_smb_config(cfg: Optional[Dict[str, Any]] = None, *, admin_password: Optional[str] = None) -> Dict[str, Any]:
    if IS_WINDOWS:
        return {"applied": False, "message": "SMB is only supported on Linux."}

    cfg = cfg or _load_store()
    share_path = _validate_share_path(cfg["share_path"])
    share_name = _validate_share_name(cfg["share_name"])
    smb_port = int(cfg.get("smb_port") or 445)

    admin = _get_superadmin()
    if not admin:
        raise ValueError("No superadmin user found in CoPanel.")

    admin_user = admin["username"]
    admin_pass = _resolve_admin_password(admin_password)

    if not shutil.which("smbpasswd") and not Path("/usr/bin/smbpasswd").exists():
        raise RuntimeError("samba is not installed. Install: apt install samba")

    _ensure_smb_main_include()
    conf_text = _build_smb_conf_text(share_name, share_path, admin_user, smb_port)
    _write_file_privileged(SMB_CONF_PATH, conf_text)

    _smb_set_password(admin_user, admin_pass)

    restart = _run_privileged(["systemctl", "restart", "smbd"])
    if restart.returncode != 0:
        restart = _run_privileged(["systemctl", "restart", "samba"])

    diag = _smb_diagnostics(share_name, share_path)
    if not diag.get("share_registered"):
        err = diag.get("testparm_error") or "Share not loaded by Samba after apply."
        raise RuntimeError(
            f"SMB share [{share_name}] not registered. {err} "
            f"Run: sudo testparm -s | grep -A5 '\\[{share_name}\\]'"
        )

    return {
        "applied": True,
        "share_name": share_name,
        "share_path": share_path,
        "admin_username": admin_user,
        "smb_port": smb_port,
        "restart_ok": restart.returncode == 0,
        "restart_message": (restart.stderr or restart.stdout or "").strip(),
        "diagnostics": diag,
    }


def sync_smb_password(admin_password: Optional[str] = None) -> Dict[str, Any]:
    """Re-sync Samba password from panel admin password file or verified input."""
    cfg = _load_store()
    if not cfg.get("smb_enabled"):
        return {"synced": False, "message": "SMB is disabled."}
    result = apply_smb_config(cfg, admin_password=admin_password)
    return {"synced": True, **result}


def webdav_action(action: str) -> Dict[str, Any]:
    cfg = _load_store()
    if action == "stop":
        return webdav_server.stop_server()
    if action == "start":
        if not cfg.get("webdav_enabled"):
            raise ValueError("Enable WebDAV in settings first.")
        return webdav_server.start_server(
            cfg["bind_address"],
            int(cfg["webdav_port"]),
            cfg["share_path"],
            cfg["share_name"],
        )
    if action == "restart":
        return webdav_server.restart_server(
            cfg["bind_address"],
            int(cfg["webdav_port"]),
            cfg["share_path"],
            cfg["share_name"],
        )
    raise ValueError(f"Unknown action: {action}")


def smb_action(action: str, admin_password: Optional[str] = None) -> Dict[str, Any]:
    if IS_WINDOWS:
        return {"ok": False, "message": "SMB is Linux-only."}
    cfg = _load_store()
    if action == "apply":
        return apply_smb_config(cfg, admin_password=admin_password)
    unit = "smbd"
    proc = _run(["systemctl", action, unit])
    if proc.returncode != 0:
        proc = _run(["systemctl", action, "samba"])
    ok = proc.returncode == 0
    return {
        "ok": ok,
        "action": action,
        "message": (proc.stderr or proc.stdout or "").strip() or ("OK" if ok else "Failed"),
    }


def restore_on_startup() -> None:
    """Called from router startup — resume WebDAV if enabled."""
    try:
        cfg = _load_store()
        if cfg.get("webdav_enabled") and _wsgidav_available():
            webdav_server.start_server(
                cfg["bind_address"],
                int(cfg["webdav_port"]),
                cfg["share_path"],
                cfg["share_name"],
            )
    except Exception:
        pass
