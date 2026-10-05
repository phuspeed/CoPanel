"""
Site Wizard logic.

Orchestrates the existing hosting modules to provision a complete website
in one transactional flow:

    1. Validate inputs (domain, paths, ports).
    2. Create the document root.
    3. Create the Nginx vhost via web_manager.
    4. Optionally create database + database user via database_manager.
    5. Optionally issue an SSL certificate via ssl_manager.
    6. Verify the site (HTTP HEAD against the configured domain).

Each step writes a log line into the supplied job, updates progress, and
records an audit entry. On failure we attempt to roll back the most recent
mutation so the panel never leaves dangling configuration on disk.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import secrets
import shutil
import socket
import ssl
import string
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from core import sysexec
from core.validators import validate_db_name, validate_db_username, validate_doc_root, validate_domain

from .templates import get_template, resolve_wizard_defaults


@dataclass
class WizardRequest:
    domain: str
    document_root: str
    template_id: Optional[str] = "static"
    php_version: Optional[str] = None
    php_modules: List[str] = field(default_factory=list)
    proxy_port: Optional[int] = None
    create_database: bool = False
    database_name: Optional[str] = None
    database_user: Optional[str] = None
    database_password: Optional[str] = None
    issue_ssl: bool = False
    ssl_email: Optional[str] = None


@dataclass
class WizardResult:
    domain: str
    document_root: str
    site_filename: str
    database: Optional[Dict[str, Any]] = None
    ssl: Optional[Dict[str, Any]] = None
    verification: Optional[Dict[str, Any]] = None
    rollback: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    summary: str = ""


def _validate_domain(domain: str) -> str:
    return validate_domain(domain)


def _validate_doc_root(root: str) -> str:
    return validate_doc_root(root)


def _generate_password(length: int = 18) -> str:
    alphabet = string.ascii_letters + string.digits + "_-"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _slug(domain: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", domain.replace(".", "_")).lower()


def derive_db_identifiers(
    domain: str,
    database_name: Optional[str] = None,
    database_user: Optional[str] = None,
) -> tuple[str, str]:
    """Build a database name and a user that will not collide on a 14-char prefix.

    The user is ``slug[:23] + '_' + 8 hex chars of sha1(domain)``, at most 32.
    """
    slug = _slug(domain) or "site"
    db_name = (database_name or slug)[:48]
    if database_user:
        db_user = database_user
    else:
        digest = hashlib.sha1(domain.encode("utf-8")).hexdigest()[:8]
        db_user = f"{slug[:23]}_{digest}"[:32]
    return validate_db_name(db_name), validate_db_username(db_user)


def _safe_call(label: str, fn: Callable[[], Dict[str, Any]]) -> Dict[str, Any]:
    """Run ``fn`` and normalize errors into the standard envelope."""
    try:
        result = fn()
        if isinstance(result, dict):
            return result
        return {"status": "success", "message": label, "raw": result}
    except Exception as exc:
        return {"status": "error", "message": f"{label} failed: {exc}"}


def _http_verify(domain: str, timeout: float = 6.0, use_https: bool = False) -> Dict[str, Any]:
    """Best-effort HTTP HEAD check to confirm the site responds with a success status."""
    try:
        ip = socket.gethostbyname(domain)
    except OSError as exc:
        return {"reachable": False, "error": f"DNS lookup failed: {exc}"}

    scheme = "https" if use_https else "http"
    port = 443 if use_https else 80
    url = f"{scheme}://{domain}/"
    req = urllib.request.Request(
        url,
        method="HEAD",
        headers={"User-Agent": "copanel-site-wizard", "Host": domain},
    )
    ctx = ssl.create_default_context() if use_https else None
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            status = int(getattr(resp, "status", 0) or 0)
            reason = getattr(resp, "reason", "") or ""
            status_line = f"HTTP/1.1 {status} {reason}".strip()
            return {
                "reachable": 200 <= status < 400,
                "ip": ip,
                "port": port,
                "status_code": status,
                "status_line": status_line,
                "https": use_https,
            }
    except urllib.error.HTTPError as exc:
        status_line = f"HTTP/1.1 {exc.code} {exc.reason}"
        return {
            "reachable": 200 <= exc.code < 400,
            "ip": ip,
            "port": port,
            "status_code": exc.code,
            "status_line": status_line,
            "https": use_https,
        }
    except OSError as exc:
        return {"reachable": False, "ip": ip, "port": port, "error": str(exc), "https": use_https}


def _local_ips() -> set[str]:
    found: set[str] = set()
    try:
        result = sysexec.run(["ip", "-j", "addr"], timeout=5)
        if result.returncode == 0 and result.stdout:
            payload = json.loads(result.stdout)
            for iface in payload:
                for addr in iface.get("addr_info") or []:
                    local = addr.get("local")
                    if local:
                        found.add(local)
    except Exception:
        pass
    if not found:
        try:
            result = sysexec.run(["hostname", "-I"], timeout=5)
            for part in (result.stdout or "").split():
                found.add(part)
        except Exception:
            pass
    found.discard("127.0.0.1")
    found.discard("::1")
    return found


def _public_ip() -> str:
    try:
        req = urllib.request.Request(
            "https://api.ipify.org",
            headers={"User-Agent": "copanel-site-wizard"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            text = resp.read(64).decode("ascii", errors="ignore").strip()
    except Exception:
        return ""
    if re.fullmatch(r"[0-9a-fA-F:.]+", text):
        return text
    return ""


def dns_points_here(domain: str) -> Dict[str, Any]:
    """True when an A/AAAA record for ``domain`` is an address of this server."""
    records: set[str] = set()
    try:
        for info in socket.getaddrinfo(domain, None):
            records.add(info[4][0])
    except OSError as exc:
        return {
            "dns_ok": False,
            "reason": f"DNS lookup failed: {exc}",
            "records": [],
            "server_ips": sorted(_local_ips()),
        }
    server_ips = _local_ips()
    public = _public_ip()
    if public:
        server_ips.add(public)
    return {
        "dns_ok": bool(records and (records & server_ips)),
        "reason": "",
        "records": sorted(records),
        "server_ips": sorted(server_ips),
    }


def _nginx_ready() -> bool:
    binary = bool(shutil.which("nginx") or Path("/usr/sbin/nginx").is_file())
    return binary and sysexec.service_is_active("nginx")


def _mysql_server_active() -> bool:
    return (
        sysexec.service_is_active("mariadb")
        or sysexec.service_is_active("mysql")
        or sysexec.service_is_active("mysqld")
    )


def _mysql_accepts_root() -> bool:
    if not (shutil.which("mysql") or shutil.which("mariadb")):
        return False
    if not _mysql_server_active():
        return False
    try:
        result = sysexec.run(
            ["mysql", "-u", "root", "-N", "-B", "-e", "SELECT 1"],
            timeout=10,
            as_root=True,
        )
    except sysexec.CommandError:
        return False
    return result.returncode == 0 and (result.stdout or "").strip() == "1"


def _enable_database_service() -> None:
    last = ""
    for unit in ("mariadb", "mysql", "mysqld"):
        try:
            sysexec.service_enable_now(unit)
            return
        except sysexec.CommandError as exc:
            last = str(exc)
    raise RuntimeError(last or "Could not start MariaDB or MySQL.")


def get_preflight_status(domain: Optional[str] = None) -> Dict[str, Any]:
    """Report stack readiness for the wizard UI."""
    from modules.web_manager import logic as wm_logic

    nginx_bin = bool(shutil.which("nginx") or Path("/usr/sbin/nginx").is_file())
    nginx_ok = _nginx_ready()
    mysql_bin = bool(shutil.which("mysql") or shutil.which("mariadb") or Path("/usr/bin/mysql").is_file())
    mysql_ok = _mysql_accepts_root()
    php_meta = wm_logic.get_php_versions_meta()
    php_versions = php_meta.get("versions") or []
    php_active = php_meta.get("active") or ""
    fpm_rows = wm_logic.list_php_fpm_versions()
    suggested = ""
    php_note = ""
    try:
        suggested = wm_logic.resolve_php_version("auto")
    except Exception as exc:
        php_note = str(exc)
    payload: Dict[str, Any] = {
        "nginx": {"installed": nginx_bin, "ready": nginx_ok},
        "mysql": {"installed": mysql_bin, "ready": mysql_ok},
        "php": {
            "installed_versions": php_versions,
            "active": php_active,
            "suggested": suggested,
            "fpm": fpm_rows,
            "ready": bool(php_versions or fpm_rows or suggested),
            "note": php_note,
        },
        "ready_for_lemp": nginx_ok and mysql_ok and bool(php_versions or fpm_rows or suggested),
        "ready_for_static": nginx_ok,
    }
    if domain:
        try:
            payload["dns"] = dns_points_here(domain)
        except Exception as exc:
            payload["dns"] = {"dns_ok": False, "reason": str(exc), "records": [], "server_ips": []}
    return payload


def _install_packages(packages: List[str], label: str) -> None:
    result = sysexec.pkg_install(packages)
    if not result.get("ok"):
        missing = ", ".join(result.get("missing") or packages)
        tail = result.get("output_tail") or ""
        raise RuntimeError(f"{label} failed ({missing}). {tail}".strip())


def _ensure_stack(job, template_id: Optional[str], php_version: Optional[str], php_modules: Optional[List[str]] = None) -> str:
    """Install the stack the template needs and return the PHP version in use.

    Returns an empty string when the template does not use PHP. A missing
    package or a PHP build that does not load the required extensions fails
    the job instead of being logged and ignored.
    """
    from modules.web_manager import logic as wm_logic

    tpl = get_template(template_id or "static") or {}
    preset = tpl.get("stack_preset")
    if not _nginx_ready():
        job.log("Installing nginx")
        _install_packages(["nginx"], "nginx install")
        try:
            sysexec.service_enable_now("nginx")
        except sysexec.CommandError as exc:
            raise RuntimeError(f"nginx did not start. {exc}") from exc
    if preset not in ("lemp", "lamp"):
        job.log("Stack preflight OK (nginx)")
        return ""

    version = wm_logic.resolve_php_version(php_version or tpl.get("php_version") or "auto")
    job.log(f"Using PHP {version}")
    if not wm_logic._is_php_version_installed(version):
        job.log(f"Installing PHP {version}")
        res = wm_logic.install_php_version(version)
        if res.get("status") != "success":
            raise RuntimeError(f"PHP {version} install failed: {res.get('message')}")
    unit = wm_logic.php_fpm_unit(version)
    try:
        sysexec.service_enable_now(unit)
    except sysexec.CommandError as exc:
        raise RuntimeError(
            f"PHP-FPM service {unit} did not start. {exc}"
        ) from exc
    modules = list(php_modules if php_modules is not None else (tpl.get("php_modules") or []))
    if modules:
        job.log("Installing PHP extensions: " + ", ".join(modules))
        wm_logic.install_php_extensions(version, modules)
    if not _mysql_accepts_root():
        job.log("Installing MariaDB")
        _install_packages(["mariadb-server"], "MariaDB install")
        _enable_database_service()
        if not _mysql_accepts_root():
            raise RuntimeError(
                "MariaDB/MySQL is not accepting connections. "
                "Check `systemctl status mariadb` and that root can run `mysql -u root -e 'SELECT 1'`."
            )
    job.log(f"Stack preflight OK (PHP {version}, MariaDB)")
    return version


def _update_wordpress_site_urls(doc_root: str, domain: str, use_https: bool) -> bool:
    """Point WordPress siteurl/home at the public URL (https after SSL)."""
    root = Path(doc_root)
    if not (root / "wp-load.php").is_file():
        return False
    scheme = "https" if use_https else "http"
    url = f"{scheme}://{domain}"
    script = root / ".copanel-wp-urls.php"
    script.write_text(
        f"""<?php
$_SERVER['HTTP_HOST'] = {json.dumps(domain)};
$_SERVER['HTTPS'] = {json.dumps('on' if use_https else 'off')};
define('WP_USE_THEMES', false);
require_once __DIR__ . '/wp-load.php';
if (!function_exists('update_option')) {{ echo 'NOWP'; exit(1); }}
update_option('siteurl', {json.dumps(url)});
update_option('home', {json.dumps(url)});
echo 'OK';
""",
        encoding="utf-8",
    )
    try:
        php_bin = _find_php_bin()
        res = sysexec.run(
            [php_bin, "-d", "display_errors=0", str(script)],
            timeout=30,
            cwd=str(root),
        )
        return (res.stdout or "").strip().endswith("OK")
    except Exception:
        return False
    finally:
        try:
            script.unlink(missing_ok=True)
        except Exception:
            pass


def _ensure_vhost_php_fpm(domain: str, php_version: Optional[str], job, result: WizardResult) -> None:
    """Repair nginx fastcgi_pass so WordPress does not 502 on a dead PHP-FPM socket."""
    from modules.web_manager.logic import repair_nginx_php_socket

    fix = repair_nginx_php_socket(domain, php_version)
    if fix.get("status") == "success":
        if fix.get("updated"):
            job.log(f"PHP-FPM socket repaired: {fix.get('socket')}")
        else:
            job.log(f"PHP-FPM socket OK: {fix.get('socket') or 'n/a'}")
    else:
        msg = fix.get("message") or "PHP-FPM socket check failed"
        result.warnings.append(msg)
        job.log(f"PHP-FPM warning: {msg}")


def _write_static_placeholder(doc_root: str, domain: str) -> None:
    index = Path(doc_root) / "index.html"
    if index.is_file():
        return
    index.write_text(
        f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>{domain}</title>
<style>body{{font-family:system-ui,sans-serif;max-width:640px;margin:4rem auto;padding:0 1rem;color:#1e293b}}
h1{{color:#2563eb}}.badge{{display:inline-block;background:#dbeafe;color:#1d4ed8;padding:.25rem .75rem;border-radius:999px;font-size:.75rem}}</style>
</head>
<body>
<h1>Site Wizard</h1>
<p class="badge">Provisioned by CoPanel</p>
<p>Your site <strong>{domain}</strong> is live. Replace this file with your content.</p>
</body>
</html>
""",
        encoding="utf-8",
    )


def _php_single_quoted(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _wp_config_db_define_replacements(database: Dict[str, Any]) -> List[tuple[str, str]]:
    host = database.get("host", "localhost")
    return [
        (
            r"define\s*\(\s*['\"]DB_NAME['\"]\s*,\s*['\"][^'\"]*['\"]\s*\)\s*;",
            f"define('DB_NAME', {_php_single_quoted(database['name'])});",
        ),
        (
            r"define\s*\(\s*['\"]DB_USER['\"]\s*,\s*['\"][^'\"]*['\"]\s*\)\s*;",
            f"define('DB_USER', {_php_single_quoted(database['user'])});",
        ),
        (
            r"define\s*\(\s*['\"]DB_PASSWORD['\"]\s*,\s*['\"][^'\"]*['\"]\s*\)\s*;",
            f"define('DB_PASSWORD', {_php_single_quoted(database['password'])});",
        ),
        (
            r"define\s*\(\s*['\"]DB_HOST['\"]\s*,\s*['\"][^'\"]*['\"]\s*\)\s*;",
            f"define('DB_HOST', {_php_single_quoted(host)});",
        ),
    ]


def _apply_wp_config_db_defines(cfg: str, database: Dict[str, Any]) -> str:
    updated = cfg
    if "database_name_here" in updated:
        updated = updated.replace("database_name_here", database["name"])
        updated = updated.replace("username_here", database["user"])
        updated = updated.replace("password_here", database["password"])
    for pattern, replacement in _wp_config_db_define_replacements(database):
        if re.search(pattern, updated):
            updated = re.sub(pattern, replacement, updated, count=1)
    return updated


def _mysql_user_query(database: Dict[str, Any], sql: str, timeout: int = 15, schema: str = "") -> Any:
    """Query MySQL as the site user. The password stays in a 0600 defaults file."""
    fd, path = tempfile.mkstemp(prefix="copanel-my-")
    os.close(fd)
    try:
        password = str(database.get("password") or "").replace("\n", "").replace("\r", "")
        Path(path).write_text(
            "[client]\n"
            f"user={database['user']}\n"
            f"password={password}\n"
            f"host={database.get('host', 'localhost')}\n",
            encoding="utf-8",
        )
        os.chmod(path, 0o600)
        cmd = ["mysql", f"--defaults-extra-file={path}", "-N", "-B", "-e", sql]
        if schema:
            cmd.append(schema)
        return sysexec.run(cmd, timeout=timeout)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _verify_mysql_connection(database: Dict[str, Any]) -> bool:
    try:
        res = _mysql_user_query(database, "SELECT 1;", timeout=10)
        return res.returncode == 0 and (res.stdout or "").strip() == "1"
    except Exception:
        return False


def _resolve_wp_db_host(database: Dict[str, Any]) -> str:
    """Pick a DB_HOST value that works for both mysql CLI and PHP mysqli."""
    candidates: List[str] = []
    preferred = database.get("host") or "localhost"
    candidates.append(preferred)
    if preferred == "localhost":
        candidates.append("127.0.0.1")
    elif preferred == "127.0.0.1":
        candidates.append("localhost")
    for host in candidates:
        test_db = {**database, "host": host}
        if _verify_mysql_connection(test_db):
            return host
    tried = ", ".join(candidates)
    raise RuntimeError(
        f"Cannot connect to MySQL database '{database.get('name')}' as user "
        f"'{database.get('user')}' (tried host: {tried}). "
        "Ensure MariaDB is running and credentials are correct."
    )


def _wordpress_files_present(root: Path) -> bool:
    return (root / "wp-includes" / "version.php").is_file()


def _update_wp_config_database(root: Path, database: Dict[str, Any]) -> bool:
    """Update database credentials in an existing wp-config.php."""
    wp_config = root / "wp-config.php"
    if not wp_config.is_file():
        return False
    cfg = wp_config.read_text(encoding="utf-8", errors="ignore")
    updated = _apply_wp_config_db_defines(cfg, database)
    if updated != cfg:
        wp_config.write_text(updated, encoding="utf-8")
        return True
    return False


def _write_wp_config(root: Path, database: Dict[str, Any]) -> bool:
    """Create wp-config.php from the sample template. Returns True when written."""
    wp_config = root / "wp-config.php"
    sample = root / "wp-config-sample.php"
    if wp_config.is_file() or not sample.is_file():
        return False
    cfg = _apply_wp_config_db_defines(sample.read_text(encoding="utf-8", errors="ignore"), database)
    for key in (
        "AUTH_KEY", "SECURE_AUTH_KEY", "LOGGED_IN_KEY", "NONCE_KEY",
        "AUTH_SALT", "SECURE_AUTH_SALT", "LOGGED_IN_SALT", "NONCE_SALT",
    ):
        cfg = re.sub(
            rf"define\(\s*'{key}'\s*,\s*'put your unique phrase here'\s*\);",
            f"define('{key}', '{secrets.token_hex(32)}');",
            cfg,
            count=1,
        )
    wp_config.write_text(cfg, encoding="utf-8")
    return True


def _ensure_wp_config(root: Path, database: Dict[str, Any]) -> bool:
    if (root / "wp-config.php").is_file():
        return _update_wp_config_database(root, database)
    return _write_wp_config(root, database)


def _wordpress_db_installed(database: Dict[str, Any]) -> bool:
    """Return True when the WordPress schema (wp_options) exists in the database."""
    db_name = database.get("name", "")
    if not db_name:
        return False
    try:
        res = _mysql_user_query(database, "SHOW TABLES LIKE 'wp_options';", timeout=15, schema=db_name)
        return res.returncode == 0 and (res.stdout or "").strip() == "wp_options"
    except Exception:
        return False


def _find_php_bin() -> str:
    for name in ("php", "php8.3", "php8.2", "php8.1", "php8.0", "php7.4"):
        path = shutil.which(name)
        if path:
            return path
    for path in (
        "/usr/bin/php",
        "/usr/bin/php8.3",
        "/usr/bin/php8.2",
        "/usr/bin/php8.1",
        "/usr/sbin/php",
    ):
        if Path(path).is_file() and os.access(path, os.X_OK):
            return path
    raise RuntimeError("PHP CLI binary not found (needed for WordPress install).")


def _wp_cli_path() -> Optional[str]:
    for name in ("wp", "wp-cli"):
        path = shutil.which(name)
        if path:
            return path
    phar = Path("/usr/local/bin/wp")
    if phar.is_file():
        return str(phar)
    return None


def _download_https(url: str, dest: Path, *, timeout: int = 60, max_bytes: int = 80_000_000) -> None:
    if not str(url).startswith("https://"):
        raise RuntimeError(f"Refusing non-HTTPS download: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "copanel-site-wizard"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            total = 0
            with dest.open("wb") as handle:
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise RuntimeError(f"Download exceeded {max_bytes} bytes: {url}")
                    handle.write(chunk)
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Download failed for {url}: {exc}") from exc


def _download_text(url: str, *, timeout: int = 30, max_bytes: int = 4096) -> str:
    dest_dir = Path(tempfile.mkdtemp(prefix="copanel-dl-"))
    dest = dest_dir / "body"
    try:
        _download_https(url, dest, timeout=timeout, max_bytes=max_bytes)
        return dest.read_text(encoding="utf-8", errors="ignore")
    finally:
        shutil.rmtree(dest_dir, ignore_errors=True)


def _checksum_token(text: str) -> str:
    token = (text or "").strip().split()
    return token[0].lower() if token else ""


def _ensure_wp_cli_phar(job_id: str) -> Optional[str]:
    """Download wp-cli.phar into a per-job directory and check its sha512."""
    directory = Path(tempfile.mkdtemp(prefix=f"copanel-wpcli-{job_id}-"))
    phar = directory / "wp-cli.phar"
    try:
        _download_https(
            "https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar",
            phar,
            timeout=60,
            max_bytes=20_000_000,
        )
        digest_text = _download_text(
            "https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar.sha512",
            timeout=30,
        )
        expected = _checksum_token(digest_text)
        actual = hashlib.sha512(phar.read_bytes()).hexdigest()
        if not expected or actual != expected:
            raise RuntimeError(
                f"wp-cli.phar checksum mismatch (expected {expected or 'missing'}, got {actual})."
            )
        if phar.stat().st_size < 100_000:
            raise RuntimeError("wp-cli.phar download was incomplete.")
        return str(phar)
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        return None


def _run_wordpress_via_wp_cli(
    doc_root: str,
    domain: str,
    admin_user: str,
    admin_pass: str,
    admin_email: str,
    job_id: str = "wizard",
) -> Optional[Dict[str, Any]]:
    """Try WP-CLI core install. Returns result dict on success, None to fall back."""
    php_bin = _find_php_bin()
    wp_bin = _wp_cli_path()
    cmd: List[str]
    phar: Optional[str] = None
    if wp_bin:
        cmd = [wp_bin]
    else:
        phar = _ensure_wp_cli_phar(job_id)
        if not phar:
            return None
        cmd = [php_bin, phar]

    url = f"http://{domain}"
    full_cmd = cmd + [
        "core", "install",
        f"--path={doc_root}",
        f"--url={url}",
        f"--title={domain}",
        f"--admin_user={admin_user}",
        f"--admin_password={admin_pass}",
        f"--admin_email={admin_email}",
        "--skip-email",
        "--allow-root",
    ]
    phar_dir = Path(phar).parent if phar and "copanel-wpcli-" in str(phar) else None
    try:
        res = sysexec.run(full_cmd, timeout=180, cwd=doc_root)
    except Exception:
        return None
    finally:
        if phar_dir and phar_dir.is_dir():
            shutil.rmtree(phar_dir, ignore_errors=True)
    combined = ((res.stdout or "") + "\n" + (res.stderr or "")).lower()
    if res.returncode == 0 or "already installed" in combined or "success" in combined:
        return {
            "db_installed": "already" not in combined,
            "admin_user": admin_user,
            "admin_password": admin_pass,
            "admin_email": admin_email,
            "method": "wp-cli",
        }
    return None


def _run_wordpress_db_install(doc_root: str, domain: str, database: Dict[str, Any]) -> Dict[str, Any]:
    """Bootstrap WordPress tables. Prefers WP-CLI, falls back to seeded PHP CLI script."""
    root = Path(doc_root)
    if not (root / "wp-load.php").is_file():
        raise RuntimeError("WordPress core files are incomplete (missing wp-load.php).")

    working_host = _resolve_wp_db_host(database)
    if working_host != database.get("host", "localhost"):
        database = {**database, "host": working_host}
        _ensure_wp_config(root, database)

    admin_user = "admin"
    admin_pass = _generate_password()
    admin_email = f"admin@{domain}"

    cli_result = _run_wordpress_via_wp_cli(doc_root, domain, admin_user, admin_pass, admin_email, job_id=domain)
    if cli_result and _wordpress_db_installed(database):
        cli_result["db_host"] = working_host
        cli_result["db_installed"] = True
        return cli_result

    # If WP-CLI reported success but tables missing, or WP-CLI unavailable — use PHP script.
    php_bin = _find_php_bin()
    status_file = root / ".copanel-wp-install.status"
    log_file = root / ".copanel-wp-install.log"
    install_script = root / ".copanel-wp-install.php"
    for p in (status_file, log_file):
        try:
            p.unlink(missing_ok=True)
        except Exception:
            pass

    install_script.write_text(
        f"""<?php
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('error_log', {json.dumps(str(log_file))});

$_SERVER['HTTP_HOST'] = {json.dumps(domain)};
$_SERVER['SERVER_NAME'] = {json.dumps(domain)};
$_SERVER['SERVER_PORT'] = '80';
$_SERVER['REQUEST_URI'] = '/';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['SERVER_PROTOCOL'] = 'HTTP/1.1';
$_SERVER['HTTPS'] = 'off';
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['PHP_SELF'] = '/index.php';

define('WP_USE_THEMES', false);
define('WP_SITEURL', {json.dumps(f"http://{domain}")});
define('WP_HOME', {json.dumps(f"http://{domain}")});

function copanel_wp_status($code, $msg = '') {{
    $line = $code . ($msg !== '' ? ' ' . $msg : '');
    @file_put_contents(__DIR__ . '/.copanel-wp-install.status', $line);
    echo $line;
}}

try {{
    require_once __DIR__ . '/wp-load.php';
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    if (file_exists(ABSPATH . 'wp-admin/includes/translation-install.php')) {{
        require_once ABSPATH . 'wp-admin/includes/translation-install.php';
    }}
    global $wpdb;
    if (!isset($wpdb) || !empty($wpdb->error)) {{
        $err = isset($wpdb) && is_wp_error($wpdb->error) ? $wpdb->error->get_error_message() : 'wpdb missing';
        copanel_wp_status('DB_ERROR', $err);
        exit(1);
    }}
    $ping = @$wpdb->query('SELECT 1');
    if ($ping === false) {{
        copanel_wp_status('DB_ERROR', 'SELECT 1 failed: ' . $wpdb->last_error);
        exit(1);
    }}
    if (function_exists('is_blog_installed') && is_blog_installed()) {{
        copanel_wp_status('ALREADY');
        exit(0);
    }}
    $result = wp_install(
        {json.dumps(domain)},
        {json.dumps(admin_user)},
        {json.dumps(admin_email)},
        true,
        '',
        {json.dumps(admin_pass)}
    );
    if (empty($result) || (is_array($result) && empty($result['user_id']))) {{
        copanel_wp_status('FAIL', 'wp_install returned empty');
        exit(1);
    }}
    copanel_wp_status('OK');
    exit(0);
}} catch (Throwable $e) {{
    copanel_wp_status('FAIL', $e->getMessage());
    exit(1);
}}
""",
        encoding="utf-8",
    )
    try:
        res = sysexec.run(
            [
                php_bin,
                "-d", "display_errors=0",
                "-d", "log_errors=1",
                "-d", f"error_log={log_file}",
                str(install_script),
            ],
            timeout=180,
            cwd=str(root),
            env_extra={
                "HTTP_HOST": domain,
                "SERVER_NAME": domain,
            },
        )
        status_text = ""
        if status_file.is_file():
            status_text = status_file.read_text(encoding="utf-8", errors="ignore").strip()
        if not status_text:
            status_text = (res.stdout or "").strip()

        token = status_text.split(None, 1)[0] if status_text else ""
        if token in ("OK", "ALREADY") or _wordpress_db_installed(database):
            return {
                "db_installed": token == "OK" or (token != "ALREADY" and _wordpress_db_installed(database)),
                "admin_user": admin_user,
                "admin_password": admin_pass,
                "admin_email": admin_email,
                "db_host": working_host,
                "method": "php-cli",
            }

        log_tail = ""
        if log_file.is_file():
            try:
                log_tail = log_file.read_text(encoding="utf-8", errors="ignore")[-800:]
            except Exception:
                pass
        combined = " | ".join(
            x for x in (
                status_text,
                f"exit={res.returncode}",
                (res.stderr or "").strip(),
                (res.stdout or "").strip(),
                log_tail.strip(),
                f"php={php_bin}",
            ) if x
        ) or "unknown error"
        if "Error establishing a database connection" in combined or token == "DB_ERROR":
            raise RuntimeError(
                f"WordPress cannot connect to MySQL as {database['user']}@{working_host}. {combined[:400]}"
            )
        detail = combined.strip()
        if len(detail) > 600:
            detail = detail[:600] + "..."
        raise RuntimeError(f"WordPress database install failed: {detail}")
    finally:
        for p in (install_script, status_file, log_file):
            try:
                p.unlink(missing_ok=True)
            except Exception:
                pass


def _safe_extract_tar(tar_path: Path, dest: Path) -> None:
    dest_resolved = dest.resolve()
    with tarfile.open(tar_path, "r:gz") as tar:
        for member in tar.getmembers():
            name = member.name.replace("\\", "/")
            if not name or name.startswith("/") or ".." in Path(name).parts:
                raise RuntimeError(f"WordPress archive contains an unsafe path: {member.name}")
            target = (dest_resolved / name).resolve()
            if dest_resolved != target and dest_resolved not in target.parents:
                raise RuntimeError(f"WordPress archive escapes the extract directory: {member.name}")
            if member.issym() or member.islnk():
                link_target = (Path(name).parent / member.linkname)
                if link_target.is_absolute() or ".." in link_target.parts:
                    raise RuntimeError(f"WordPress archive contains an unsafe link: {member.name}")
        kwargs: Dict[str, Any] = {}
        if sys.version_info >= (3, 12):
            kwargs["filter"] = "data"
        tar.extractall(path=dest, **kwargs)


def _copy_wordpress_tree(src: Path, root: Path) -> None:
    if _wordpress_files_present(root):
        return
    markers = ("wp-includes", "wp-admin", "wp-load.php", "index.php", "wp-config.php")
    if any((root / marker).exists() for marker in markers):
        raise RuntimeError(
            "Document root has a partial WordPress tree (missing wp-includes/version.php). "
            "Remove the incomplete files or choose an empty document root. "
            "CoPanel will not mix two WordPress versions."
        )
    for item in src.iterdir():
        dest = root / item.name
        if dest.exists():
            raise RuntimeError(
                f"Refusing to overwrite existing {item.name} while copying WordPress. "
                "The document root is not empty."
            )
        if item.is_dir():
            shutil.copytree(item, dest, symlinks=False)
        else:
            shutil.copy2(item, dest)


def _download_wordpress_core(root: Path, job_id: str = "wizard") -> None:
    if _wordpress_files_present(root):
        return
    tmp = Path(tempfile.mkdtemp(prefix=f"copanel-wp-{job_id}-"))
    try:
        tar_path = tmp / "wordpress.tar.gz"
        _download_https("https://wordpress.org/latest.tar.gz", tar_path, timeout=60, max_bytes=80_000_000)
        digest_text = _download_text("https://wordpress.org/latest.tar.gz.sha1", timeout=30)
        expected = _checksum_token(digest_text)
        actual = hashlib.sha1(tar_path.read_bytes()).hexdigest()
        if not expected or actual != expected:
            raise RuntimeError(
                f"WordPress tarball checksum mismatch (expected {expected or 'missing'}, got {actual})."
            )
        _safe_extract_tar(tar_path, tmp)
        wp_src = tmp / "wordpress"
        if not wp_src.is_dir():
            raise RuntimeError("WordPress archive extraction failed.")
        _copy_wordpress_tree(wp_src, root)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _install_wordpress_core(doc_root: str, domain: str, database: Dict[str, Any]) -> Dict[str, Any]:
    root = Path(doc_root)
    root.mkdir(parents=True, exist_ok=True)
    files_present = _wordpress_files_present(root)
    if not files_present:
        _download_wordpress_core(root, job_id=domain)
        files_present = _wordpress_files_present(root)
        if not files_present:
            raise RuntimeError("WordPress core download failed")

    working_host = _resolve_wp_db_host(database)
    database = {**database, "host": working_host}
    config_created = _ensure_wp_config(root, database)
    admin_url = f"http://{domain}/wp-admin/install.php"
    result: Dict[str, Any] = {
        "status": "success",
        "files_present": files_present,
        "config_created": config_created,
        "admin_url": admin_url,
        "db_host": working_host,
        "warnings": [],
    }

    if _wordpress_db_installed(database):
        result["message"] = "WordPress already installed"
        result["db_installed"] = False
        result["admin_url"] = f"http://{domain}/wp-admin/"
        return result

    try:
        install_info = _run_wordpress_db_install(doc_root, domain, database)
        result.update(install_info)
        result["message"] = "WordPress core installed and database initialized"
        result["admin_url"] = f"http://{domain}/wp-admin/"
        result.pop("warnings", None)
        result["warnings"] = []
        return result
    except Exception as exc:
        # Soft-fail: files + wp-config + empty DB are still usable via browser installer.
        warning = str(exc)
        result["warnings"] = [warning]
        result["db_installed"] = False
        result["status"] = "partial"
        result["message"] = (
            "WordPress files deployed; database schema install incomplete — "
            f"finish at {admin_url}"
        )
        result["admin_url"] = admin_url
        result["install_error"] = warning
        return result


def _install_laravel_skeleton(doc_root: str, domain: str) -> Dict[str, Any]:
    public = Path(doc_root)
    if public.name != "public":
        public = public / "public"
    public.mkdir(parents=True, exist_ok=True)
    index = public / "index.php"
    if index.is_file():
        return {"status": "success", "message": "Laravel public/ already exists", "skipped": True}
    index.write_text(
        f"""<?php
// CoPanel Site Wizard — deploy your Laravel app into {doc_root}
// Run: composer create-project laravel/laravel . && point nginx root to public/
http_response_code(200);
header('Content-Type: text/html; charset=utf-8');
echo '<h1>Laravel ready on {domain}</h1><p>Upload or clone your Laravel project, then set document root to <code>public/</code>.</p>';
""",
        encoding="utf-8",
    )
    return {"status": "success", "message": "Laravel public/ skeleton created"}


def _deploy_template_app(
    template_id: str,
    doc_root: str,
    domain: str,
    database: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    tid = template_id or "static"
    if tid == "static":
        _write_static_placeholder(doc_root, domain)
        return {"template": tid, "deployed": "static_placeholder"}
    if tid == "wordpress":
        if not database:
            raise RuntimeError("WordPress requires a database")
        wp = _install_wordpress_core(doc_root, domain, database)
        return {"template": tid, "deployed": "wordpress_core", **wp}
    if tid == "laravel":
        sk = _install_laravel_skeleton(doc_root, domain)
        return {"template": tid, "deployed": "laravel_skeleton", **sk}
    if tid == "node_proxy":
        readme = Path(doc_root) / "README-COPANEL.txt"
        if not readme.is_file():
            readme.write_text(
                f"Reverse proxy site for {domain}.\nStart your app on the configured proxy port, then reload Nginx.\n",
                encoding="utf-8",
            )
        return {"template": tid, "deployed": "proxy_readme"}
    return {"template": tid, "deployed": "none"}


def _site_kind(template_id: str, proxy_port: Optional[int], php_version: Optional[str]) -> str:
    if proxy_port:
        return "proxy"
    if php_version or template_id in ("wordpress", "laravel"):
        return "php"
    return "static"


def _vhost_matches(content: str, doc_root: str, kind: str) -> bool:
    if kind == "proxy":
        return "proxy_pass" in content and "fastcgi_pass" not in content
    roots = re.findall(r"^\s*root\s+([^;]+);", content, re.M)
    root = roots[0].strip().strip("'\"") if roots else ""
    if root.rstrip("/") != str(doc_root).rstrip("/"):
        return False
    has_php = "fastcgi_pass" in content
    has_proxy = "proxy_pass" in content
    if kind == "php":
        return has_php and not has_proxy
    return not has_php and not has_proxy


def _protected_web_parent(path: str) -> bool:
    resolved = Path(path).resolve()
    return resolved in {Path("/"), Path("/var/www"), Path("/home"), Path("/var")}


class _Rollback:
    def __init__(self) -> None:
        self._steps: List[tuple[str, Callable[[], None]]] = []

    def add(self, label: str, fn: Callable[[], None]) -> None:
        self._steps.append((label, fn))

    def run(self, job) -> List[str]:
        done: List[str] = []
        for label, fn in reversed(self._steps):
            try:
                fn()
                done.append(label)
                job.log(f"Rolled back: {label}")
            except Exception as exc:
                job.log(f"Rollback failed for {label}: {exc}")
        return done


def _apply_site_ownership(doc_root: str, php_version: str) -> str:
    """chown only this site's document root to the PHP-FPM pool user."""
    import grp
    import pwd

    from modules.web_manager.logic import php_fpm_identity

    if _protected_web_parent(doc_root):
        raise RuntimeError(f"Refusing to change ownership of {doc_root}")
    user, group = php_fpm_identity(php_version)
    try:
        uid = pwd.getpwnam(user).pw_uid
        gid = grp.getgrnam(group).gr_gid
    except KeyError as exc:
        raise RuntimeError(
            f"PHP-FPM user '{user}' (group '{group}') does not exist, so site files would stay owned by root."
        ) from exc
    root = Path(doc_root).resolve()
    for dirpath, dirnames, filenames in os.walk(root):
        os.chown(dirpath, uid, gid)
        os.chmod(dirpath, 0o755)
        for name in filenames:
            path = Path(dirpath) / name
            try:
                os.chown(path, uid, gid)
                os.chmod(path, 0o640 if name == "wp-config.php" else 0o644)
            except OSError:
                continue
    return user


def _run_wizard_sync(job, req: WizardRequest) -> Dict[str, Any]:
    """Drive the multi-step wizard. Blocking work stays in this function."""
    from fastapi import HTTPException

    from modules.database_manager.logic import DBManager
    from modules.ssl_manager.logic import SSLManager
    from modules.web_manager import logic as wm_logic
    from modules.web_manager import router as web_router

    defaults = resolve_wizard_defaults(
        req.template_id,
        domain=req.domain,
        document_root=req.document_root,
        php_version=req.php_version,
        php_modules=req.php_modules,
        proxy_port=req.proxy_port,
        create_database=req.create_database,
        issue_ssl=req.issue_ssl,
        ssl_email=req.ssl_email,
    )
    template_id = defaults["template_id"]
    req.document_root = defaults["document_root"]
    req.php_version = defaults["php_version"]
    req.php_modules = defaults["php_modules"] or []
    req.proxy_port = defaults["proxy_port"]
    req.create_database = defaults["create_database"]
    req.issue_ssl = defaults["issue_ssl"]
    req.ssl_email = defaults["ssl_email"]

    domain = _validate_domain(req.domain)
    doc_root = _validate_doc_root(req.document_root)
    rollback = _Rollback()
    try:
        return _provision(job, req, template_id, domain, doc_root, rollback, DBManager, SSLManager, wm_logic, web_router, HTTPException)
    except Exception as exc:
        undone = rollback.run(job)
        message = str(exc)
        if undone:
            message = f"{message} Rolled back: {', '.join(undone)}."
        raise RuntimeError(message) from exc


def _provision(job, req, template_id, domain, doc_root, rollback, DBManager, SSLManager, wm_logic, web_router, HTTPException) -> Dict[str, Any]:
    job.update(progress=2, message=f"Provisioning {domain} ({template_id})")
    job.log(f"Validated inputs for {domain} [template={template_id}]")
    result = WizardResult(domain=domain, document_root=doc_root, site_filename=f"{domain}.conf")

    job.update(progress=8, message="Checking web stack")
    resolved_php = _ensure_stack(job, template_id, req.php_version, req.php_modules)
    if resolved_php:
        req.php_version = resolved_php
        job.log(f"PHP {resolved_php}")
    else:
        job.log("Stack check complete")

    job.update(progress=12, message="Creating document root")
    root_existed = os.path.isdir(doc_root)
    try:
        os.makedirs(doc_root, exist_ok=True)
    except Exception as exc:
        raise RuntimeError(f"Failed to create document root: {exc}") from exc
    if not root_existed:
        rollback.add("document root", lambda: _remove_created_root(doc_root))
    job.log(f"Document root ready: {doc_root}")

    kind = _site_kind(template_id, req.proxy_port, req.php_version)
    existing = SSLManager.find_nginx_vhost_path(domain)
    created_vhost = False
    if existing and existing.is_file():
        content = existing.read_text(encoding="utf-8", errors="ignore")
        if not _vhost_matches(content, doc_root, kind):
            raise RuntimeError(
                f"vhost {domain} already exists with a different document root or site type. "
                "Remove it in Web Manager or choose another domain."
            )
        job.log(f"Reusing nginx vhost {existing.name}")
        result.warnings.append(f"Reused existing nginx vhost {existing.name}")
    else:
        job.update(progress=28, message="Creating Nginx vhost")
        create_payload = web_router.CreateSiteRequest(
            domain=domain,
            root=doc_root,
            php_version=req.php_version,
            php_modules=req.php_modules,
            proxy_port=req.proxy_port,
        )
        try:
            res = web_router.create_site(create_payload)
        except HTTPException as exc:
            raise RuntimeError(f"Web vhost creation failed: {exc.detail}") from exc
        if not isinstance(res, dict) or res.get("status") != "success":
            raise RuntimeError(f"Web vhost creation failed: {res}")
        created_vhost = True
        rollback.add("nginx vhost", lambda: _rollback_vhost(domain))
        job.log("Nginx vhost created and activated")

    needs_php = bool(req.php_version) or template_id in ("wordpress", "laravel")
    if needs_php:
        _ensure_vhost_php_fpm(domain, req.php_version, job, result)

    needs_db = bool(req.create_database) or template_id in ("wordpress", "laravel")
    if needs_db:
        job.update(progress=48, message="Provisioning database")
        try:
            db_name, db_user = derive_db_identifiers(domain, req.database_name, req.database_user)
        except ValueError as exc:
            raise RuntimeError(str(exc)) from exc
        db_existed = DBManager.database_exists(db_name)
        if not db_existed:
            db_res = DBManager.create_database(db_name)
            if db_res.get("status") != "success":
                raise RuntimeError(db_res.get("message") or f"Database create failed for {db_name}")
            rollback.add("database", lambda: DBManager.delete_database(db_name))
            job.log(f"Database created: {db_name}")
        else:
            job.log(f"Database {db_name} already exists; leaving it in place")
        db_pass = req.database_password or _generate_password()
        usr_res = DBManager.ensure_site_user(db_user, "localhost", db_pass, db_name)
        if usr_res.get("status") != "success":
            raise RuntimeError(usr_res.get("message") or f"Database user create failed for {db_user}")
        if usr_res.get("created"):
            rollback.add(
                "database user",
                lambda: (DBManager.delete_user(db_user, "localhost"), DBManager.delete_user(db_user, "127.0.0.1")),
            )
            result.database = {"name": db_name, "user": db_user, "password": db_pass, "host": "localhost"}
            job.log(f"Database user created: {db_user}")
        else:
            job.log(usr_res.get("message") or f"Database user {db_user} kept")
            if req.database_password:
                result.database = {
                    "name": db_name,
                    "user": db_user,
                    "password": req.database_password,
                    "host": "localhost",
                    "password_unchanged": True,
                }
            elif _wordpress_files_present(Path(doc_root)) and (Path(doc_root) / "wp-config.php").is_file():
                result.database = {
                    "name": db_name,
                    "user": db_user,
                    "password": None,
                    "host": "localhost",
                    "password_unchanged": True,
                }
            else:
                raise RuntimeError(
                    f"Database user '{db_user}' already exists and its password was not changed. "
                    "Enter the existing database password and run the wizard again."
                )

    job.update(progress=58, message="Deploying application")
    deploy_info = _deploy_template_app(template_id, doc_root, domain, result.database if result.database and result.database.get("password") else result.database)
    if deploy_info.get("status") == "partial":
        detail = deploy_info.get("install_error") or deploy_info.get("message") or "application install failed"
        raise RuntimeError(f"Deploy failed: {detail}")
    safe_log = dict(deploy_info)
    if safe_log.get("admin_password"):
        safe_log["admin_password"] = "***"
    job.log(json.dumps(safe_log))
    for warn in (deploy_info.get("warnings") or []):
        if warn and warn not in result.warnings:
            result.warnings.append(warn)

    if needs_php or template_id == "static":
        try:
            owner = _apply_site_ownership(doc_root, req.php_version or "")
            job.log(f"Document root owned by {owner}")
        except RuntimeError as exc:
            result.warnings.append(str(exc))
            job.log(str(exc))

    if req.issue_ssl:
        job.update(progress=75, message="Checking DNS for SSL")
        if not req.ssl_email:
            raise RuntimeError("SSL email is required when issue_ssl is true.")
        dns = dns_points_here(domain)
        if not dns.get("dns_ok"):
            warning = (
                "DNS does not point at this server, so SSL was not requested from Let's Encrypt."
            )
            result.warnings.append(warning)
            result.ssl = {
                "type": "letsencrypt",
                "domain": domain,
                "email": req.ssl_email,
                "status": "skipped",
                "error": warning,
            }
            job.log(warning)
        else:
            ssl_res = SSLManager.issue_certbot(domain, req.ssl_email)
            if ssl_res.get("status") != "success":
                warning = ssl_res.get("message") or "SSL issuance failed"
                result.warnings.append(warning)
                result.ssl = {
                    "type": "letsencrypt",
                    "domain": domain,
                    "email": req.ssl_email,
                    "status": "failed",
                    "error": warning,
                }
                job.log(f"SSL warning: {warning}")
            else:
                result.ssl = {"type": "letsencrypt", "domain": domain, "email": req.ssl_email, "status": "active"}
                job.log("SSL certificate issued and applied")
                if template_id == "wordpress" and result.database and result.database.get("password"):
                    if _update_wordpress_site_urls(doc_root, domain, use_https=True):
                        job.log("WordPress siteurl/home updated to https")
                    else:
                        result.warnings.append("Could not update WordPress siteurl/home to https")
                if needs_php:
                    _ensure_vhost_php_fpm(domain, req.php_version, job, result)

    job.update(progress=92, message="Verifying site availability")
    ssl_active = bool(result.ssl and result.ssl.get("status") == "active")
    result.verification = _http_verify(domain, use_https=ssl_active)
    if not result.verification.get("reachable"):
        verify_note = result.verification.get("status_line") or result.verification.get("error") or "site not reachable"
        result.warnings.append(f"Reachability check: {verify_note}")
    job.log(json.dumps(result.verification))

    job.update(progress=100, message="Site provisioned")
    tpl = get_template(template_id) or {}
    if ssl_active:
        ssl_note = ", ssl OK"
    elif result.ssl and result.ssl.get("status") == "skipped":
        ssl_note = ", ssl skipped"
    elif result.ssl:
        ssl_note = ", ssl failed"
    else:
        ssl_note = ""
    result.summary = (
        f"{tpl.get('name', template_id)} on {domain}: nginx OK"
        + (", app deployed" if deploy_info.get("deployed") else "")
        + (", db OK" if result.database else "")
        + ssl_note
    )
    if result.warnings:
        result.summary += f" ({len(result.warnings)} warning(s))"
    if created_vhost:
        result.rollback.append(f"web_manager:{result.site_filename}")
    site_url = f"https://{domain}" if ssl_active else f"http://{domain}"
    if isinstance(deploy_info, dict) and template_id == "wordpress":
        deploy_info["admin_url"] = f"{site_url}/wp-admin/"
    return {
        "template_id": template_id,
        "php_version": req.php_version or None,
        "domain": result.domain,
        "document_root": result.document_root,
        "site_filename": result.site_filename,
        "database": result.database,
        "ssl": result.ssl,
        "verification": result.verification,
        "deployment": deploy_info,
        "warnings": result.warnings,
        "summary": result.summary,
        "site_url": site_url,
        "completed_at": time.time(),
    }


def _remove_created_root(doc_root: str) -> None:
    if _protected_web_parent(doc_root):
        raise RuntimeError(f"Refusing to delete {doc_root}")
    shutil.rmtree(doc_root, ignore_errors=False)


def _rollback_vhost(domain: str) -> None:
    from modules.ssl_manager.logic import SSLManager
    from modules.web_manager.logic import get_nginx_paths, nginx_reload_test, remove_nginx_site

    path = SSLManager.find_nginx_vhost_path(domain)
    paths = get_nginx_paths()
    if path:
        remove_nginx_site(paths, path.name)
    try:
        nginx_reload_test()
    except Exception:
        pass


async def run_wizard(job, req: WizardRequest) -> Dict[str, Any]:
    """Provision a site without blocking the API event loop."""
    return await asyncio.to_thread(_run_wizard_sync, job, req)
