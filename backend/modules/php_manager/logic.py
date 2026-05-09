"""
Advanced PHP Manager Logic
Provides installation for PHP versions, and editing of php.ini config files.
"""
import os
import shutil
import subprocess
import re
from pathlib import Path
from typing import List, Dict, Any, Optional

IS_WINDOWS = os.name == 'nt'
# Keep in sync with frontend INSTALLABLE_VERSIONS (newest first for display preference)
SUPPORTED_VERSIONS = ["8.4", "8.3", "8.2", "8.1", "8.0", "7.4"]
DEFAULT_MODULES = ["mysqli", "curl", "mbstring", "gd", "zip", "xml", "redis", "intl", "soap", "bcmath"]


def _run(cmd: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=False, capture_output=True, text=True)


def get_active_php_version() -> str:
    """Best-effort detect active system PHP CLI version (must be actually installed)."""
    if IS_WINDOWS:
        return SUPPORTED_VERSIONS[0]
    installed = set(get_php_versions())
    try:
        if shutil.which("php"):
            res = _run(["php", "-v"])
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
    """True only when this PHP stream is clearly present (avoid empty /etc/php/X.Y leftovers)."""
    if IS_WINDOWS:
        return False
    php_bin = shutil.which(f"php{version}")
    if php_bin:
        res = _run([php_bin, "-v"])
        if res.returncode == 0 and res.stdout and version in res.stdout.splitlines()[0]:
            return True
    fpm = shutil.which(f"php-fpm{version}")
    if fpm:
        return True
    cli_ini = Path(f"/etc/php/{version}/cli/php.ini")
    fpm_ini = Path(f"/etc/php/{version}/fpm/php.ini")
    if cli_ini.is_file() or fpm_ini.is_file():
        return True
    return False


def _debian_packages_for_php_version(version: str) -> List[str]:
    """Installed dpkg packages belonging to a PHP X.Y stream (for apt remove)."""
    res = _run(["dpkg-query", "-W", "-f=${Package}\n"])
    if res.returncode != 0 or not res.stdout.strip():
        return []
    prefix = f"php{version}"
    out: List[str] = []
    for line in res.stdout.splitlines():
        pkg = line.strip()
        if not pkg:
            continue
        if pkg == prefix or pkg.startswith(f"{prefix}-"):
            out.append(pkg)
    return sorted(set(out))


def get_php_versions() -> List[str]:
    """PHP versions actually installed on the system (never pretend all are installed)."""
    if IS_WINDOWS:
        return list(SUPPORTED_VERSIONS)

    installed: List[str] = []
    for v in SUPPORTED_VERSIONS:
        if _is_php_version_installed(v):
            installed.append(v)
    return sorted(installed, key=lambda x: tuple(map(int, x.split("."))), reverse=True)


def get_php_versions_meta() -> Dict[str, Any]:
    installed = get_php_versions()
    active = get_active_php_version()
    if active and active not in installed:
        active = installed[0] if installed else ""
    return {
        "versions": installed,
        "active": active,
        "supported": list(SUPPORTED_VERSIONS),
    }

def get_php_modules() -> List[str]:
    """Retrieves standard PHP modules."""
    return DEFAULT_MODULES


def _normalize_mods_enabled_stem(stem: str) -> str:
    """20-curl.ini -> curl; xml.ini -> xml."""
    name = stem.replace(".ini", "")
    return re.sub(r"^\d+-", "", name).strip().lower()


def get_enabled_modules(version: str) -> List[str]:
    """Return loaded extension names for a specific PHP version (phpX.Y -m when possible)."""
    if IS_WINDOWS:
        return list(DEFAULT_MODULES)

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

    php_bin = shutil.which(f"php{version}")
    if php_bin:
        res = _run([php_bin, "-m"])
        if res.returncode == 0 and res.stdout.strip():
            return sorted(_parse_php_m(res.stdout))

    modules_set: set[str] = set()
    enabled_dir = Path(f"/etc/php/{version}/mods-enabled")
    if enabled_dir.is_dir():
        for ini in enabled_dir.glob("*.ini"):
            modules_set.add(_normalize_mods_enabled_stem(ini.stem))
    if modules_set:
        return sorted(modules_set)

    fallback = shutil.which("php")
    if fallback:
        res = _run([fallback, "-v"])
        if res.returncode == 0 and res.stdout and version in res.stdout.splitlines()[0]:
            resm = _run([fallback, "-m"])
            if resm.returncode == 0:
                return sorted(_parse_php_m(resm.stdout))

    return []

def install_php_version(version: str) -> Dict[str, Any]:
    """Install a specific PHP version via apt-get or yum."""
    if version not in SUPPORTED_VERSIONS:
        return {"status": "error", "message": "Unsupported PHP version selected."}

    if IS_WINDOWS:
        return {"status": "success", "message": f"PHP {version} installed successfully (Mock mode)."}

    # Use apt-get or yum
    try:
        pkg_manager = "apt-get" if shutil.which("apt-get") else ("yum" if shutil.which("yum") else None)
        if pkg_manager == "apt-get":
            cmd = [
                "sudo", "apt-get", "install", "-y",
                f"php{version}", f"php{version}-fpm", f"php{version}-mysql", f"php{version}-curl",
                f"php{version}-mbstring", f"php{version}-xml", f"php{version}-zip",
            ]
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            return {"status": "success", "message": f"PHP {version} installed successfully."}
        elif pkg_manager == "yum":
            # For CentOS / AlmaLinux, usually via Remi repo
            cmd = ["sudo", "yum", "install", "-y", f"php{version}-fpm", f"php{version}-mysql"]
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            return {"status": "success", "message": f"PHP {version} installed successfully via yum."}
        return {"status": "error", "message": "No recognized package manager found to install PHP."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def uninstall_php_version(version: str) -> Dict[str, Any]:
    if version not in SUPPORTED_VERSIONS:
        return {"status": "error", "message": "Unsupported PHP version selected."}
    if IS_WINDOWS:
        return {"status": "success", "message": f"PHP {version} removed successfully (Mock mode)."}
    try:
        pkg_manager = "apt-get" if shutil.which("apt-get") else ("yum" if shutil.which("yum") else None)
        if pkg_manager == "apt-get":
            pkgs = _debian_packages_for_php_version(version)
            if not pkgs:
                if _is_php_version_installed(version):
                    subprocess.run(
                        ["sudo", "apt-get", "remove", "-y", f"php{version}", f"php{version}-common", f"php{version}-cli", f"php{version}-fpm"],
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                else:
                    return {"status": "success", "message": f"PHP {version} is not installed (nothing to remove)."}
            else:
                r = subprocess.run(["sudo", "apt-get", "remove", "-y", *pkgs], check=False, capture_output=True, text=True)
                if r.returncode != 0 and r.stderr:
                    tail = (r.stderr + r.stdout)[-500:]
                    return {"status": "error", "message": f"apt-get remove failed: {tail}"}
            subprocess.run(["sudo", "apt-get", "autoremove", "-y"], check=False, capture_output=True, text=True)
            return {"status": "success", "message": f"PHP {version} packages removed."}
        if pkg_manager == "yum":
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
    """Switch active CLI PHP and restart matching FPM if available."""
    if version not in SUPPORTED_VERSIONS:
        return {"status": "error", "message": "Unsupported PHP version selected."}
    if IS_WINDOWS:
        return {"status": "success", "message": f"PHP {version} set active (Mock mode)."}
    try:
        php_bin = shutil.which(f"php{version}")
        if php_bin and shutil.which("update-alternatives"):
            _run(["sudo", "update-alternatives", "--set", "php", php_bin])
        if shutil.which("systemctl"):
            _run(["sudo", "systemctl", "restart", f"php{version}-fpm"])
        return {"status": "success", "message": f"PHP {version} set as active."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def toggle_php_module(version: str, module: str, enable: bool) -> Dict[str, Any]:
    """Enable/disable PHP module for selected version."""
    if not module:
        return {"status": "error", "message": "Module is required."}
    if IS_WINDOWS:
        return {"status": "success", "message": f"Module {module} {'enabled' if enable else 'disabled'} (Mock mode)."}
    try:
        if shutil.which("phpenmod") and shutil.which("phpdismod"):
            before = set(get_enabled_modules(version))
            cmd = ["sudo", "phpenmod" if enable else "phpdismod", "-v", version, module]
            res = _run(cmd)
            err = (res.stderr or "") + (res.stdout or "")
            if res.returncode != 0:
                low = err.lower()
                if "not found" in low or "doesn't exist" in low or "cannot find" in low:
                    return {"status": "error", "message": f"Module '{module}' not found for PHP {version}."}
                return {"status": "error", "message": err.strip() or f"phpenmod/phpdismod exited {res.returncode}"}
            _run(["sudo", "systemctl", "restart", f"php{version}-fpm"])
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
    """Reads the php.ini configuration file for the selected PHP version."""
    ini_path = Path(f"/etc/php/{version}/fpm/php.ini") if not IS_WINDOWS else Path(f"./test_nginx/php_{version}_fpm_php.ini")
    
    if ini_path.exists():
        return ini_path.read_text(encoding="utf-8", errors="ignore")
    
    # Fallback to creating a sample php.ini file
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
    """Writes to php.ini and restarts php-fpm to apply."""
    ini_path = Path(f"/etc/php/{version}/fpm/php.ini") if not IS_WINDOWS else Path(f"./test_nginx/php_{version}_fpm_php.ini")
    
    try:
        ini_path.parent.mkdir(parents=True, exist_ok=True)
        ini_path.write_text(content, encoding="utf-8")
        
        # Restart FPM service on Linux
        if not IS_WINDOWS:
            service_name = f"php{version}-fpm"
            subprocess.run(["sudo", "systemctl", "restart", service_name], check=True, capture_output=True, text=True)
        
        return {"status": "success", "message": f"php.ini for PHP {version} successfully updated and restarted."}
    except Exception as e:
        return {"status": "error", "message": str(e)}
