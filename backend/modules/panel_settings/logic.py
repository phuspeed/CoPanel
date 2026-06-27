"""
CoPanel system settings: SSH port, Linux root password, Nginx gate on :8686, panel 2FA.
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import pyotp

from passlib.hash import apr_md5_crypt

from core import user_model
from core.security import verify_password

IS_WINDOWS = os.name == "nt"

CONFIG_DIR = (
    Path("./test_nginx/panel_settings")
    if IS_WINDOWS
    else Path("/opt/copanel/config")
)
STORE_PATH = CONFIG_DIR / "panel_settings.json"
HTPASSWD_PATH = CONFIG_DIR / "panel_access.htpasswd"
NGINX_SITE = Path("/etc/nginx/sites-available/copanel")
SSHD_CONFIG = Path("/etc/ssh/sshd_config")
PANEL_PORT = 8686

NGINX_AUTH_START = "# BEGIN COPANEL NGINX GATE"
NGINX_AUTH_END = "# END COPANEL NGINX GATE"


def _run(cmd: List[str], *, input_text: Optional[str] = None, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        input=input_text,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _run_privileged(cmd: List[str], *, input_text: Optional[str] = None, timeout: int = 120) -> subprocess.CompletedProcess:
    proc = _run(cmd, input_text=input_text, timeout=timeout)
    if proc.returncode == 0 or IS_WINDOWS:
        return proc
    return _run(["sudo", "-n", *cmd], input_text=input_text, timeout=timeout)


def _write_file_privileged(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_text(content, encoding="utf-8")
        return
    except OSError:
        pass
    proc = _run_privileged(["tee", str(path)], input_text=content)
    if proc.returncode != 0:
        raise RuntimeError(f"Cannot write {path}: {(proc.stderr or proc.stdout or '').strip()}")


def _default_store() -> Dict[str, Any]:
    return {
        "nginx_gate": {"enabled": False, "username": "copanel"},
        "updated_at": time.time(),
    }


def _load_store() -> Dict[str, Any]:
    if not STORE_PATH.exists():
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        STORE_PATH.write_text(json.dumps(_default_store(), indent=2), encoding="utf-8")
    try:
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except Exception:
        data = _default_store()
    for k, v in _default_store().items():
        data.setdefault(k, v if not isinstance(v, dict) else dict(v))
    return data


def _save_store(data: Dict[str, Any]) -> None:
    data["updated_at"] = time.time()
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    STORE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def get_module_version() -> Dict[str, str]:
    vf = Path(__file__).resolve().parent / "version.txt"
    ver = vf.read_text(encoding="utf-8").strip() if vf.is_file() else "0.0.0"
    return {"module": "panel_settings", "version": ver}


def _read_ssh_port() -> int:
    if IS_WINDOWS or not SSHD_CONFIG.is_file():
        return 22
    try:
        for line in SSHD_CONFIG.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if s.lower().startswith("port ") and not s.startswith("#"):
                return int(s.split()[1])
    except Exception:
        pass
    return 22


def _nginx_site_path() -> Path:
    if NGINX_SITE.is_file():
        return NGINX_SITE
    alt = Path("/etc/nginx/conf.d/copanel.conf")
    if alt.is_file():
        return alt
    return NGINX_SITE


def _nginx_has_gate() -> bool:
    path = _nginx_site_path()
    if not path.is_file():
        return False
    try:
        return NGINX_AUTH_START in path.read_text(encoding="utf-8")
    except OSError:
        return False


def get_settings() -> Dict[str, Any]:
    store = _load_store()
    gate = store.get("nginx_gate") or {}
    admin = _admin_user()
    return {
        "ssh_port": _read_ssh_port(),
        "panel_port": PANEL_PORT,
        "nginx_gate": {
            "enabled": bool(gate.get("enabled")) or _nginx_has_gate(),
            "username": gate.get("username") or "copanel",
            "configured": HTPASSWD_PATH.is_file(),
        },
        "totp": {
            "enabled": bool(admin.get("totp_enabled")) if admin else False,
            "username": admin.get("username") if admin else "admin",
        },
        "is_linux": not IS_WINDOWS,
    }


def _admin_user() -> Optional[Dict[str, Any]]:
    for row in user_model.get_all_users():
        if row.get("role") == "superadmin":
            return user_model.get_user_by_username(row["username"])
    return None


def change_ssh_port(port: int, *, confirm: bool = False) -> Dict[str, Any]:
    if IS_WINDOWS:
        raise ValueError("SSH port change is Linux-only.")
    if port == _read_ssh_port():
        return {"port": port, "changed": False, "message": "SSH port unchanged."}
    if not confirm:
        raise ValueError("Set confirm=true to apply SSH port change (risk of lockout).")

    if not SSHD_CONFIG.is_file():
        raise RuntimeError("/etc/ssh/sshd_config not found.")

    content = SSHD_CONFIG.read_text(encoding="utf-8")
    replaced = False
    lines: List[str] = []
    for line in content.splitlines():
        if line.strip().lower().startswith("port ") and not line.strip().startswith("#"):
            lines.append(f"Port {port}")
            replaced = True
        else:
            lines.append(line)
    if not replaced:
        lines.append(f"Port {port}")
    _write_file_privileged(SSHD_CONFIG, "\n".join(lines) + "\n")

    test = _run_privileged(["sshd", "-t"])
    if test.returncode != 0:
        raise RuntimeError(f"sshd config test failed: {(test.stderr or test.stdout or '').strip()}")

    _run_privileged(["ufw", "allow", f"{port}/tcp"])
    restart = _run_privileged(["systemctl", "restart", "ssh"])
    if restart.returncode != 0:
        restart = _run_privileged(["systemctl", "restart", "sshd"])

    return {
        "port": port,
        "changed": True,
        "message": f"SSH port set to {port}. Keep this session open; test new port before closing.",
        "restart_ok": restart.returncode == 0,
    }


def change_root_password(new_password: str, confirm_password: str) -> Dict[str, Any]:
    if IS_WINDOWS:
        raise ValueError("Root password change is Linux-only.")
    if new_password != confirm_password:
        raise ValueError("Password confirmation does not match.")
    proc = _run_privileged(["chpasswd"], input_text=f"root:{new_password}\n")
    if proc.returncode != 0:
        raise RuntimeError(f"chpasswd failed: {(proc.stderr or proc.stdout or '').strip()}")
    return {"changed": True, "message": "Linux root password updated."}


def _inject_nginx_gate_block(content: str, htpasswd_path: str) -> str:
    block = (
        f"    {NGINX_AUTH_START}\n"
        f'    auth_basic "CoPanel";\n'
        f"    auth_basic_user_file {htpasswd_path};\n"
        f"    {NGINX_AUTH_END}\n"
    )
    if NGINX_AUTH_START in content:
        content = re.sub(
            rf"\s*{re.escape(NGINX_AUTH_START)}.*?{re.escape(NGINX_AUTH_END)}\n?",
            "\n" + block,
            content,
            count=1,
            flags=re.DOTALL,
        )
        return content
    # Server-level auth protects UI + /api/ on the panel port.
    anchor = "    server_name "
    idx = content.find(anchor)
    if idx != -1:
        eol = content.find("\n", idx)
        if eol != -1:
            return content[: eol + 1] + block + content[eol + 1 :]
    marker = "location / {"
    if marker in content:
        return content.replace(marker, block + "\n    " + marker, 1)
    return content.rstrip() + "\n" + block


def _remove_nginx_gate_block(content: str) -> str:
    if NGINX_AUTH_START not in content:
        return content
    return re.sub(
        rf"\s*{re.escape(NGINX_AUTH_START)}.*?{re.escape(NGINX_AUTH_END)}\n?",
        "\n",
        content,
        count=1,
        flags=re.DOTALL,
    )


def _write_nginx_htpasswd(username: str, password: str) -> str:
    """Write nginx auth_basic_user_file using passlib (no apache2-utils)."""
    ht_line = f"{username}:{apr_md5_crypt.hash(password)}\n"
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    _write_file_privileged(HTPASSWD_PATH, ht_line)
    try:
        HTPASSWD_PATH.chmod(0o644)
    except OSError:
        _run_privileged(["chmod", "644", str(HTPASSWD_PATH)])
    return str(HTPASSWD_PATH)


def configure_nginx_gate(enabled: bool, username: Optional[str], password: Optional[str]) -> Dict[str, Any]:
    if IS_WINDOWS:
        raise ValueError("Nginx gate is Linux-only.")
    store = _load_store()
    gate = store.setdefault("nginx_gate", {"enabled": False, "username": "copanel"})
    site = _nginx_site_path()
    if not site.is_file():
        raise RuntimeError(f"Nginx site config not found: {site}")

    if enabled:
        user = (username or gate.get("username") or "copanel").strip()
        if not user:
            raise ValueError("Gate username required.")
        if not password:
            raise ValueError("Gate password required when enabling.")

        ht_path = _write_nginx_htpasswd(user, password)

        content = site.read_text(encoding="utf-8")
        content = _inject_nginx_gate_block(content, ht_path)
        _write_file_privileged(site, content)
        gate.update({"enabled": True, "username": user})
    else:
        content = site.read_text(encoding="utf-8")
        content = _remove_nginx_gate_block(content)
        _write_file_privileged(site, content)
        if HTPASSWD_PATH.is_file():
            try:
                HTPASSWD_PATH.unlink()
            except OSError:
                pass
        gate["enabled"] = False

    _save_store(store)
    test = _run_privileged(["nginx", "-t"])
    if test.returncode != 0:
        raise RuntimeError(f"nginx -t failed: {(test.stderr or test.stdout or '').strip()}")
    reload = _run_privileged(["systemctl", "reload", "nginx"])
    return {
        "enabled": enabled,
        "username": gate.get("username"),
        "panel_port": PANEL_PORT,
        "reload_ok": reload.returncode == 0,
        "message": (
            f"Nginx password gate {'enabled' if enabled else 'disabled'} on port {PANEL_PORT}."
        ),
    }


def totp_setup(username: str) -> Dict[str, Any]:
    user = user_model.get_user_by_username(username)
    if not user or user.get("role") != "superadmin":
        raise ValueError("2FA can only be configured for the superadmin account.")

    secret = pyotp.random_base32()
    user_model.set_totp_pending(user["id"], secret)
    uri = pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name="CoPanel")

    qr_b64 = ""
    try:
        import qrcode

        img = qrcode.make(uri)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        qr_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        pass

    return {
        "secret": secret,
        "otpauth_uri": uri,
        "qr_png_base64": qr_b64,
        "issuer": "CoPanel",
    }


def totp_enable(username: str, code: str) -> Dict[str, Any]:
    user = user_model.get_user_by_username(username)
    if not user:
        raise ValueError("User not found.")
    secret = user.get("totp_pending") or ""
    if not secret:
        raise ValueError("Run 2FA setup first.")
    totp = pyotp.TOTP(secret)
    if not totp.verify(code.strip(), valid_window=1):
        raise ValueError("Invalid authenticator code.")
    user_model.enable_totp(user["id"], secret)
    return {"enabled": True, "message": "Two-factor authentication enabled."}


def totp_disable(username: str, password: str, code: str) -> Dict[str, Any]:
    user = user_model.get_user_by_username(username)
    if not user:
        raise ValueError("User not found.")
    if not verify_password(password, user.get("password_hash", "")):
        raise ValueError("Incorrect panel password.")
    secret = user.get("totp_secret") or ""
    if secret and not pyotp.TOTP(secret).verify(code.strip(), valid_window=1):
        raise ValueError("Invalid authenticator code.")
    user_model.disable_totp(user["id"])
    return {"enabled": False, "message": "Two-factor authentication disabled."}


def verify_user_totp(user: Dict[str, Any], code: Optional[str]) -> None:
    if not user.get("totp_enabled"):
        return
    secret = user.get("totp_secret") or ""
    if not secret:
        return
    if not code:
        raise ValueError("TOTP_REQUIRED")
    if not pyotp.TOTP(secret).verify(code.strip(), valid_window=1):
        raise ValueError("Invalid two-factor code.")
