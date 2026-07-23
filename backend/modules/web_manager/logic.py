"""
Web Manager helpers: Nginx/Apache paths, PHP-FPM sockets, systemd probes.
"""
from __future__ import annotations

import glob
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from passlib.hash import apr_md5_crypt

IS_WINDOWS = os.name == "nt"
SITE_AUTH_START = "# BEGIN COPANEL SITE AUTH"
SITE_AUTH_END = "# END COPANEL SITE AUTH"
SITE_AUTH_BLOCK_RE = re.compile(
    rf"\s*{re.escape(SITE_AUTH_START)}.*?{re.escape(SITE_AUTH_END)}\n?",
    re.DOTALL,
)


def sanitize_filename(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]", "", value)


def get_site_auth_dir() -> Path:
    if IS_WINDOWS:
        return Path(os.path.abspath("./test_copanel/config/web_auth"))
    return Path("/opt/copanel/config/web_auth")


def ensure_site_auth_dir() -> Path:
    base = get_site_auth_dir()
    base.mkdir(parents=True, exist_ok=True)
    return base


def site_htpasswd_path(filename: str) -> Path:
    return ensure_site_auth_dir() / f"{sanitize_filename(filename)}.htpasswd"


def site_auth_meta_path(filename: str) -> Path:
    return ensure_site_auth_dir() / f"{sanitize_filename(filename)}.json"


def parse_nginx_config(content: str) -> Dict[str, str]:
    server_names = re.findall(r"server_name\s+([^;]+);", content)
    roots = re.findall(r"root\s+([^;]+);", content)
    server_name = server_names[0].strip() if server_names else "unknown"
    root_path = roots[0].strip() if roots else "unknown"
    return {"domain": server_name, "root": root_path}


def is_nginx_proxy_config(content: str) -> bool:
    return bool(re.search(r"^\s*proxy_pass\s+https?://", content, re.MULTILINE))


def detect_site_auth(content: str) -> Dict[str, Optional[str]]:
    enabled = SITE_AUTH_START in content and SITE_AUTH_END in content
    htpasswd_match = re.search(r"^\s*auth_basic_user_file\s+([^;]+);", content, re.MULTILINE)
    return {
        "enabled": enabled,
        "htpasswd_path": htpasswd_match.group(1).strip() if htpasswd_match else None,
    }


def strip_site_auth(content: str) -> str:
    return SITE_AUTH_BLOCK_RE.sub("", content)


def inject_site_auth(content: str, htpasswd_path: str, realm: str = "Restricted") -> str:
    clean_content = strip_site_auth(content)
    inner = (
        f"        {SITE_AUTH_START}\n"
        f'        auth_basic "{realm}";\n'
        f"        auth_basic_user_file {htpasswd_path};\n"
        f"        {SITE_AUTH_END}\n"
    )

    for marker in ("    location / {", "location / {"):
        idx = clean_content.find(marker)
        if idx == -1:
            continue
        brace = clean_content.find("{", idx)
        nl = clean_content.find("\n", brace)
        if nl != -1:
            return clean_content[: nl + 1] + "\n" + inner + clean_content[nl + 1 :]

    raise RuntimeError("Could not find 'location /' block in nginx site config.")


def write_site_htpasswd(filename: str, username: str, password: str) -> str:
    path = site_htpasswd_path(filename)
    path.write_text(f"{username}:{apr_md5_crypt.hash(password)}\n", encoding="utf-8")
    return str(path).replace("\\", "/")


def save_site_auth_meta(filename: str, username: str, enabled: bool = True) -> None:
    path = site_auth_meta_path(filename)
    data = {"enabled": enabled, "username": username}
    path.write_text(json.dumps(data, ensure_ascii=True), encoding="utf-8")


def read_site_auth_meta(filename: str) -> Dict[str, Any]:
    path = site_auth_meta_path(filename)
    if not path.is_file():
        return {"enabled": False, "username": None}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"enabled": False, "username": None}
    return {
        "enabled": bool(data.get("enabled")),
        "username": data.get("username"),
    }


def delete_site_auth_files(filename: str) -> None:
    for path in (site_htpasswd_path(filename), site_auth_meta_path(filename)):
        try:
            if path.exists():
                path.unlink()
        except OSError:
            pass


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
    ver = (version or "").strip()
    candidates = [
        f"/run/php/php{ver}-fpm.sock",
        f"/var/run/php/php{ver}-fpm.sock",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    try:
        for path in glob.glob("/run/php/php*-fpm.sock"):
            if ver and ver in path:
                return path
    except Exception:
        pass
    return None


def _start_php_fpm(version: str) -> None:
    ver = (version or "").strip()
    if not ver or IS_WINDOWS:
        return
    for unit in (f"php{ver}-fpm", f"php-fpm{ver}", "php-fpm"):
        try:
            subprocess.run(
                ["sudo", "systemctl", "start", unit],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            subprocess.run(
                ["sudo", "systemctl", "enable", unit],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
        except Exception:
            continue


def ensure_php_fpm_socket(version: Optional[str] = None) -> str:
    """Return a live PHP-FPM unix socket, starting FPM if needed.

    Raises RuntimeError when no socket can be found (would cause nginx 502).
    """
    preferred = (version or "").strip() or "8.2"
    sock = detect_php_fpm_socket(preferred)
    if sock:
        return sock

    _start_php_fpm(preferred)
    sock = detect_php_fpm_socket(preferred)
    if sock:
        return sock

    # Any other running FPM socket is better than a dead path that causes 502.
    for path in sorted(glob.glob("/run/php/php*-fpm.sock")) + sorted(
        glob.glob("/var/run/php/php*-fpm.sock")
    ):
        if os.path.exists(path):
            return path

    # Last attempt: start common versions then rescan.
    for ver in ("8.3", "8.2", "8.1", "8.0"):
        if ver == preferred:
            continue
        _start_php_fpm(ver)
        sock = detect_php_fpm_socket(ver)
        if sock:
            return sock

    raise RuntimeError(
        f"PHP-FPM socket not found for PHP {preferred}. "
        "Install/start php-fpm (e.g. systemctl start php8.2-fpm) to avoid nginx 502."
    )


def repair_nginx_php_socket(domain: str, php_version: Optional[str] = None) -> Dict[str, Any]:
    """Ensure the nginx vhost for domain points at a live PHP-FPM socket."""
    from modules.ssl_manager.logic import SSLManager

    try:
        sock = ensure_php_fpm_socket(php_version)
    except RuntimeError as exc:
        return {"status": "error", "message": str(exc), "updated": False}

    vhost = SSLManager.find_nginx_vhost_path(domain)
    if not vhost or not vhost.is_file():
        return {"status": "error", "message": f"nginx vhost for {domain} not found", "socket": sock, "updated": False}

    content = vhost.read_text(encoding="utf-8", errors="ignore")
    if "fastcgi_pass" not in content:
        return {"status": "success", "message": "vhost has no PHP fastcgi_pass", "socket": sock, "updated": False}

    new_content, n = re.subn(
        r"fastcgi_pass\s+unix:[^;]+;",
        f"fastcgi_pass unix:{sock};",
        content,
        count=1,
    )
    if n == 0:
        return {"status": "success", "message": "no unix fastcgi_pass to update", "socket": sock, "updated": False}

    if new_content == content:
        return {"status": "success", "message": "PHP-FPM socket already correct", "socket": sock, "updated": False}

    vhost.write_text(new_content, encoding="utf-8")
    if not IS_WINDOWS and shutil.which("nginx"):
        test = subprocess.run(["sudo", "nginx", "-t"], capture_output=True, text=True)
        if test.returncode == 0:
            subprocess.run(["sudo", "systemctl", "reload", "nginx"], capture_output=True, text=True)
        else:
            vhost.write_text(content, encoding="utf-8")
            return {
                "status": "error",
                "message": f"nginx -t failed after socket update: {test.stderr or test.stdout}",
                "socket": sock,
                "updated": False,
            }
    return {"status": "success", "message": f"Updated fastcgi_pass to {sock}", "socket": sock, "updated": True}


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


# --- PHP version / extension / php.ini management (merged from php_manager) ---

PHP_SUPPORTED_VERSIONS = ["8.4", "8.3", "8.2", "8.1", "8.0", "7.4"]
PHP_DEFAULT_MODULES = ["mysqli", "curl", "mbstring", "gd", "zip", "xml", "redis", "intl", "soap", "bcmath"]


def _php_run(cmd: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=False, capture_output=True, text=True)


def _php_resolve_bin(name: str) -> Optional[str]:
    """Resolve system binary when service PATH is minimal (systemd)."""
    found = shutil.which(name)
    if found:
        return found
    for path in (f"/usr/bin/{name}", f"/usr/sbin/{name}", f"/bin/{name}", f"/sbin/{name}"):
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def _php_dpkg_query(args: List[str]) -> subprocess.CompletedProcess:
    dpkg = _php_resolve_bin("dpkg-query")
    if not dpkg:
        return subprocess.CompletedProcess(args=["dpkg-query", *args], returncode=127, stdout="", stderr="")
    return _php_run([dpkg, *args])


def _php_package_matches_apt_stream(pkg: str, version: str) -> bool:
    base = f"php{version}"
    if pkg == base or pkg.startswith(f"{base}-"):
        return True
    if pkg == f"libapache2-mod-php{version}":
        return True
    return False


def _php_debian_dpkg_stream_has_installed_pkg(version: str) -> bool:
    res = _php_dpkg_query(["-W", "-f=${Status}\t${Package}\n"])
    if res.returncode != 0 or not res.stdout.strip():
        return False
    for line in res.stdout.splitlines():
        if "\t" not in line:
            continue
        status, pkg = line.strip().split("\t", 1)
        if status.strip() != "install ok installed":
            continue
        if _php_package_matches_apt_stream(pkg.strip(), version):
            return True
    return False


def _php_debian_list_php_stream_packages(version: str) -> List[str]:
    res = _php_dpkg_query(["-W", "-f=${Status}\t${Package}\n"])
    if res.returncode != 0 or not res.stdout.strip():
        return []
    ok_status = frozenset({"install ok installed", "deinstall ok config-files"})
    out: List[str] = []
    for line in res.stdout.splitlines():
        if "\t" not in line:
            continue
        status, pkg = line.strip().split("\t", 1)
        if status.strip() not in ok_status:
            continue
        if _php_package_matches_apt_stream(pkg.strip(), version):
            out.append(pkg.strip())
    return sorted(set(out))


def get_active_php_version() -> str:
    if IS_WINDOWS:
        return PHP_SUPPORTED_VERSIONS[0]
    installed = set(get_php_versions())
    try:
        php_bin = _php_resolve_bin("php")
        if php_bin:
            res = _php_run([php_bin, "-v"])
            if res.returncode == 0 and res.stdout:
                m = re.search(r"PHP\s+(\d+\.\d+)", res.stdout)
                if m:
                    ver = m.group(1)
                    if ver in installed:
                        return ver
    except Exception:
        pass
    return sorted(installed, key=lambda x: tuple(map(int, x.split("."))), reverse=True)[0] if installed else ""


def _is_php_version_installed(version: str) -> bool:
    if IS_WINDOWS:
        return False
    ver = version.strip()
    if not ver:
        return False

    # FPM socket probe (same signal as Web Services stack tab; no PATH needed)
    if detect_php_fpm_socket(ver):
        return True

    # systemd unit present
    unit = f"php{ver}-fpm"
    if _run_cmd(["systemctl", "cat", unit], timeout=5).returncode == 0:
        return True

    # Debian/Ubuntu dpkg stream packages
    if _php_resolve_bin("dpkg-query") and _php_debian_dpkg_stream_has_installed_pkg(ver):
        return True

    php_bin = _php_resolve_bin(f"php{ver}")
    if php_bin:
        res = _php_run([php_bin, "-v"])
        if res.returncode == 0 and res.stdout and ver in res.stdout.splitlines()[0]:
            return True

    if _php_resolve_bin(f"php-fpm{ver}"):
        return True

    return False


def get_php_versions() -> List[str]:
    if IS_WINDOWS:
        return list(PHP_SUPPORTED_VERSIONS)
    installed: set[str] = set()
    for v in PHP_SUPPORTED_VERSIONS:
        if _is_php_version_installed(v):
            installed.add(v)
    # Align with stack overview: include versions discovered via FPM sockets/units
    for row in list_php_fpm_versions():
        ver = str(row.get("version") or "").strip()
        if ver in PHP_SUPPORTED_VERSIONS:
            installed.add(ver)
    return sorted(installed, key=lambda x: tuple(map(int, x.split("."))), reverse=True)


def get_php_versions_meta() -> Dict[str, Any]:
    installed = get_php_versions()
    active = get_active_php_version()
    if active and active not in installed:
        active = installed[0] if installed else ""
    return {
        "versions": installed,
        "active": active,
        "supported": list(PHP_SUPPORTED_VERSIONS),
    }


def get_php_modules() -> List[str]:
    return list(PHP_DEFAULT_MODULES)


def _normalize_mods_enabled_stem(stem: str) -> str:
    name = stem.replace(".ini", "")
    return re.sub(r"^\d+-", "", name).strip().lower()


def get_enabled_modules(version: str) -> List[str]:
    if IS_WINDOWS:
        return list(PHP_DEFAULT_MODULES)

    def _parse_php_m(stdout: str) -> set[str]:
        out: set[str] = set()
        for ln in stdout.splitlines():
            s = ln.strip()
            if not s or s.startswith("["):
                continue
            low = s.lower()
            if low == "zend opcache":
                out.add("opcache")
                continue
            if s[0].isalpha() and " " not in s:
                out.add(low)
        return out

    php_bin = _php_resolve_bin(f"php{version}")
    if php_bin:
        res = _php_run([php_bin, "-m"])
        if res.returncode == 0 and res.stdout.strip():
            return sorted(_parse_php_m(res.stdout))

    modules_set: set[str] = set()
    enabled_dir = Path(f"/etc/php/{version}/mods-enabled")
    if enabled_dir.is_dir():
        for ini in enabled_dir.glob("*.ini"):
            modules_set.add(_normalize_mods_enabled_stem(ini.stem))
    if modules_set:
        return sorted(modules_set)

    fallback = _php_resolve_bin("php")
    if fallback:
        res = _php_run([fallback, "-v"])
        if res.returncode == 0 and res.stdout and version in res.stdout.splitlines()[0]:
            resm = _php_run([fallback, "-m"])
            if resm.returncode == 0:
                return sorted(_parse_php_m(resm.stdout))

    return []


def install_php_version(version: str) -> Dict[str, Any]:
    if version not in PHP_SUPPORTED_VERSIONS:
        return {"status": "error", "message": "Unsupported PHP version selected."}
    if IS_WINDOWS:
        return {"status": "success", "message": f"PHP {version} installed successfully (Mock mode)."}
    try:
        pm = pkg_manager()
        if pm == "apt-get":
            cmd = [
                "sudo", "apt-get", "install", "-y",
                f"php{version}", f"php{version}-fpm", f"php{version}-mysql", f"php{version}-curl",
                f"php{version}-mbstring", f"php{version}-xml", f"php{version}-zip",
            ]
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            return {"status": "success", "message": f"PHP {version} installed successfully."}
        if pm == "yum":
            cmd = ["sudo", "yum", "install", "-y", f"php{version}-fpm", f"php{version}-mysql"]
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            return {"status": "success", "message": f"PHP {version} installed successfully via yum."}
        return {"status": "error", "message": "No recognized package manager found to install PHP."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def uninstall_php_version(version: str) -> Dict[str, Any]:
    if version not in PHP_SUPPORTED_VERSIONS:
        return {"status": "error", "message": "Unsupported PHP version selected."}
    if IS_WINDOWS:
        return {"status": "success", "message": f"PHP {version} removed successfully (Mock mode)."}
    try:
        pm = pkg_manager()
        if pm == "apt-get":
            tracked = _php_debian_list_php_stream_packages(version)
            meta = [
                f"php{version}",
                f"php{version}-common",
                f"php{version}-cli",
                f"php{version}-fpm",
                f"libapache2-mod-php{version}",
            ]
            to_purge = sorted(set(tracked + meta))
            has_apt = bool(tracked) or _php_debian_dpkg_stream_has_installed_pkg(version)
            if not has_apt and not _is_php_version_installed(version):
                return {"status": "success", "message": f"PHP {version} is not installed (nothing to remove)."}
            r = subprocess.run(
                ["sudo", "apt-get", "purge", "-y", *to_purge],
                check=False,
                capture_output=True,
                text=True,
            )
            out = (r.stdout or "") + (r.stderr or "")
            if r.returncode != 0 and "E: Unable to locate package" not in out:
                tail = out[-800:]
                return {"status": "error", "message": f"apt-get purge failed (exit {r.returncode}): {tail}"}
            ver_re = re.escape(version)
            shell = (
                f"PKGS=$(dpkg-query -W -f '${{Package}}\\n' 2>/dev/null | grep -E '^php{ver_re}(-|$)|^libapache2-mod-php{ver_re}$' || true); "
                f"if [ -n \"$PKGS\" ]; then sudo apt-get purge -y $PKGS; fi"
            )
            subprocess.run(["/bin/bash", "-lc", shell], check=False, capture_output=True, text=True)
            subprocess.run(["sudo", "apt-get", "autoremove", "-y"], check=False, capture_output=True, text=True)
            if _php_debian_dpkg_stream_has_installed_pkg(version):
                tail = out[-400:]
                return {"status": "error", "message": f"PHP {version} packages still show as installed in dpkg. {tail}"}
            if _is_php_version_installed(version):
                return {
                    "status": "error",
                    "message": f"PHP {version} binary still on PATH after purge (custom install or another package). Remove manually.",
                }
            return {"status": "success", "message": f"PHP {version} purged (APT packages and config removed)."}
        if pm == "yum":
            subprocess.run(
                ["sudo", "yum", "remove", "-y", f"php{version}*", f"php-fpm{version}"],
                check=False,
                capture_output=True,
                text=True,
            )
            return {"status": "success", "message": f"PHP {version} removed."}
        return {"status": "error", "message": "No recognized package manager found."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def set_active_php_version(version: str) -> Dict[str, Any]:
    if version not in PHP_SUPPORTED_VERSIONS:
        return {"status": "error", "message": "Unsupported PHP version selected."}
    if IS_WINDOWS:
        return {"status": "success", "message": f"PHP {version} set active (Mock mode)."}
    try:
        php_bin = _php_resolve_bin(f"php{version}")
        if php_bin and _php_resolve_bin("update-alternatives"):
            _php_run(["sudo", "update-alternatives", "--set", "php", php_bin])
        if shutil.which("systemctl"):
            _php_run(["sudo", "systemctl", "restart", f"php{version}-fpm"])
        return {"status": "success", "message": f"PHP {version} set as active."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def toggle_php_module(version: str, module: str, enable: bool) -> Dict[str, Any]:
    if not module:
        return {"status": "error", "message": "Module is required."}
    if IS_WINDOWS:
        return {"status": "success", "message": f"Module {module} {'enabled' if enable else 'disabled'} (Mock mode)."}
    try:
        if shutil.which("phpenmod") and shutil.which("phpdismod"):
            before = set(get_enabled_modules(version))
            cmd = ["sudo", "phpenmod" if enable else "phpdismod", "-v", version, module]
            res = _php_run(cmd)
            err = (res.stderr or "") + (res.stdout or "")
            if res.returncode != 0:
                low = err.lower()
                if "not found" in low or "doesn't exist" in low or "cannot find" in low:
                    return {"status": "error", "message": f"Module '{module}' not found for PHP {version}."}
                return {"status": "error", "message": err.strip() or f"phpenmod/phpdismod exited {res.returncode}"}
            _php_run(["sudo", "systemctl", "restart", f"php{version}-fpm"])
            after = set(get_enabled_modules(version))
            mod_l = module.lower()
            if enable and mod_l not in after:
                return {
                    "status": "error",
                    "message": f"Module '{module}' did not appear loaded after enable (may need php{version}-{module} package via apt).",
                }
            if not enable and mod_l in after and mod_l in before:
                return {
                    "status": "warning",
                    "message": f"'{module}' is still loaded (often built into PHP or required by other extensions). Toggle may not apply.",
                }
            return {"status": "success", "message": f"Module {module} {'enabled' if enable else 'disabled'}."}
        return {"status": "error", "message": "phpenmod/phpdismod not found on this system."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def get_php_ini(version: str) -> str:
    ini_path = Path(f"/etc/php/{version}/fpm/php.ini") if not IS_WINDOWS else Path(f"./test_nginx/php_{version}_fpm_php.ini")
    if ini_path.exists():
        return ini_path.read_text(encoding="utf-8", errors="ignore")
    sample = f"""; Sample php.ini for PHP {version}
memory_limit = 256M
upload_max_filesize = 500M
post_max_size = 500M
max_execution_time = 300
date.timezone = UTC
display_errors = Off
"""
    if IS_WINDOWS:
        ini_path.parent.mkdir(parents=True, exist_ok=True)
        ini_path.write_text(sample, encoding="utf-8")
        return sample
    return sample


def save_php_ini(version: str, content: str) -> Dict[str, Any]:
    ini_path = Path(f"/etc/php/{version}/fpm/php.ini") if not IS_WINDOWS else Path(f"./test_nginx/php_{version}_fpm_php.ini")
    try:
        ini_path.parent.mkdir(parents=True, exist_ok=True)
        ini_path.write_text(content, encoding="utf-8")
        if not IS_WINDOWS:
            subprocess.run(["sudo", "systemctl", "restart", f"php{version}-fpm"], check=True, capture_output=True, text=True)
        return {"status": "success", "message": f"php.ini for PHP {version} successfully updated and restarted."}
    except Exception as e:
        return {"status": "error", "message": str(e)}
