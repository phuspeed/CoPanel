"""
CoPanel system settings: SSH port, Linux root password, Nginx gate on :8686, panel 2FA.
"""
from __future__ import annotations

import base64
import io
import ipaddress
import json
import logging
import os
import platform
import re
import socket
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import psutil
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
NGINX_EXEMPT_TAG = "# COPANEL NGINX GATE EXEMPT"

logger = logging.getLogger(__name__)

# Locations that must not inherit HTTP basic auth (API JWT, static assets, health).
NGINX_EXEMPT_LOCATION_MARKERS = (
    "location /api/platform/events {",
    "location /api/ {",
    "location /health {",
    "location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {",
)

_VIRTUAL_IFACE_PREFIXES = (
    "docker",
    "veth",
    "br-",
    "virbr",
    "vmnet",
    "tun",
    "tap",
    "wg",
    "tailscale",
    "cni",
    "flannel",
)


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


def _cmd_json(cmd: List[str]) -> Any:
    proc = _run(cmd, timeout=30)
    if proc.returncode != 0:
        return None
    try:
        return json.loads(proc.stdout or "null")
    except json.JSONDecodeError:
        return None


def _is_virtual_iface(name: str) -> bool:
    n = name.lower()
    if n in ("lo", "lo0"):
        return True
    return any(n.startswith(p) for p in _VIRTUAL_IFACE_PREFIXES)


def _ipv4_is_private(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr)
        return bool(ip.is_private and not ip.is_loopback)
    except ValueError:
        return False


def _iface_ipv4_entries(name: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for row in psutil.net_if_addrs().get(name, []):
        if row.family != socket.AF_INET:
            continue
        prefix = None
        if row.netmask:
            try:
                prefix = ipaddress.ip_network(f"0.0.0.0/{row.netmask}", strict=False).prefixlen
            except ValueError:
                prefix = None
        rows.append(
            {
                "address": row.address,
                "netmask": row.netmask,
                "prefix": prefix,
                "broadcast": row.broadcast,
            }
        )
    return rows


def _iface_mac(name: str) -> Optional[str]:
    for row in psutil.net_if_addrs().get(name, []):
        fam = getattr(psutil, "AF_LINK", None)
        if fam is not None and row.family == fam and row.address:
            return row.address
    return None


def _read_default_gateway() -> Optional[str]:
    data = _cmd_json(["ip", "-j", "route", "show", "default"])
    if isinstance(data, list):
        for route in data:
            if route.get("dst") in ("default", "0.0.0.0/0"):
                gw = route.get("gateway")
                if gw:
                    return str(gw)
    proc = _run(["ip", "route", "show", "default"], timeout=15)
    if proc.returncode == 0 and proc.stdout:
        parts = proc.stdout.split()
        for i, part in enumerate(parts):
            if part == "via" and i + 1 < len(parts):
                return parts[i + 1]
    return None


def _read_dns_servers() -> List[str]:
    servers: List[str] = []
    resolve = _run(["resolvectl", "status"], timeout=15)
    if resolve.returncode == 0 and resolve.stdout:
        for line in resolve.stdout.splitlines():
            s = line.strip()
            if "DNS Servers:" in s or s.startswith("DNS Server:"):
                tail = s.split(":", 1)[-1].strip()
                if tail:
                    servers.extend(x.strip() for x in tail.split() if x.strip())
    if servers:
        return list(dict.fromkeys(servers))
    resolv = Path("/etc/resolv.conf")
    if resolv.is_file():
        for line in resolv.read_text(encoding="utf-8", errors="ignore").splitlines():
            s = line.strip()
            if s.startswith("nameserver "):
                ip = s.split()[1]
                if ip not in ("127.0.0.53", "127.0.0.1"):
                    servers.append(ip)
    return list(dict.fromkeys(servers))


def _nmcli_available() -> bool:
    if IS_WINDOWS:
        return False
    proc = _run(["which", "nmcli"], timeout=10)
    return proc.returncode == 0


def _nmcli_connection_for_device(device: str) -> Optional[str]:
    proc = _run(["nmcli", "-t", "-f", "DEVICE,CONNECTION", "device", "status"], timeout=20)
    if proc.returncode != 0:
        return None
    for line in (proc.stdout or "").splitlines():
        if not line:
            continue
        parts = line.split(":", 1)
        if len(parts) != 2:
            continue
        dev, conn = parts[0].strip(), parts[1].strip()
        if dev == device and conn and conn != "--":
            return conn
    return None


def _nmcli_ipv4_method(connection: str) -> Optional[str]:
    proc = _run(["nmcli", "-g", "ipv4.method", "connection", "show", connection], timeout=20)
    if proc.returncode != 0:
        return None
    method = (proc.stdout or "").strip().lower()
    if method in ("auto", "dhcp"):
        return "dhcp"
    if method in ("manual", "static", "link-local"):
        return "static"
    return method or None


def _netplan_files() -> List[Path]:
    root = Path("/etc/netplan")
    if not root.is_dir():
        return []
    return sorted(root.glob("*.yaml")) + sorted(root.glob("*.yml"))


def _netplan_method_for_iface(iface: str) -> Optional[str]:
    for path in _netplan_files():
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        block = re.search(
            rf"(?ms)^\s*{re.escape(iface)}:\s*\n(.*?)(?=^\s*\S|\Z)",
            text,
        )
        if not block:
            continue
        chunk = block.group(1)
        if re.search(r"dhcp4:\s*true", chunk, re.I):
            return "dhcp"
        if re.search(r"dhcp4:\s*false", chunk, re.I) or re.search(r"addresses:", chunk):
            return "static"
    return None


def detect_lan_ip() -> Optional[str]:
    """Best-effort private IPv4 on a live, non-virtual interface."""
    addrs = psutil.net_if_addrs()
    stats = psutil.net_if_stats()
    private: List[str] = []
    public: List[str] = []
    for name, rows in addrs.items():
        if _is_virtual_iface(name):
            continue
        st = stats.get(name)
        if st and not st.isup:
            continue
        for row in rows:
            if row.family != socket.AF_INET or not row.address or row.address.startswith("127."):
                continue
            if _ipv4_is_private(row.address):
                private.append(row.address)
            else:
                public.append(row.address)
    return (private[0] if private else public[0]) if (private or public) else None


def get_network_summary() -> Dict[str, Any]:
    primary = _primary_interface()
    return {
        "hostname": platform.node(),
        "lan_ip": detect_lan_ip(),
        "primary_interface": primary,
        "gateway": _read_default_gateway(),
        "dns": _read_dns_servers(),
        "is_linux": not IS_WINDOWS,
    }


def _primary_interface() -> Optional[str]:
    data = _cmd_json(["ip", "-j", "route", "show", "default"])
    if isinstance(data, list):
        for route in data:
            dev = route.get("dev")
            if dev and not _is_virtual_iface(str(dev)):
                return str(dev)
    addrs = psutil.net_if_addrs()
    stats = psutil.net_if_stats()
    for name in sorted(addrs.keys()):
        if _is_virtual_iface(name):
            continue
        st = stats.get(name)
        if st and st.isup and _iface_ipv4_entries(name):
            return name
    return None


def list_network_interfaces() -> Dict[str, Any]:
    addrs = psutil.net_if_addrs()
    stats = psutil.net_if_stats()
    gateway = _read_default_gateway()
    dns = _read_dns_servers()
    nmcli = _nmcli_available()
    interfaces: List[Dict[str, Any]] = []

    for name in sorted(addrs.keys()):
        if _is_virtual_iface(name):
            continue
        st = stats.get(name)
        ipv4_rows = _iface_ipv4_entries(name)
        ipv6 = [
            row.address
            for row in addrs.get(name, [])
            if row.family == socket.AF_INET6 and row.address and not row.address.startswith("fe80")
        ]
        connection = _nmcli_connection_for_device(name) if nmcli else None
        method = None
        if connection:
            method = _nmcli_ipv4_method(connection)
        if not method:
            method = _netplan_method_for_iface(name)
        interfaces.append(
            {
                "name": name,
                "mac": _iface_mac(name),
                "state": "up" if (st and st.isup) else "down",
                "ipv4": [r["address"] for r in ipv4_rows],
                "ipv4_prefix": [r["prefix"] for r in ipv4_rows],
                "ipv4_netmask": [r["netmask"] for r in ipv4_rows],
                "ipv6": ipv6,
                "gateway": gateway,
                "dns": dns,
                "method": method or "unknown",
                "connection": connection,
                "mtu": st.mtu if st else None,
                "speed_mbps": st.speed if st and st.speed > 0 else None,
                "backend": "nmcli" if nmcli and connection else ("netplan" if _netplan_files() else "manual"),
            }
        )

    return {
        "summary": get_network_summary(),
        "interfaces": interfaces,
        "nmcli_available": nmcli,
        "netplan_available": bool(_netplan_files()),
    }


def _validate_ipv4(addr: str, field: str) -> str:
    try:
        return str(ipaddress.ip_address(addr.strip()))
    except ValueError as exc:
        raise ValueError(f"Invalid {field} address.") from exc


def _apply_nmcli_network(
    device: str,
    connection: str,
    *,
    method: str,
    address: Optional[str],
    prefix: Optional[int],
    gateway: Optional[str],
    dns: Optional[List[str]],
) -> Dict[str, Any]:
    if method == "dhcp":
        cmds = [
            ["nmcli", "connection", "modify", connection, "ipv4.method", "auto"],
            ["nmcli", "connection", "modify", connection, "ipv4.addresses", ""],
            ["nmcli", "connection", "modify", connection, "ipv4.gateway", ""],
            ["nmcli", "connection", "modify", connection, "ipv4.dns", ""],
            ["nmcli", "connection", "up", connection],
        ]
    else:
        if not address or prefix is None:
            raise ValueError("Static IP requires address and prefix (CIDR).")
        addr = _validate_ipv4(address, "IPv4")
        cidr = f"{addr}/{prefix}"
        gw = _validate_ipv4(gateway, "gateway") if gateway else ""
        dns_list = ",".join(_validate_ipv4(x, "DNS") for x in (dns or [])) if dns else ""
        cmds = [
            ["nmcli", "connection", "modify", connection, "ipv4.method", "manual"],
            ["nmcli", "connection", "modify", connection, "ipv4.addresses", cidr],
            ["nmcli", "connection", "modify", connection, "ipv4.gateway", gw],
            ["nmcli", "connection", "modify", connection, "ipv4.dns", dns_list],
            ["nmcli", "connection", "up", connection],
        ]

    for cmd in cmds:
        proc = _run_privileged(cmd, timeout=60)
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip()
            raise RuntimeError(f"nmcli failed ({' '.join(cmd)}): {err}")

    return {
        "interface": device,
        "connection": connection,
        "method": method,
        "message": f"Network settings applied on {device} via NetworkManager.",
        "backend": "nmcli",
    }


def _netplan_iface_block(
    iface: str,
    *,
    method: str,
    address: Optional[str],
    prefix: Optional[int],
    gateway: Optional[str],
    dns: Optional[List[str]],
) -> str:
    if method == "dhcp":
        return (
            f"  {iface}:\n"
            f"    dhcp4: true\n"
            f"    dhcp6: false\n"
        )
    if not address or prefix is None:
        raise ValueError("Static IP requires address and prefix (CIDR).")
    addr = _validate_ipv4(address, "IPv4")
    gw = _validate_ipv4(gateway, "gateway") if gateway else None
    dns_rows = [_validate_ipv4(x, "DNS") for x in (dns or [])]
    lines = [
        f"  {iface}:",
        "    dhcp4: false",
        "    dhcp6: false",
        f"    addresses:",
        f"      - {addr}/{prefix}",
    ]
    if gw:
        lines.extend(
            [
                "    routes:",
                "      - to: default",
                f"        via: {gw}",
            ]
        )
    if dns_rows:
        lines.append("    nameservers:")
        lines.append("      addresses:")
        lines.extend(f"        - {d}" for d in dns_rows)
    return "\n".join(lines) + "\n"


def _apply_netplan_network(
    device: str,
    *,
    method: str,
    address: Optional[str],
    prefix: Optional[int],
    gateway: Optional[str],
    dns: Optional[List[str]],
) -> Dict[str, Any]:
    files = _netplan_files()
    if not files:
        raise RuntimeError("No netplan files found under /etc/netplan.")

    target = files[0]
    for path in files:
        try:
            if device in path.read_text(encoding="utf-8"):
                target = path
                break
        except OSError:
            continue

    block = _netplan_iface_block(
        device,
        method=method,
        address=address,
        prefix=prefix,
        gateway=gateway,
        dns=dns,
    )
    content = (
        "network:\n"
        "  version: 2\n"
        "  renderer: networkd\n"
        "  ethernets:\n"
        f"{block}"
    )
    _write_file_privileged(target, content)
    gen = _run_privileged(["netplan", "generate"], timeout=60)
    if gen.returncode != 0:
        raise RuntimeError(f"netplan generate failed: {(gen.stderr or gen.stdout or '').strip()}")
    apply = _run_privileged(["netplan", "apply"], timeout=90)
    if apply.returncode != 0:
        raise RuntimeError(f"netplan apply failed: {(apply.stderr or apply.stdout or '').strip()}")

    return {
        "interface": device,
        "method": method,
        "message": f"Network settings applied on {device} via netplan ({target.name}).",
        "backend": "netplan",
        "file": str(target),
    }


def apply_interface_network(
    interface_name: str,
    *,
    method: str,
    address: Optional[str] = None,
    prefix: Optional[int] = None,
    gateway: Optional[str] = None,
    dns: Optional[List[str]] = None,
    confirm: bool = False,
) -> Dict[str, Any]:
    if IS_WINDOWS:
        raise ValueError("Network configuration is Linux-only.")
    if not confirm:
        raise ValueError("Set confirm=true — wrong IP/gateway may disconnect SSH.")
    iface = interface_name.strip()
    if not iface or _is_virtual_iface(iface):
        raise ValueError("Invalid network interface.")
    if iface not in psutil.net_if_addrs():
        raise ValueError(f"Interface not found: {iface}")
    if method not in ("dhcp", "static"):
        raise ValueError("method must be dhcp or static.")

    if _nmcli_available():
        conn = _nmcli_connection_for_device(iface)
        if conn:
            return _apply_nmcli_network(
                iface,
                conn,
                method=method,
                address=address,
                prefix=prefix,
                gateway=gateway,
                dns=dns,
            )

    if _netplan_files():
        return _apply_netplan_network(
            iface,
            method=method,
            address=address,
            prefix=prefix,
            gateway=gateway,
            dns=dns,
        )

    raise RuntimeError(
        "No supported network backend (NetworkManager/nmcli or netplan). Configure the interface manually on the host."
    )


def _nginx_site_path() -> Path:
    if NGINX_SITE.is_file():
        return NGINX_SITE
    alt = Path("/etc/nginx/conf.d/copanel.conf")
    if alt.is_file():
        return alt
    return NGINX_SITE


def _nginx_site_content() -> str:
    path = _nginx_site_path()
    if not path.is_file():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _nginx_has_gate() -> bool:
    return NGINX_AUTH_START in _nginx_site_content()


def _nginx_gate_at_server_level(content: Optional[str] = None) -> bool:
    """Gate markers before first location = auth applies to /api/ (broken layout)."""
    text = content if content is not None else _nginx_site_content()
    if NGINX_AUTH_START not in text:
        return False
    gate_idx = text.find(NGINX_AUTH_START)
    loc_idx = text.find("location ")
    return loc_idx == -1 or gate_idx < loc_idx


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
            "needs_repair": _nginx_gate_at_server_level(),
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


def _strip_all_nginx_gate_blocks(content: str) -> str:
    while NGINX_AUTH_START in content:
        content = re.sub(
            rf"\s*{re.escape(NGINX_AUTH_START)}.*?{re.escape(NGINX_AUTH_END)}\n?",
            "\n",
            content,
            count=1,
            flags=re.DOTALL,
        )
    return content


def _strip_auth_exempt_markers(content: str) -> str:
    return re.sub(
        rf"\n\s*auth_basic off;\s*{re.escape(NGINX_EXEMPT_TAG)}\n?",
        "\n",
        content,
    )


def _strip_server_context_auth_basic(content: str) -> str:
    """Remove legacy server-level auth_basic (outside location blocks)."""
    lines = content.splitlines(keepends=True)
    out: List[str] = []
    depth = 0
    for line in lines:
        stripped = line.strip()
        indent = len(line) - len(line.lstrip(" "))
        is_server_auth = (
            depth == 1
            and indent == 4
            and (
                stripped.startswith('auth_basic "CoPanel"')
                or stripped.startswith("auth_basic_user_file")
                or stripped == NGINX_AUTH_START
                or stripped == NGINX_AUTH_END
            )
        )
        if not is_server_auth:
            out.append(line)
        depth += line.count("{") - line.count("}")
    return "".join(out)


def _inject_auth_exemptions(content: str) -> str:
    snippet = f"        auth_basic off;  {NGINX_EXEMPT_TAG}\n"
    for marker in NGINX_EXEMPT_LOCATION_MARKERS:
        idx = content.find(marker)
        if idx == -1:
            continue
        brace = content.find("{", idx)
        nl = content.find("\n", brace)
        if nl == -1:
            continue
        window = content[idx : idx + 900]
        if NGINX_EXEMPT_TAG in window:
            continue
        content = content[: nl + 1] + snippet + content[nl + 1 :]
    return content


def _remove_nginx_gate_block(content: str) -> str:
    content = _strip_all_nginx_gate_blocks(content)
    content = _strip_auth_exempt_markers(content)
    return _strip_server_context_auth_basic(content)


def _apply_nginx_gate(content: str, htpasswd_path: str) -> str:
    content = _remove_nginx_gate_block(content)
    content = _inject_nginx_gate_block(content, htpasswd_path)
    return _inject_auth_exemptions(content)


def _inject_nginx_gate_block(content: str, htpasswd_path: str) -> str:
    """HTTP basic auth only for SPA shell (location /). API/static exempt."""
    inner = (
        f"        {NGINX_AUTH_START}\n"
        f'        auth_basic "CoPanel";\n'
        f"        auth_basic_user_file {htpasswd_path};\n"
        f"        {NGINX_AUTH_END}\n"
    )

    for marker in ("    location / {", "location / {"):
        idx = content.find(marker)
        if idx == -1:
            continue
        brace = content.find("{", idx)
        nl = content.find("\n", brace)
        if nl != -1:
            return content[: nl + 1] + "\n" + inner + content[nl + 1 :]

    raise RuntimeError("Could not find 'location /' block in nginx site config.")


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
            if HTPASSWD_PATH.is_file() and (gate.get("enabled") or _nginx_has_gate()):
                ht_path = str(HTPASSWD_PATH)
            else:
                raise ValueError("Gate password required when enabling.")
        else:
            ht_path = _write_nginx_htpasswd(user, password)

        content = site.read_text(encoding="utf-8")
        content = _apply_nginx_gate(content, ht_path)
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


def repair_nginx_gate() -> Dict[str, Any]:
    """Re-apply gate layout: move auth into location / and exempt /api/."""
    store = _load_store()
    gate = store.get("nginx_gate") or {}
    if not _nginx_has_gate() and not HTPASSWD_PATH.is_file():
        raise ValueError("Nginx gate is not configured.")
    user = (gate.get("username") or "copanel").strip()
    return configure_nginx_gate(True, user, None)


def maybe_auto_repair_nginx_gate() -> Optional[Dict[str, Any]]:
    """Startup hook: fix legacy server-level gate after git pull + service restart."""
    if IS_WINDOWS:
        return None
    if not _nginx_gate_at_server_level():
        return None
    if not HTPASSWD_PATH.is_file() and not _nginx_has_gate():
        return None
    try:
        result = repair_nginx_gate()
        logger.info(
            "Nginx gate auto-repaired (auth moved into location /; /api/ exempt). reload_ok=%s",
            result.get("reload_ok"),
        )
        return result
    except Exception as exc:
        logger.warning("Nginx gate auto-repair failed (edit nginx manually or use Settings): %s", exc)
        return None


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
