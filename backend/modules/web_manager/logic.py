"""
Web Manager helpers: Nginx/Apache paths, PHP-FPM sockets, systemd probes.
"""
from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

IS_WINDOWS = os.name == "nt"


def sanitize_filename(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]", "", value)


def parse_nginx_config(content: str) -> Dict[str, str]:
    server_names = re.findall(r"server_name\s+([^;]+);", content)
    roots = re.findall(r"root\s+([^;]+);", content)
    server_name = server_names[0].strip() if server_names else "unknown"
    root_path = roots[0].strip() if roots else "unknown"
    return {"domain": server_name, "root": root_path}


def parse_apache_vhost(content: str) -> Dict[str, str]:
    sn = re.findall(r"^\s*ServerName\s+(\S+)", content, re.MULTILINE)
    dr = re.findall(r"^\s*DocumentRoot\s+(\S+)", content, re.MULTILINE)
    return {
        "domain": sn[0].strip() if sn else "unknown",
        "root": dr[0].strip() if dr else "unknown",
    }


@dataclass
class NginxPaths:
    sites_available: str
    sites_enabled: str


@dataclass
class ApacheLayout:
    style: str  # debian | rhel
    sites_available: Optional[str]
    sites_enabled: Optional[str]
    conf_d: Optional[str]
    service_name: str  # apache2 | httpd


def get_nginx_paths() -> NginxPaths:
    if IS_WINDOWS:
        base = os.path.abspath("./test_nginx")
        return NginxPaths(
            sites_available=os.path.join(base, "sites-available"),
            sites_enabled=os.path.join(base, "sites-enabled"),
        )
    return NginxPaths(
        sites_available="/etc/nginx/sites-available",
        sites_enabled="/etc/nginx/sites-enabled",
    )


def ensure_nginx_dirs() -> NginxPaths:
    p = get_nginx_paths()
    os.makedirs(p.sites_available, exist_ok=True)
    os.makedirs(p.sites_enabled, exist_ok=True)
    return p


def detect_apache_layout() -> Optional[ApacheLayout]:
    if IS_WINDOWS:
        base = os.path.abspath("./test_apache")
        sa = os.path.join(base, "sites-available")
        se = os.path.join(base, "sites-enabled")
        os.makedirs(sa, exist_ok=True)
        os.makedirs(se, exist_ok=True)
        return ApacheLayout(
            style="debian",
            sites_available=sa,
            sites_enabled=se,
            conf_d=None,
            service_name="apache2",
        )
    if os.path.isdir("/etc/apache2/sites-available"):
        return ApacheLayout(
            style="debian",
            sites_available="/etc/apache2/sites-available",
            sites_enabled="/etc/apache2/sites-enabled",
            conf_d=None,
            service_name="apache2",
        )
    if os.path.isdir("/etc/httpd/conf.d"):
        return ApacheLayout(
            style="rhel",
            sites_available=None,
            sites_enabled=None,
            conf_d="/etc/httpd/conf.d",
            service_name="httpd",
        )
    return None


def _run_cmd(cmd: List[str], timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def run_with_optional_sudo(cmd: List[str], timeout: int = 120) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=True)
    except Exception:
        pass
    if IS_WINDOWS:
        raise subprocess.CalledProcessError(returncode=1, cmd=cmd, stderr="Command failed on Windows mode.")
    return subprocess.run(["sudo", "-n"] + cmd, capture_output=True, text=True, timeout=timeout, check=True)


def systemctl_is_active(unit: str) -> Optional[str]:
    if IS_WINDOWS:
        return None
    try:
        res = _run_cmd(["systemctl", "is-active", unit], timeout=15)
        out = (res.stdout or "").strip()
        if out == "active":
            return "running"
        if res.returncode == 0 and out:
            return out
        return "stopped"
    except Exception:
        return None


def detect_php_fpm_socket(version: str) -> Optional[str]:
    """Return first existing PHP-FPM socket for version, or None."""
    ver = version.strip()
    candidates = [
        f"/run/php/php{ver}-fpm.sock",
        f"/var/run/php/php{ver}-fpm.sock",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    try:
        for path in glob.glob("/run/php/php*-fpm.sock"):
            if ver in path:
                return path
    except Exception:
        pass
    return None


def list_php_fpm_versions() -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if IS_WINDOWS:
        return [
            {
                "version": "8.2",
                "installed": True,
                "status": "running",
                "socket": None,
                "unit": "php8.2-fpm",
            }
        ]
    for path in sorted(glob.glob("/run/php/php*-fpm.sock")):
        m = re.search(r"php([\d.]+)-fpm\.sock$", path)
        ver = m.group(1) if m else "unknown"
        unit = f"php{ver}-fpm"
        st = systemctl_is_active(unit) or ("running" if os.path.exists(path) else "unknown")
        rows.append(
            {
                "version": ver,
                "installed": True,
                "status": st,
                "socket": path,
                "unit": unit,
            }
        )
    if not rows:
        for ver in ("8.3", "8.2", "8.1", "8.0", "7.4"):
            unit = f"php{ver}-fpm"
            if shutil.which(f"php-fpm{ver}") or _run_cmd(["systemctl", "cat", unit], timeout=5).returncode == 0:
                sock = detect_php_fpm_socket(ver)
                st = systemctl_is_active(unit) or "stopped"
                rows.append(
                    {
                        "version": ver,
                        "installed": True,
                        "status": st,
                        "socket": sock,
                        "unit": unit,
                    }
                )
    return rows


def database_service_rows() -> List[Dict[str, Any]]:
    specs = [
        ("mariadb", "MariaDB", ["mariadb", "mysql"]),
        ("mysql", "MySQL", ["mysql"]),
        ("postgresql", "PostgreSQL", ["postgresql"]),
    ]
    out: List[Dict[str, Any]] = []
    for sid, label, units in specs:
        if IS_WINDOWS:
            out.append(
                {
                    "id": sid,
                    "name": label,
                    "installed": False,
                    "status": "not_installed",
                    "unit": units[0],
                }
            )
            continue
        installed = False
        active_unit = units[0]
        for u in units:
            try:
                r = _run_cmd(["systemctl", "cat", u], timeout=8)
                if r.returncode == 0:
                    installed = True
                    active_unit = u
                    break
            except Exception:
                pass
        if not installed:
            if sid in ("mariadb", "mysql"):
                installed = bool(shutil.which("mysql") or shutil.which("mariadb") or os.path.exists("/var/lib/mysql"))
            elif sid == "postgresql":
                installed = bool(shutil.which("psql") or os.path.exists("/var/lib/postgresql"))
        status = "not_installed"
        if installed:
            st = systemctl_is_active(active_unit)
            status = st if st else "stopped"
        out.append(
            {
                "id": sid,
                "name": label,
                "installed": installed,
                "status": status,
                "unit": active_unit,
            }
        )
    return out


def apache_enabled_path(layout: ApacheLayout, filename: str) -> str:
    if layout.style == "debian" and layout.sites_enabled:
        return os.path.join(layout.sites_enabled, filename)
    if layout.style == "rhel" and layout.conf_d:
        return os.path.join(layout.conf_d, filename)
    return filename


def is_apache_vhost_enabled(layout: ApacheLayout, filename: str) -> bool:
    if layout.style == "debian" and layout.sites_enabled:
        return os.path.exists(os.path.join(layout.sites_enabled, filename))
    if layout.style == "rhel" and layout.conf_d:
        base = os.path.join(layout.conf_d, filename)
        return os.path.isfile(base) and not base.endswith(".conf.off")
    return False


def list_apache_site_files(layout: ApacheLayout) -> List[str]:
    files: List[str] = []
    if layout.style == "debian" and layout.sites_available:
        if os.path.isdir(layout.sites_available):
            for fn in os.listdir(layout.sites_available):
                path = os.path.join(layout.sites_available, fn)
                if os.path.isfile(path) and (fn.endswith(".conf") or "." not in fn):
                    files.append(fn)
    elif layout.style == "rhel" and layout.conf_d:
        for path in glob.glob(os.path.join(layout.conf_d, "*.conf")):
            if os.path.isfile(path):
                files.append(os.path.basename(path))
    return sorted(set(files))


def read_apache_site(layout: ApacheLayout, filename: str) -> Tuple[str, str]:
    if layout.style == "debian" and layout.sites_available:
        path = os.path.join(layout.sites_available, filename)
    elif layout.style == "rhel" and layout.conf_d:
        path = os.path.join(layout.conf_d, filename)
    else:
        raise FileNotFoundError(filename)
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return path, f.read()


def nginx_reload_test() -> None:
    subprocess.run(["nginx", "-t"], check=True, capture_output=True, text=True)
    subprocess.run(["systemctl", "reload", "nginx"], check=True, capture_output=True, text=True)


def apache_reload_test(layout: ApacheLayout) -> None:
    if shutil.which("apache2ctl"):
        subprocess.run(["apache2ctl", "configtest"], check=True, capture_output=True, text=True)
        subprocess.run(["systemctl", "reload", layout.service_name], check=True, capture_output=True, text=True)
    elif shutil.which("httpd"):
        subprocess.run(["httpd", "-t"], check=True, capture_output=True, text=True)
        subprocess.run(["systemctl", "reload", layout.service_name], check=True, capture_output=True, text=True)
    else:
        subprocess.run(["systemctl", "reload", layout.service_name], check=True, capture_output=True, text=True)


def pkg_manager() -> Optional[str]:
    if shutil.which("apt-get"):
        return "apt-get"
    if shutil.which("yum"):
        return "yum"
    return None
