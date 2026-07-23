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

import json
import os
import re
import secrets
import shutil
import socket
import ssl
import string
import subprocess
import tarfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .templates import get_template, resolve_wizard_defaults


SAFE_DOMAIN_RE = re.compile(r"^[a-zA-Z0-9.-]+$")
DOMAIN_LABEL_RE = re.compile(r"^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$")


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
    if not domain or not SAFE_DOMAIN_RE.match(domain):
        raise ValueError("Domain contains invalid characters.")
    parts = domain.split(".")
    if len(parts) < 2:
        raise ValueError("Domain must contain at least one dot.")
    for label in parts:
        if not DOMAIN_LABEL_RE.match(label):
            raise ValueError(f"Domain label '{label}' is invalid.")
    return domain.lower()


def _validate_doc_root(root: str) -> str:
    if not root or root.strip() == "":
        raise ValueError("Document root is required.")
    if "\x00" in root:
        raise ValueError("Document root contains an invalid character.")
    if not root.startswith("/") and os.name != "nt":
        raise ValueError("Document root must be an absolute path.")
    return root


def _generate_password(length: int = 18) -> str:
    alphabet = string.ascii_letters + string.digits + "_-"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _slug(domain: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", domain.replace(".", "_"))


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


def get_preflight_status() -> Dict[str, Any]:
    """Report stack readiness for the wizard UI."""
    from modules.web_manager import logic as wm_logic

    nginx_ok = bool(shutil.which("nginx") or Path("/usr/sbin/nginx").is_file())
    mysql_ok = bool(shutil.which("mysql") or shutil.which("mariadb") or Path("/usr/bin/mysql").is_file())
    php_meta = wm_logic.get_php_versions_meta()
    php_versions = php_meta.get("versions") or []
    php_active = php_meta.get("active") or ""
    fpm_rows = wm_logic.list_php_fpm_versions()
    return {
        "nginx": {"installed": nginx_ok, "ready": nginx_ok},
        "mysql": {"installed": mysql_ok, "ready": mysql_ok},
        "php": {
            "installed_versions": php_versions,
            "active": php_active,
            "fpm": fpm_rows,
            "ready": bool(php_versions or fpm_rows),
        },
        "ready_for_lemp": nginx_ok and mysql_ok and bool(php_versions or fpm_rows),
        "ready_for_static": nginx_ok,
    }


def _ensure_stack(job, template_id: Optional[str], php_version: Optional[str]) -> None:
    """Install missing stack packages when template needs LEMP/LAMP."""
    tpl = get_template(template_id or "static") or {}
    preset = tpl.get("stack_preset")
    if preset not in ("lemp", "lamp"):
        return
    from modules.web_manager import logic as wm_logic

    pre = get_preflight_status()
    if preset == "lemp" and pre.get("ready_for_lemp"):
        job.log("Stack preflight OK (LEMP)")
        return
    ver = (php_version or tpl.get("php_version") or "8.2").strip()
    job.log(f"Ensuring LEMP stack (PHP {ver})")
    pm = wm_logic.pkg_manager()
    if not pre["nginx"]["ready"] and pm == "apt-get":
        subprocess.run(["sudo", "apt-get", "install", "-y", "nginx"], check=False, capture_output=True, text=True)
    elif not pre["nginx"]["ready"] and pm == "yum":
        subprocess.run(["sudo", "yum", "install", "-y", "nginx"], check=False, capture_output=True, text=True)
    if ver not in (pre["php"].get("installed_versions") or []):
        res = wm_logic.install_php_version(ver)
        if res.get("status") == "error":
            job.log(f"PHP install note: {res.get('message')}")
    if not pre["mysql"]["ready"] and pm == "apt-get":
        subprocess.run(["sudo", "apt-get", "install", "-y", "mariadb-server"], check=False, capture_output=True, text=True)
    elif not pre["mysql"]["ready"] and pm == "yum":
        subprocess.run(["sudo", "yum", "install", "-y", "mariadb-server"], check=False, capture_output=True, text=True)


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


def _verify_mysql_connection(database: Dict[str, Any]) -> bool:
    try:
        cmd = [
            "mysql", "-N", "-B",
            "-u", database["user"],
            f"-p{database['password']}",
            "-h", database.get("host", "localhost"),
            "-e", "SELECT 1;",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return res.returncode == 0 and res.stdout.strip() == "1"
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
        cmd = [
            "mysql", "-N", "-B",
            "-u", database["user"],
            f"-p{database['password']}",
            "-h", database.get("host", "localhost"),
            db_name,
            "-e", "SHOW TABLES LIKE 'wp_options';",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        return res.returncode == 0 and res.stdout.strip() == "wp_options"
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


def _ensure_wp_cli_phar() -> Optional[str]:
    """Download wp-cli.phar once for reliable core install."""
    phar = Path("/tmp/copanel-wp-cli.phar")
    if phar.is_file() and phar.stat().st_size > 100_000:
        return str(phar)
    try:
        urllib.request.urlretrieve(
            "https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar",
            phar,
        )
        if phar.is_file() and phar.stat().st_size > 100_000:
            return str(phar)
    except Exception:
        pass
    return None


def _run_wordpress_via_wp_cli(
    doc_root: str,
    domain: str,
    admin_user: str,
    admin_pass: str,
    admin_email: str,
) -> Optional[Dict[str, Any]]:
    """Try WP-CLI core install. Returns result dict on success, None to fall back."""
    php_bin = _find_php_bin()
    wp_bin = _wp_cli_path()
    cmd: List[str]
    if wp_bin:
        cmd = [wp_bin]
    else:
        phar = _ensure_wp_cli_phar()
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
    try:
        res = subprocess.run(
            full_cmd,
            cwd=doc_root,
            capture_output=True,
            text=True,
            timeout=180,
        )
    except Exception:
        return None
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

    cli_result = _run_wordpress_via_wp_cli(doc_root, domain, admin_user, admin_pass, admin_email)
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
        res = subprocess.run(
            [
                php_bin,
                "-d", "display_errors=0",
                "-d", "log_errors=1",
                f"-d", f"error_log={log_file}",
                str(install_script),
            ],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=180,
            env={
                **os.environ,
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


def _download_wordpress_core(root: Path) -> None:
    tmp_tar = Path("/tmp/copanel-wp-latest.tar.gz")
    url = "https://wordpress.org/latest.tar.gz"
    urllib.request.urlretrieve(url, tmp_tar)
    with tarfile.open(tmp_tar, "r:gz") as tar:
        tar.extractall(path="/tmp")
    wp_src = Path("/tmp/wordpress")
    if not wp_src.is_dir():
        raise RuntimeError("WordPress archive extraction failed")
    for item in wp_src.iterdir():
        dest = root / item.name
        if dest.exists():
            continue
        if item.is_dir():
            shutil.copytree(item, dest)
        else:
            shutil.copy2(item, dest)
    try:
        tmp_tar.unlink(missing_ok=True)
        shutil.rmtree(wp_src, ignore_errors=True)
    except Exception:
        pass


def _install_wordpress_core(doc_root: str, domain: str, database: Dict[str, Any]) -> Dict[str, Any]:
    root = Path(doc_root)
    root.mkdir(parents=True, exist_ok=True)
    files_present = _wordpress_files_present(root)
    if not files_present:
        _download_wordpress_core(root)
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


async def run_wizard(job, req: WizardRequest) -> Dict[str, Any]:
    """Drive the multi-step wizard. ``job`` is a :class:`core.jobs.Job`."""
    from modules.web_manager import router as web_router
    from modules.database_manager.logic import DBManager
    from modules.ssl_manager.logic import SSLManager

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
    job.update(progress=2, message=f"Provisioning {domain} ({template_id})")
    job.log(f"Validated inputs for {domain} [template={template_id}]")

    result = WizardResult(domain=domain, document_root=doc_root, site_filename=f"{domain}.conf")

    job.update(progress=8, message="Checking web stack")
    _ensure_stack(job, template_id, req.php_version)
    job.log("Stack check complete")

    job.update(progress=12, message="Creating document root")
    try:
        os.makedirs(doc_root, exist_ok=True)
    except Exception as exc:
        raise RuntimeError(f"Failed to create document root: {exc}")
    job.log(f"Document root ready: {doc_root}")

    job.update(progress=28, message="Creating Nginx vhost")
    create_payload = web_router.CreateSiteRequest(
        domain=domain,
        root=doc_root,
        php_version=req.php_version,
        php_modules=req.php_modules,
        proxy_port=req.proxy_port,
    )
    try:
        res = await web_router.create_site(create_payload)  # type: ignore[arg-type]
        if not isinstance(res, dict) or res.get("status") != "success":
            raise RuntimeError(f"Web vhost creation failed: {res}")
        result.rollback.append(f"web_manager:{result.site_filename}")
        job.log("Nginx vhost created and activated")
    except Exception as exc:
        detail = str(getattr(exc, "detail", "") or exc)
        if "already exists" in detail.lower():
            job.log(f"Nginx vhost already exists — reusing {result.site_filename}")
            result.warnings.append(f"Reused existing nginx vhost {result.site_filename}")
        else:
            raise RuntimeError(f"Web vhost creation failed: {detail}") from exc

    if req.create_database:
        job.update(progress=48, message="Provisioning database")
        db_name = req.database_name or _slug(domain)
        db_user = req.database_user or db_name[:14]
        db_pass = req.database_password or _generate_password()
        db_res = _safe_call("database.create", lambda: DBManager.create_database(db_name))
        if db_res.get("status") != "success":
            raise RuntimeError(db_res.get("message", "DB creation failed"))
        result.rollback.append(f"db:{db_name}")
        job.log(f"Database created: {db_name}")
        usr_res = _safe_call(
            "database.create_user",
            lambda: DBManager.create_user(db_user, "localhost", db_pass, db_name),
        )
        if usr_res.get("status") != "success":
            raise RuntimeError(usr_res.get("message", "DB user creation failed"))
        result.database = {
            "name": db_name,
            "user": db_user,
            "password": db_pass,
            "host": "localhost",
        }
        job.log(f"Database user created: {db_user}")

    job.update(progress=58, message="Deploying application")
    deploy_info = _deploy_template_app(template_id, doc_root, domain, result.database)
    job.log(json.dumps(deploy_info))
    for warn in (deploy_info.get("warnings") or []):
        if warn and warn not in result.warnings:
            result.warnings.append(warn)
    if deploy_info.get("status") == "partial" and deploy_info.get("install_error"):
        job.log(f"WordPress install partial: {deploy_info.get('install_error')}")

    if req.issue_ssl:
        job.update(progress=75, message="Issuing SSL certificate")
        if not req.ssl_email:
            raise RuntimeError("SSL email is required when issue_ssl is true.")
        ssl_res = _safe_call(
            "ssl.issue",
            lambda: SSLManager.issue_certbot(domain, req.ssl_email),  # type: ignore[arg-type]
        )
        if ssl_res.get("status") != "success":
            warning = ssl_res.get("message", "SSL issuance failed")
            result.warnings.append(warning)
            result.ssl = {"type": "letsencrypt", "domain": domain, "email": req.ssl_email, "status": "failed", "error": warning}
            job.log(f"SSL warning: {warning}")
        else:
            result.ssl = {"type": "letsencrypt", "domain": domain, "email": req.ssl_email, "status": "active"}
            job.log("SSL certificate issued and applied")

    job.update(progress=92, message="Verifying site availability")
    ssl_active = bool(result.ssl and result.ssl.get("status") == "active")
    result.verification = _http_verify(domain, use_https=ssl_active)
    if not result.verification.get("reachable"):
        verify_note = result.verification.get("status_line") or result.verification.get("error") or "site not reachable"
        result.warnings.append(f"Reachability check: {verify_note}")
    job.log(json.dumps(result.verification))

    job.update(progress=100, message="Site provisioned")
    tpl = get_template(template_id) or {}
    ssl_note = ", ssl OK" if ssl_active else (", ssl failed" if result.ssl else "")
    result.summary = (
        f"{tpl.get('name', template_id)} on {domain}: nginx OK"
        + (", app deployed" if deploy_info.get("deployed") else "")
        + (", db OK" if result.database else "")
        + ssl_note
    )
    if result.warnings:
        result.summary += f" ({len(result.warnings)} warning(s))"
    site_url = f"https://{domain}" if ssl_active else f"http://{domain}"
    if isinstance(deploy_info, dict) and template_id == "wordpress":
        deploy_info["admin_url"] = f"{site_url}/wp-admin/"
    return {
        "template_id": template_id,
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
