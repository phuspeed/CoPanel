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

from core import sysexec

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
    style: str = "debian"  # debian (sites-available + symlink) | rhel (conf.d)


_RHEL_SKIP_CONFS = frozenset({"php-fpm.conf", "ssl.conf", "default.conf"})


def detect_nginx_style(nginx_root: str) -> str:
    """Debian layout when nginx.conf includes sites-enabled, otherwise conf.d."""
    root = Path(nginx_root)
    conf = root / "nginx.conf"
    text = ""
    if conf.is_file():
        try:
            text = conf.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            text = ""
    if re.search(r"include\s+[^\n]*sites-enabled", text):
        return "debian"
    if (root / "conf.d").is_dir() and "sites-enabled" not in text:
        return "rhel"
    if (root / "sites-available").is_dir() and (root / "sites-enabled").is_dir():
        return "debian"
    if (root / "conf.d").is_dir():
        return "rhel"
    return "debian"


def nginx_paths_for_root(nginx_root: str) -> NginxPaths:
    style = detect_nginx_style(nginx_root)
    if style == "rhel":
        conf_d = os.path.join(nginx_root, "conf.d")
        return NginxPaths(sites_available=conf_d, sites_enabled=conf_d, style="rhel")
    return NginxPaths(
        sites_available=os.path.join(nginx_root, "sites-available"),
        sites_enabled=os.path.join(nginx_root, "sites-enabled"),
        style="debian",
    )


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
            style="debian",
        )
    return nginx_paths_for_root("/etc/nginx")


def ensure_nginx_dirs() -> NginxPaths:
    p = get_nginx_paths()
    os.makedirs(p.sites_available, exist_ok=True)
    if p.style != "rhel":
        os.makedirs(p.sites_enabled, exist_ok=True)
    return p


def nginx_site_filename(filename: str, style: str) -> str:
    if style == "rhel" and not filename.endswith(".conf"):
        return f"{filename}.conf"
    return filename


def nginx_available_file(np: NginxPaths, filename: str) -> str:
    return os.path.join(np.sites_available, nginx_site_filename(filename, np.style))


def nginx_enabled_file(np: NginxPaths, filename: str) -> str:
    if np.style == "rhel":
        return nginx_available_file(np, filename)
    return os.path.join(np.sites_enabled, filename)


def list_nginx_site_filenames(np: NginxPaths) -> List[str]:
    if not os.path.isdir(np.sites_available):
        return []
    names: List[str] = []
    if np.style == "rhel":
        for fn in sorted(os.listdir(np.sites_available)):
            if fn in _RHEL_SKIP_CONFS or fn.endswith(".disabled") or not fn.endswith(".conf"):
                continue
            path = os.path.join(np.sites_available, fn)
            if not os.path.isfile(path):
                continue
            try:
                text = Path(path).read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if "server_name" not in text:
                continue
            names.append(fn)
        return names
    for fn in sorted(os.listdir(np.sites_available)):
        path = os.path.join(np.sites_available, fn)
        if os.path.isfile(path):
            names.append(fn)
    return names


def nginx_site_is_enabled(np: NginxPaths, filename: str) -> bool:
    if np.style == "rhel":
        live = nginx_available_file(np, filename)
        return os.path.isfile(live)
    return os.path.exists(nginx_enabled_file(np, filename))


def enable_nginx_site(np: NginxPaths, filename: str) -> None:
    if np.style == "rhel":
        live = nginx_available_file(np, filename)
        disabled = live + ".disabled"
        if os.path.isfile(disabled) and not os.path.isfile(live):
            os.rename(disabled, live)
        return
    available = os.path.join(np.sites_available, filename)
    enabled = nginx_enabled_file(np, filename)
    if not os.path.exists(enabled):
        if IS_WINDOWS:
            shutil.copy2(available, enabled)
        else:
            os.symlink(available, enabled)


def disable_nginx_site(np: NginxPaths, filename: str) -> None:
    if np.style == "rhel":
        live = nginx_available_file(np, filename)
        if os.path.isfile(live):
            os.rename(live, live + ".disabled")
        return
    enabled = nginx_enabled_file(np, filename)
    if os.path.lexists(enabled):
        if os.path.islink(enabled):
            os.unlink(enabled)
        else:
            os.remove(enabled)


def remove_nginx_site(np: NginxPaths, filename: str) -> None:
    if np.style != "rhel":
        enabled = nginx_enabled_file(np, filename)
        if os.path.lexists(enabled):
            if os.path.islink(enabled):
                os.unlink(enabled)
            else:
                os.remove(enabled)
        available = os.path.join(np.sites_available, filename)
        if os.path.isfile(available):
            os.remove(available)
        return
    live = nginx_available_file(np, filename)
    for path in (live, live + ".disabled"):
        if os.path.isfile(path):
            os.remove(path)


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
    return sysexec.run(cmd, timeout=timeout)


def run_with_optional_sudo(cmd: List[str], timeout: int = 120) -> subprocess.CompletedProcess:
    if IS_WINDOWS:
        raise subprocess.CalledProcessError(returncode=1, cmd=cmd, stderr="Command failed on Windows mode.")
    return sysexec.run(cmd, timeout=timeout, as_root=True, check=True)


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


def _php_cli_version() -> str:
    php_bin = _php_resolve_bin("php")
    if not php_bin:
        return ""
    try:
        res = _php_run([php_bin, "-v"])
    except Exception:
        return ""
    match = re.search(r"PHP\s+(\d+\.\d+)", res.stdout or "")
    return match.group(1) if match else ""


def detect_php_fpm_socket(version: str) -> Optional[str]:
    """Return the PHP-FPM socket for ``version``, or None.

    Alma/RHEL ship a single ``/run/php-fpm/www.sock``. That socket is accepted
    only when ``php -v`` reports the same version, so a vhost never silently
    runs a different PHP than the one that has the required extensions.
    """
    ver = (version or "").strip()
    candidates = [
        f"/run/php/php{ver}-fpm.sock",
        f"/var/run/php/php{ver}-fpm.sock",
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    try:
        for path in glob.glob("/run/php/php*-fpm.sock") + glob.glob("/var/run/php/php*-fpm.sock"):
            if ver and ver in os.path.basename(path):
                return path
    except Exception:
        pass
    if ver and _php_cli_version() == ver:
        for candidate in ("/run/php-fpm/www.sock", "/var/run/php-fpm/www.sock"):
            if os.path.exists(candidate):
                return candidate
    return None


def php_fpm_identity(version: str = "") -> Tuple[str, str]:
    """User and group of the PHP-FPM pool that will read the site files."""
    user, group = "www-data", "www-data"
    if not shutil.which("apt-get") and (
        shutil.which("dnf") or shutil.which("yum") or Path("/etc/redhat-release").is_file()
    ):
        user, group = "apache", "apache"
    patterns = []
    if version:
        patterns.append(f"/etc/php/{version}/fpm/pool.d/www.conf")
    patterns.extend([
        "/etc/php/*/fpm/pool.d/www.conf",
        "/etc/php-fpm.d/www.conf",
    ])
    seen = set()
    for pattern in patterns:
        for path in glob.glob(pattern):
            if path in seen:
                continue
            seen.add(path)
            try:
                text = Path(path).read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            user_match = re.search(r"^\s*user\s*=\s*(\S+)", text, re.M)
            group_match = re.search(r"^\s*group\s*=\s*(\S+)", text, re.M)
            if user_match:
                user = user_match.group(1)
            if group_match:
                group = group_match.group(1)
            if user_match or group_match:
                return user, group
    return user, group


def php_fpm_unit(version: str) -> str:
    if shutil.which("apt-get"):
        return f"php{version}-fpm"
    return "php-fpm"


def _start_php_fpm(version: str) -> None:
    ver = (version or "").strip()
    if not ver or IS_WINDOWS:
        return
    units = [php_fpm_unit(ver)]
    if f"php{ver}-fpm" not in units:
        units.append(f"php{ver}-fpm")
    if "php-fpm" not in units:
        units.append("php-fpm")
    for unit in units:
        try:
            sysexec.run(["systemctl", "enable", "--now", unit], timeout=30, as_root=True)
            if detect_php_fpm_socket(ver):
                return
        except Exception:
            continue


def ensure_php_fpm_socket(version: Optional[str] = None, *, strict: bool = True) -> str:
    """Return the PHP-FPM socket for the requested version.

    ``strict`` is kept for callers. A different installed PHP is never
    substituted: that mismatch is what made WordPress report a missing MySQL
    extension after the vhost had been pointed at another socket.
    """
    del strict  # both modes refuse a cross-version fallback
    preferred = (version or "").strip()
    if not preferred or preferred.lower() == "auto":
        preferred = resolve_php_version(preferred or "auto")
    sock = detect_php_fpm_socket(preferred)
    if sock:
        return sock
    _start_php_fpm(preferred)
    sock = detect_php_fpm_socket(preferred)
    if sock:
        return sock
    unit = php_fpm_unit(preferred)
    raise RuntimeError(
        f"PHP-FPM socket for PHP {preferred} was not found. "
        f"Start {unit} (Debian/Ubuntu: php{preferred}-fpm, Alma/RHEL: php-fpm) and retry. "
        "CoPanel will not use a different PHP version."
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
    )
    if n == 0:
        return {"status": "success", "message": "no unix fastcgi_pass to update", "socket": sock, "updated": False}

    if new_content == content:
        return {"status": "success", "message": "PHP-FPM socket already correct", "socket": sock, "updated": False}

    vhost.write_text(new_content, encoding="utf-8")
    if not IS_WINDOWS and shutil.which("nginx"):
        test = sysexec.run(["nginx", "-t"], timeout=30, as_root=True)
        if test.returncode == 0:
            sysexec.run(["systemctl", "reload", "nginx"], timeout=30, as_root=True)
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
    sysexec.run(["nginx", "-t"], timeout=30, check=True)
    sysexec.run(["systemctl", "reload", "nginx"], timeout=30, as_root=True, check=True)


def apache_reload_test(layout: ApacheLayout) -> None:
    if shutil.which("apache2ctl"):
        sysexec.run(["apache2ctl", "configtest"], timeout=30, check=True)
        sysexec.run(["systemctl", "reload", layout.service_name], timeout=30, as_root=True, check=True)
    elif shutil.which("httpd"):
        sysexec.run(["httpd", "-t"], timeout=30, check=True)
        sysexec.run(["systemctl", "reload", layout.service_name], timeout=30, as_root=True, check=True)
    else:
        sysexec.run(["systemctl", "reload", layout.service_name], timeout=30, as_root=True, check=True)


def pkg_manager() -> Optional[str]:
    if shutil.which("apt-get"):
        return "apt-get"
    if shutil.which("yum"):
        return "yum"
    return None


# --- PHP version / extension / php.ini management (merged from php_manager) ---

PHP_SUPPORTED_VERSIONS = ["8.4", "8.3", "8.2", "8.1", "8.0", "7.4"]
PHP_DEFAULT_MODULES = ["mysqli", "curl", "mbstring", "gd", "zip", "xml", "redis", "intl", "soap", "bcmath"]

# Distro package names. `phpX.Y-mysqli` does not exist (the module is in
# `phpX.Y-mysql`); on RHEL the module is `php-mysqlnd`. Unknown extensions
# are rejected instead of guessed, because one bad name aborts the whole apt
# transaction.
PHP_EXT_PACKAGES: Dict[str, Dict[str, str]] = {
    "mysqli": {"apt": "php{ver}-mysql", "rpm": "php-mysqlnd"},
    "pdo_mysql": {"apt": "php{ver}-mysql", "rpm": "php-mysqlnd"},
    "mysql": {"apt": "php{ver}-mysql", "rpm": "php-mysqlnd"},
    "curl": {"apt": "php{ver}-curl", "rpm": "php-common"},
    "mbstring": {"apt": "php{ver}-mbstring", "rpm": "php-mbstring"},
    "gd": {"apt": "php{ver}-gd", "rpm": "php-gd"},
    "zip": {"apt": "php{ver}-zip", "rpm": "php-pecl-zip"},
    "xml": {"apt": "php{ver}-xml", "rpm": "php-xml"},
    "intl": {"apt": "php{ver}-intl", "rpm": "php-intl"},
    "bcmath": {"apt": "php{ver}-bcmath", "rpm": "php-bcmath"},
    "soap": {"apt": "php{ver}-soap", "rpm": "php-soap"},
    "redis": {"apt": "php{ver}-redis", "rpm": "php-pecl-redis"},
}


class UnknownPhpExtension(ValueError):
    """Raised when an extension has no distro package mapping."""


def php_package_family() -> str:
    if shutil.which("apt-get"):
        return "apt"
    if shutil.which("dnf") or shutil.which("yum") or shutil.which("rpm"):
        return "rpm"
    return ""


def php_extension_package(module: str, version: str, family: str) -> str:
    key = (module or "").strip().lower()
    spec = PHP_EXT_PACKAGES.get(key)
    if not spec or family not in spec:
        known = ", ".join(sorted(PHP_EXT_PACKAGES))
        raise UnknownPhpExtension(
            f"No {family or 'distro'} package mapping for PHP extension '{module}'. "
            f"Known extensions: {known}."
        )
    return spec[family].format(ver=version)


def php_extension_packages(modules: List[str], version: str, family: str) -> List[str]:
    packages: List[str] = []
    for module in modules:
        package = php_extension_package(module, version, family)
        if package not in packages:
            packages.append(package)
    return packages


def _php_run(cmd: List[str]) -> subprocess.CompletedProcess:
    return sysexec.run(cmd, timeout=60)


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


def _os_release() -> Dict[str, str]:
    data: Dict[str, str] = {}
    path = Path("/etc/os-release")
    if not path.is_file():
        return data
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return data
    for line in text.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip('"')
    return data


def _apt_candidate_version(package: str) -> str:
    try:
        result = sysexec.run(["apt-cache", "policy", package], timeout=20)
    except sysexec.CommandError:
        return ""
    match = re.search(r"Candidate:\s+(\S+)", result.stdout or "")
    if not match or match.group(1) == "(none)":
        return ""
    found = re.search(r"(\d+\.\d+)", match.group(1))
    return found.group(1) if found else ""


def _rpm_php_candidate() -> str:
    tool = "dnf" if shutil.which("dnf") else ("yum" if shutil.which("yum") else "")
    if tool:
        try:
            result = sysexec.run([tool, "-q", "info", "php-fpm"], timeout=40)
        except sysexec.CommandError:
            result = None
        if result is not None:
            match = re.search(r"^Version\s*:\s*(\d+\.\d+)", result.stdout or "", re.M)
            if match:
                return match.group(1)
    return _php_cli_version()


def distro_default_php() -> str:
    """PHP version the distro repositories would install, without extra repos."""
    if shutil.which("apt-get"):
        version = _apt_candidate_version("php-fpm")
        if version:
            return version
    if shutil.which("dnf") or shutil.which("yum"):
        version = _rpm_php_candidate()
        if version:
            return version
    info = _os_release()
    distro_id = (info.get("ID") or "").lower()
    version_id = info.get("VERSION_ID") or ""
    major = version_id.split(".")[0]
    table = {
        ("ubuntu", "22.04"): "8.1",
        ("ubuntu", "24.04"): "8.3",
        ("debian", "12"): "8.2",
        ("debian", "13"): "8.4",
        ("almalinux", "9"): "8.1",
        ("rocky", "9"): "8.1",
        ("rhel", "9"): "8.1",
        ("centos", "9"): "8.1",
    }
    return table.get((distro_id, version_id)) or table.get((distro_id, major)) or ""


def _php_version_installable(version: str) -> bool:
    if shutil.which("apt-get"):
        return _apt_candidate_version(f"php{version}-fpm").startswith(version) and bool(version)
    if shutil.which("dnf") or shutil.which("yum"):
        candidate = _rpm_php_candidate() or distro_default_php()
        return candidate == version
    return False


def available_php_versions() -> List[str]:
    found: List[str] = []
    for version in PHP_SUPPORTED_VERSIONS:
        if _is_php_version_installed(version) or _php_version_installable(version):
            found.append(version)
    if not found:
        default = distro_default_php()
        if default:
            found.append(default)
    return found


def resolve_php_version(requested: Optional[str]) -> str:
    """Pick a PHP version this distro can actually run.

    ``auto`` / empty prefers a running PHP-FPM, then the distro default.
    An explicit version that is not packaged raises instead of falling back.
    """
    req = (requested or "").strip()
    if req.lower() in {"", "auto"}:
        for row in list_php_fpm_versions():
            version = str(row.get("version") or "").strip()
            if row.get("status") == "running" and version in PHP_SUPPORTED_VERSIONS:
                return version
        active = get_active_php_version()
        if active:
            return active
        default = distro_default_php()
        if default:
            return default
        raise RuntimeError(
            "No PHP version is available from this distro's repositories. "
            "Install php-fpm from the Ubuntu, Debian, or Alma packages. "
            "CoPanel does not enable third-party PHP repositories."
        )
    if req not in PHP_SUPPORTED_VERSIONS:
        raise RuntimeError(
            f"PHP {req} is not supported. Choose one of: {', '.join(PHP_SUPPORTED_VERSIONS)}."
        )
    if _is_php_version_installed(req) or _php_version_installable(req):
        return req
    available = ", ".join(available_php_versions()) or "none"
    raise RuntimeError(
        f"PHP {req} is not available on this system. Available: {available}. "
        "CoPanel will not switch to a different PHP version."
    )


def _extension_loaded(loaded: set[str], module: str) -> bool:
    name = module.lower()
    if name in loaded:
        return True
    if name in {"mysqli", "mysql", "pdo_mysql"}:
        return bool(loaded.intersection({"mysqli", "pdo_mysql", "mysqlnd"}))
    return False


def install_php_extensions(version: str, modules: List[str]) -> Dict[str, Any]:
    """Install the distro packages for ``modules`` and require them to load."""
    requested = [m.strip() for m in modules if m and m.strip()]
    if not requested:
        return {"status": "success", "packages": [], "message": "No PHP extensions requested."}
    if IS_WINDOWS:
        return {"status": "success", "packages": requested, "message": "PHP extensions simulated (Windows)."}
    family = php_package_family()
    if not family:
        raise RuntimeError("No supported package manager to install PHP extensions.")
    packages = php_extension_packages(requested, version, family)
    result = sysexec.pkg_install(packages)
    if not result.get("ok"):
        missing = ", ".join(result.get("missing") or packages)
        tail = result.get("output_tail") or ""
        raise RuntimeError(f"PHP extension install failed ({missing}). {tail}".strip())
    unit = php_fpm_unit(version)
    try:
        sysexec.run(["systemctl", "restart", unit], timeout=30, as_root=True)
    except sysexec.CommandError:
        pass
    loaded = set(get_enabled_modules(version))
    missing_mods = [name for name in requested if not _extension_loaded(loaded, name)]
    if missing_mods:
        raise RuntimeError(
            f"PHP {version} is missing extensions: {', '.join(missing_mods)}. "
            f"Restart {unit} and check `php -m`."
        )
    return {"status": "success", "packages": packages, "message": f"PHP {version} extensions installed."}


def install_php_version(version: str) -> Dict[str, Any]:
    if version not in PHP_SUPPORTED_VERSIONS:
        return {"status": "error", "message": "Unsupported PHP version selected."}
    if IS_WINDOWS:
        return {"status": "success", "message": f"PHP {version} installed successfully (Mock mode)."}
    try:
        family = php_package_family()
        if family == "apt":
            packages = [
                f"php{version}-cli",
                f"php{version}-fpm",
                f"php{version}-mysql",
                f"php{version}-curl",
                f"php{version}-mbstring",
                f"php{version}-xml",
                f"php{version}-zip",
            ]
        elif family == "rpm":
            if not _php_version_installable(version) and not _is_php_version_installed(version):
                available = ", ".join(available_php_versions()) or "none"
                return {
                    "status": "error",
                    "message": (
                        f"PHP {version} is not in the distro repositories. Available: {available}."
                    ),
                }
            packages = ["php-cli", "php-fpm", "php-mysqlnd"]
        else:
            return {"status": "error", "message": "No recognized package manager found to install PHP."}
        installed = sysexec.pkg_install(packages)
        if not installed.get("ok"):
            missing = ", ".join(installed.get("missing") or packages)
            tail = installed.get("output_tail") or ""
            return {"status": "error", "message": f"PHP {version} install failed ({missing}). {tail}".strip()}
        try:
            sysexec.service_enable_now(php_fpm_unit(version))
        except sysexec.CommandError as exc:
            return {"status": "error", "message": str(exc)}
        return {"status": "success", "message": f"PHP {version} installed successfully."}
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
            r = sysexec.run(["apt-get", "purge", "-y", *to_purge], timeout=900, as_root=True)
            out = (r.stdout or "") + (r.stderr or "")
            if r.returncode != 0 and "E: Unable to locate package" not in out:
                tail = out[-800:]
                return {"status": "error", "message": f"apt-get purge failed (exit {r.returncode}): {tail}"}
            ver_re = re.escape(version)
            shell = (
                f"PKGS=$(dpkg-query -W -f '${{Package}}\\n' 2>/dev/null | grep -E '^php{ver_re}(-|$)|^libapache2-mod-php{ver_re}$' || true); "
                f"if [ -n \"$PKGS\" ]; then apt-get purge -y $PKGS; fi"
            )
            sysexec.run(["/bin/bash", "-lc", shell], timeout=900, as_root=True)
            sysexec.run(["apt-get", "autoremove", "-y"], timeout=300, as_root=True)
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
            tool = "dnf" if shutil.which("dnf") else "yum"
            sysexec.run(
                [tool, "remove", "-y", "php-fpm", "php-cli", "php-mysqlnd"],
                timeout=900,
                as_root=True,
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
            sysexec.run(["update-alternatives", "--set", "php", php_bin], timeout=30, as_root=True)
        if shutil.which("systemctl"):
            sysexec.run(["systemctl", "restart", php_fpm_unit(version)], timeout=30, as_root=True)
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
            cmd = ["phpenmod" if enable else "phpdismod", "-v", version, module]
            res = sysexec.run(cmd, timeout=60, as_root=True)
            err = (res.stderr or "") + (res.stdout or "")
            if res.returncode != 0:
                low = err.lower()
                if "not found" in low or "doesn't exist" in low or "cannot find" in low:
                    return {"status": "error", "message": f"Module '{module}' not found for PHP {version}."}
                return {"status": "error", "message": err.strip() or f"phpenmod/phpdismod exited {res.returncode}"}
            sysexec.run(["systemctl", "restart", php_fpm_unit(version)], timeout=30, as_root=True)
            after = set(get_enabled_modules(version))
            mod_l = module.lower()
            if enable and mod_l not in after:
                return {
                    "status": "error",
                    "message": f"Module '{module}' did not appear loaded after enable for PHP {version}.",
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
            sysexec.run(["systemctl", "restart", php_fpm_unit(version)], timeout=30, as_root=True, check=True)
        return {"status": "success", "message": f"php.ini for PHP {version} successfully updated and restarted."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _require_pkg_install(packages: List[str]) -> None:
    result = sysexec.pkg_install(packages)
    if not result.get("ok"):
        missing = ", ".join(result.get("missing") or packages)
        tail = result.get("output_tail") or ""
        raise RuntimeError(f"Package install failed ({missing}). {tail}".strip())


def bootstrap_stack_sync(preset: str, php_version: Optional[str], log: Optional[Any] = None) -> Dict[str, Any]:
    """Install a LEMP/LAMP preset. Raises RuntimeError with the package tail on failure."""
    def _log(line: str) -> None:
        if log:
            log(line)

    if IS_WINDOWS:
        return {"status": "success", "message": f"Bootstrap '{preset}' simulated (Windows)."}
    family = php_package_family()
    if not family:
        raise RuntimeError("No supported package manager (apt-get, dnf, or yum).")
    version = (php_version or "").strip() or "auto"
    if preset in {"lemp", "lamp", "php_mysql"}:
        version = resolve_php_version(version)
        _log(f"PHP {version}")
    packages: List[str] = []
    services: List[str] = []
    if preset == "nginx_only":
        packages = ["nginx"]
        services = ["nginx"]
    elif preset == "apache_only":
        packages = ["apache2"] if family == "apt" else ["httpd"]
        services = ["apache2"] if family == "apt" else ["httpd"]
    elif preset == "lemp":
        if family == "apt":
            packages = ["nginx", f"php{version}-fpm", f"php{version}-cli", f"php{version}-mysql", "mariadb-server"]
            services = ["nginx", f"php{version}-fpm", "mariadb"]
        else:
            packages = ["nginx", "php-fpm", "php-mysqlnd", "mariadb-server"]
            services = ["nginx", "php-fpm", "mariadb"]
    elif preset == "lamp":
        if family == "apt":
            packages = ["apache2", f"php{version}", f"libapache2-mod-php{version}", f"php{version}-mysql", "mariadb-server"]
            services = ["apache2", "mariadb"]
        else:
            packages = ["httpd", "php", "php-mysqlnd", "mariadb-server"]
            services = ["httpd", "mariadb"]
    elif preset == "php_mysql":
        if family == "apt":
            packages = [
                f"php{version}-fpm", f"php{version}-cli", f"php{version}-mysql",
                f"php{version}-curl", f"php{version}-mbstring", f"php{version}-xml",
            ]
            services = [f"php{version}-fpm"]
        else:
            packages = ["php-fpm", "php-mysqlnd", "php-cli"]
            services = ["php-fpm"]
    else:
        raise RuntimeError(f"Unknown stack preset '{preset}'.")
    _log("Installing " + ", ".join(packages))
    _require_pkg_install(packages)
    for unit in services:
        try:
            sysexec.service_enable_now(unit)
            _log(f"Service {unit} is active")
        except sysexec.CommandError as exc:
            if unit == "mariadb":
                try:
                    sysexec.service_enable_now("mysql")
                    _log("Service mysql is active")
                    continue
                except sysexec.CommandError:
                    pass
            raise RuntimeError(str(exc)) from exc
    return {"status": "success", "message": f"Stack bootstrap '{preset}' completed.", "php_version": version}
