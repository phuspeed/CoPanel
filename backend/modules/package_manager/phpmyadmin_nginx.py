"""phpMyAdmin nginx + PHP-FPM setup.

CoPanel serves ``/phpmyadmin/`` from the same plain-HTTP ``:8686`` server as the
panel. Two access modes must keep working:

* direct ``http://HOST:8686/phpmyadmin/``
* Cloudflare Tunnel (or any reverse proxy) that terminates HTTPS and forwards
  to that HTTP origin, with ``X-Forwarded-Proto: https``

A phpMyAdmin-only apt install does not guarantee PHP-FPM. The old nginx
``upstream php_fpm`` listed several unix sockets with ``max_fails=1``. Missing
sockets are marked down, and when none of them exist nginx returns 502
(``no live upstreams``) for every PHP request. The panel SPA and ``/api/``
never use that upstream, so they stay up. Cloudflare prints that origin 502
as "Bad gateway / Host Error".

phpMyAdmin response headers (session cookies) also exceed nginx's default
FastCGI buffer and produce the same 502 (``upstream sent too big header``).
"""
from __future__ import annotations

import glob
import logging
import os
import re
import shutil
import stat
from pathlib import Path
from typing import List, Optional

from core import sysexec
from core.security_entrance import find_nginx_site

logger = logging.getLogger(__name__)

MAP_BEGIN = "# BEGIN COPANEL PHPMYADMIN MAP"
MAP_END = "# END COPANEL PHPMYADMIN MAP"
LOC_BEGIN = "# BEGIN COPANEL PHPMYADMIN"
LOC_END = "# END COPANEL PHPMYADMIN"

FALLBACK_SOCKET = "/run/php/php-fpm.sock"
FALLBACK_DOCROOT = "/usr/share/phpmyadmin"

DOCROOT_CANDIDATES = (
    "/usr/share/phpmyadmin",
    "/usr/share/phpMyAdmin",
    "/var/www/html/phpmyadmin",
    "/var/www/html/phpMyAdmin",
)

# PHP-FPM and the extensions phpMyAdmin needs. php-fpm is a Recommends of the
# Debian phpmyadmin package, not a Depends, and apt usually satisfies the
# web-server Recommends with apache2 + libapache2-mod-php instead.
APT_FPM_PACKAGES = [
    "php-fpm",
    "php-cli",
    "php-mysql",
    "php-mbstring",
    "php-xml",
    "php-zip",
    "php-gd",
    "php-curl",
]
APT_PACKAGES = APT_FPM_PACKAGES + ["phpmyadmin"]
RPM_FPM_PACKAGES = [
    "php-fpm",
    "php-cli",
    "php-mysqlnd",
    "php-mbstring",
    "php-xml",
    "php-gd",
    "php-zip",
]
RPM_PMA_NAMES = ("phpMyAdmin", "phpmyadmin")

_PLACEHOLDER = re.compile(r"^__[A-Z0-9_]+__$")
_ABS_PATH = re.compile(r"^/[A-Za-z0-9._/-]+$")
_MAP_BEGIN_RE = re.compile(r"(?m)^[ \t]*# BEGIN COPANEL PHPMYADMIN MAP[ \t]*$")
_MAP_END_RE = re.compile(r"(?m)^[ \t]*# END COPANEL PHPMYADMIN MAP[ \t]*$")
_LOC_BEGIN_RE = re.compile(r"(?m)^[ \t]*# BEGIN COPANEL PHPMYADMIN[ \t]*$")
_LOC_END_RE = re.compile(r"(?m)^[ \t]*# END COPANEL PHPMYADMIN[ \t]*$")
_PMA_LOCATION_RE = re.compile(
    r"(?m)^[ \t]*location\s+(?:=\s*|~\*?\s+|\^~\s+)?/phpmyadmin/?\s*\{"
)
_UPSTREAM_RE = re.compile(r"(?m)^upstream\s+php_fpm\s*\{")
_SOCKET_VERSION_RE = re.compile(r"php(\d+)\.(\d+)-fpm")
_UNIT_VERSION_RE = re.compile(r"php(\d+)\.(\d+)-fpm$")


def _validate_path(value: str, *, what: str) -> str:
    text = (value or "").strip()
    if _PLACEHOLDER.fullmatch(text):
        return text
    if not _ABS_PATH.fullmatch(text) or any(part == ".." for part in text.split("/")):
        raise ValueError(f"invalid phpMyAdmin {what}: {value!r}")
    return text.rstrip("/") if what == "docroot" else text


def validate_socket(value: str) -> str:
    return _validate_path(value, what="socket")


def validate_docroot(value: str) -> str:
    return _validate_path(value, what="docroot")


def render_map() -> str:
    """http-context maps. Direct :8686 keeps ``$scheme`` (http)."""
    return """\
# BEGIN COPANEL PHPMYADMIN MAP
# Direct http://HOST:8686 clients send no X-Forwarded-Proto, so phpMyAdmin
# stays on the origin scheme. Cloudflare Tunnel (and other reverse proxies)
# set X-Forwarded-Proto or CF-Visitor to https. The public port is then 443
# unless the proxy sends a numeric X-Forwarded-Port.
map "$http_x_forwarded_proto#$http_cf_visitor" $copanel_pma_scheme {
    default $scheme;
    "~*^https" https;
    "~*^http#" http;
    "~*scheme.:.https" https;
}
map $copanel_pma_scheme $copanel_pma_https {
    https   on;
    default "";
}
map $http_x_forwarded_port $copanel_pma_xf_port {
    default "";
    "~^[0-9]{1,5}$" $http_x_forwarded_port;
}
map $copanel_pma_scheme $copanel_pma_scheme_port {
    https   443;
    default $server_port;
}
map $copanel_pma_xf_port $copanel_pma_server_port {
    ""      $copanel_pma_scheme_port;
    default $copanel_pma_xf_port;
}
# END COPANEL PHPMYADMIN MAP
"""


def render_location(socket: str, docroot: str) -> str:
    """Server-context ``/phpmyadmin`` locations.

    ``alias`` plus an absolute ``SCRIPT_FILENAME`` matches both
    ``/usr/share/phpmyadmin`` and ``/usr/share/phpMyAdmin``. One FastCGI peer
    avoids ``max_fails`` taking the whole upstream down. Header buffers are
    sized for phpMyAdmin's session cookies. The trailing-slash redirect is a
    relative ``Location`` so the browser keeps the tunnel's https host or the
    direct ``:8686`` host.
    """
    sock = validate_socket(socket)
    root = validate_docroot(docroot)
    # Named capture: a map regex (X-Forwarded-Proto / CF-Visitor) clears $1.
    # Tunnel requests hit that map; direct :8686 requests usually do not.
    # $pma_script is not clobbered, so SCRIPT_FILENAME stays the real file.
    return f"""\
    # BEGIN COPANEL PHPMYADMIN
    location = /phpmyadmin {{
        absolute_redirect off;
        return 301 /phpmyadmin/;
    }}

    location ^~ /phpmyadmin/ {{
        alias {root}/;
        index index.php;
        absolute_redirect off;

        location ~ /\\. {{
            deny all;
        }}

        location ~ ^/phpmyadmin/(libraries|templates|setup|vendor|locale)/ {{
            deny all;
        }}

        location = /phpmyadmin/config.inc.php {{
            deny all;
        }}

        location ~ ^/phpmyadmin/(?<pma_script>.+\\.php)$ {{
            fastcgi_pass unix:{sock};
            fastcgi_index index.php;
            fastcgi_hide_header X-Powered-By;
            fastcgi_buffers 16 16k;
            fastcgi_buffer_size 32k;
            fastcgi_busy_buffers_size 64k;
            fastcgi_read_timeout 300s;
            fastcgi_param QUERY_STRING $query_string;
            fastcgi_param REQUEST_METHOD $request_method;
            fastcgi_param CONTENT_TYPE $content_type;
            fastcgi_param CONTENT_LENGTH $content_length;
            fastcgi_param SCRIPT_NAME $fastcgi_script_name;
            fastcgi_param REQUEST_URI $request_uri;
            fastcgi_param DOCUMENT_URI $document_uri;
            fastcgi_param DOCUMENT_ROOT {root};
            fastcgi_param SERVER_PROTOCOL $server_protocol;
            fastcgi_param REQUEST_SCHEME $copanel_pma_scheme;
            fastcgi_param HTTPS $copanel_pma_https if_not_empty;
            fastcgi_param GATEWAY_INTERFACE CGI/1.1;
            fastcgi_param SERVER_SOFTWARE nginx/$nginx_version;
            fastcgi_param REMOTE_ADDR $remote_addr;
            fastcgi_param REMOTE_PORT $remote_port;
            fastcgi_param SERVER_ADDR $server_addr;
            fastcgi_param SERVER_PORT $copanel_pma_server_port;
            fastcgi_param SERVER_NAME $host;
            fastcgi_param REDIRECT_STATUS 200;
            fastcgi_param SCRIPT_FILENAME {root}/$pma_script;
            fastcgi_param HTTP_HOST $http_host;
            fastcgi_param HTTP_SCHEME $copanel_pma_scheme;
            fastcgi_param HTTP_X_FORWARDED_PROTO $http_x_forwarded_proto;
            fastcgi_param HTTP_X_FORWARDED_FOR $proxy_add_x_forwarded_for;
        }}
    }}
    # END COPANEL PHPMYADMIN
"""


def _block_end(content: str, open_brace: int) -> int:
    depth = 0
    for index in range(open_brace, len(content)):
        char = content[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
    raise ValueError("unbalanced braces in nginx config")


def _line_start(content: str, index: int) -> int:
    start = content.rfind("\n", 0, index)
    return 0 if start < 0 else start + 1


def _consume_trailing_newline(content: str, index: int) -> int:
    if index < len(content) and content[index] == "\n":
        return index + 1
    return index


def _replace_span(content: str, start: int, end: int, replacement: str) -> str:
    if replacement and not replacement.endswith("\n"):
        replacement += "\n"
    return content[:start] + replacement + content[end:]


def _marked_span(content: str, begin_re: re.Pattern[str], end_re: re.Pattern[str]) -> Optional[tuple]:
    begin = begin_re.search(content)
    if not begin:
        return None
    end = end_re.search(content, begin.end())
    if not end:
        raise ValueError(f"nginx config has {begin.group(0).strip()} without a closing marker")
    return _line_start(content, begin.start()), _consume_trailing_newline(content, end.end())


def _strip_upstream_php_fpm(content: str) -> str:
    while True:
        match = _UPSTREAM_RE.search(content)
        if not match:
            return content
        open_brace = content.find("{", match.start())
        end = _block_end(content, open_brace)
        start = _line_start(content, match.start())
        end = _consume_trailing_newline(content, end + 1)
        if end < len(content) and content[end] == "\n":
            end += 1
        content = content[:start] + content[end:]


def _outer_pma_location_span(content: str) -> Optional[tuple]:
    """First ``location /phpmyadmin`` block, including nested locations."""
    match = _PMA_LOCATION_RE.search(content)
    if not match:
        return None
    open_brace = content.find("{", match.start())
    end = _consume_trailing_newline(content, _block_end(content, open_brace) + 1)
    return _line_start(content, match.start()), end


def rewrite_nginx_text(content: str, socket: str, docroot: str) -> str:
    """Return ``content`` with a single live phpMyAdmin FastCGI target.

    ``location /``, ``/api/``, and ``/health`` are left as they are, including
    an HTTP basic-auth gate nested in ``location /``.
    """
    updated = _strip_upstream_php_fpm(content)
    map_block = render_map()
    map_span = _marked_span(updated, _MAP_BEGIN_RE, _MAP_END_RE)
    if map_span:
        updated = _replace_span(updated, map_span[0], map_span[1], map_block)
    else:
        anchor = re.search(r"(?m)^(upstream\s+\S+\s*\{|server\s*\{)", updated)
        if not anchor:
            raise ValueError("nginx config has no server block for the phpMyAdmin map")
        insert_at = _line_start(updated, anchor.start())
        prefix = "" if insert_at == 0 or updated[:insert_at].endswith("\n") else "\n"
        updated = updated[:insert_at] + prefix + map_block + "\n" + updated[insert_at:]

    location_block = render_location(socket, docroot)
    # Map marker text contains "PHPMYADMIN" but not the location begin line.
    loc_span = _marked_span(updated, _LOC_BEGIN_RE, _LOC_END_RE)
    if loc_span:
        updated = _replace_span(updated, loc_span[0], loc_span[1], location_block)
    else:
        old = _outer_pma_location_span(updated)
        if old:
            updated = _replace_span(updated, old[0], old[1], location_block)
        else:
            anchor = re.search(r"(?m)^[ \t]*location\s+/api/\s*\{", updated)
            if not anchor:
                anchor = re.search(r"(?m)^[ \t]*location\s+/health\s*\{", updated)
            if not anchor:
                raise ValueError("nginx config has nowhere to insert /phpmyadmin")
            insert_at = _line_start(updated, anchor.start())
            updated = updated[:insert_at] + location_block + "\n" + updated[insert_at:]
    return updated


def find_docroot() -> Optional[str]:
    for candidate in DOCROOT_CANDIDATES:
        if os.path.isfile(os.path.join(candidate, "index.php")):
            return candidate
    return None


def _socket_rank(path: str) -> tuple:
    match = _SOCKET_VERSION_RE.search(path)
    if match:
        return (int(match.group(1)), int(match.group(2)))
    return (0, 0)


def list_live_sockets() -> List[str]:
    found = []
    patterns = (
        "/run/php/php*-fpm.sock",
        "/var/run/php/php*-fpm.sock",
        "/run/php-fpm/www.sock",
        "/var/run/php-fpm/www.sock",
    )
    seen = set()
    for pattern in patterns:
        for path in glob.glob(pattern):
            if path in seen:
                continue
            seen.add(path)
            try:
                mode = os.stat(path).st_mode
            except OSError:
                continue
            if stat.S_ISSOCK(mode):
                found.append(path)
    return sorted(found, key=_socket_rank, reverse=True)


def php_fpm_units() -> List[str]:
    names = set()
    for pattern in (
        "/lib/systemd/system/php*-fpm.service",
        "/usr/lib/systemd/system/php*-fpm.service",
        "/etc/systemd/system/php*-fpm.service",
    ):
        for path in glob.glob(pattern):
            name = Path(path).name
            if name.endswith(".service"):
                name = name[: -len(".service")]
            if name == "php-fpm" or _UNIT_VERSION_RE.fullmatch(name):
                names.add(name)

    def rank(name: str) -> tuple:
        match = _UNIT_VERSION_RE.fullmatch(name)
        if match:
            return (int(match.group(1)), int(match.group(2)))
        return (0, 0)

    ordered = sorted(names, key=rank, reverse=True)
    if not ordered and (
        shutil.which("dnf") or shutil.which("yum") or os.path.isfile("/etc/redhat-release")
    ):
        return ["php-fpm"]
    return ordered


def ensure_php_fpm_running() -> str:
    """Return a live PHP-FPM socket, starting the unit if the package is installed."""
    live = list_live_sockets()
    if live:
        return live[0]
    if os.name == "nt":
        raise RuntimeError("PHP-FPM sockets are not available on Windows.")
    units = php_fpm_units()
    if not units:
        sysexec.run(["systemctl", "daemon-reload"], timeout=30, as_root=True)
        units = php_fpm_units()
    errors = []
    for unit in units:
        try:
            sysexec.service_enable_now(unit)
        except sysexec.CommandError as exc:
            errors.append(str(exc))
            continue
        live = list_live_sockets()
        if live:
            return live[0]
    detail = " ".join(errors[:2]).strip()
    raise RuntimeError(
        "PHP-FPM did not create a socket. phpMyAdmin cannot be served until "
        "php-fpm is running (Debian/Ubuntu: phpX.Y-fpm, Alma/RHEL: php-fpm)."
        + (f" {detail}" if detail else "")
    )


def _preseed_phpmyadmin_webserver() -> None:
    """Do not let the phpMyAdmin package enable Apache on port 80."""
    if not shutil.which("debconf-set-selections") and not os.path.isfile("/usr/bin/debconf-set-selections"):
        return
    try:
        sysexec.run(
            ["debconf-set-selections"],
            timeout=30,
            as_root=True,
            input="phpmyadmin phpmyadmin/reconfigure-webserver multiselect\n",
        )
    except sysexec.CommandError as exc:
        logger.info("phpMyAdmin debconf preseed skipped: %s", exc)


def _apt_install(packages: List[str]) -> None:
    env = {"DEBIAN_FRONTEND": "noninteractive", "NEEDRESTART_MODE": "a"}
    sysexec.run(["apt-get", "update"], timeout=300, as_root=True, env_extra=env)
    cmd = [
        "apt-get",
        "-o",
        "DPkg::Lock::Timeout=300",
        "-o",
        "Dpkg::Options::=--force-confdef",
        "-o",
        "Dpkg::Options::=--force-confold",
        "install",
        "-y",
        "--no-install-recommends",
        *packages,
    ]
    result = sysexec.run(cmd, timeout=900, as_root=True, env_extra=env)
    text = sysexec.combined_output(result, limit=4000)
    if result.returncode != 0 and "dpkg was interrupted" in text.lower():
        sysexec.run(["dpkg", "--configure", "-a"], timeout=300, as_root=True, env_extra=env)
        result = sysexec.run(cmd, timeout=900, as_root=True, env_extra=env)
        text = sysexec.combined_output(result, limit=4000)
    if result.returncode != 0:
        tail = text[-800:]
        raise RuntimeError(f"apt install of phpMyAdmin/PHP-FPM failed. {tail}".strip())


def _rpm_install(packages: List[str], *, pma: bool) -> None:
    tool = "dnf" if shutil.which("dnf") else ("yum" if shutil.which("yum") else "")
    if not tool:
        raise RuntimeError("No supported package manager (apt-get, dnf, or yum).")
    result = sysexec.run([tool, "install", "-y", *packages], timeout=900, as_root=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"{tool} install failed. {sysexec.combined_output(result)}".strip()
        )
    if not pma:
        return
    errors = []
    for name in RPM_PMA_NAMES:
        pma_result = sysexec.run([tool, "install", "-y", name], timeout=900, as_root=True)
        if pma_result.returncode == 0:
            return
        errors.append(sysexec.combined_output(pma_result))
    raise RuntimeError(
        "Could not install phpMyAdmin (tried phpMyAdmin and phpmyadmin). "
        + " ".join(errors)[-800:]
    )


def install_php_fpm_packages() -> None:
    """Install PHP-FPM and the phpMyAdmin extensions. Does not install Apache."""
    if os.name == "nt":
        return
    if shutil.which("apt-get"):
        _apt_install(APT_FPM_PACKAGES)
        return
    if shutil.which("dnf") or shutil.which("yum"):
        _rpm_install(RPM_FPM_PACKAGES, pma=False)
        return
    raise RuntimeError("No supported package manager (apt-get, dnf, or yum).")


def install_phpmyadmin_packages() -> None:
    if os.name == "nt":
        return
    if shutil.which("apt-get"):
        _preseed_phpmyadmin_webserver()
        _apt_install(APT_PACKAGES)
        return
    if shutil.which("dnf") or shutil.which("yum"):
        _rpm_install(RPM_FPM_PACKAGES, pma=True)
        return
    raise RuntimeError("No supported package manager (apt-get, dnf, or yum).")


def _write_text(path: Path, text: str) -> None:
    if sysexec.is_root() or os.access(path, os.W_OK):
        path.write_text(text, encoding="utf-8")
        return
    result = sysexec.run(["tee", str(path)], timeout=30, as_root=True, input=text)
    if result.returncode != 0:
        raise RuntimeError(f"could not write {path}. {sysexec.combined_output(result)}".strip())


def apply_nginx_site(
    socket: str,
    docroot: str,
    site: Optional[Path] = None,
    *,
    reload: bool = True,
) -> dict:
    """Patch the live panel nginx site and reload when the text changes."""
    path = site if site is not None else find_nginx_site()
    if path is None or not path.is_file():
        return {
            "updated": False,
            "reloaded": False,
            "socket": socket,
            "docroot": docroot,
            "message": "nginx site config not found",
        }
    original = path.read_text(encoding="utf-8")
    updated = rewrite_nginx_text(original, socket, docroot)
    if updated == original:
        return {
            "updated": False,
            "reloaded": False,
            "socket": socket,
            "docroot": docroot,
            "path": str(path),
        }
    _write_text(path, updated)
    if not reload or not shutil.which("nginx"):
        return {
            "updated": True,
            "reloaded": False,
            "socket": socket,
            "docroot": docroot,
            "path": str(path),
        }
    test = sysexec.run(["nginx", "-t"], timeout=30, as_root=True)
    if test.returncode != 0:
        _write_text(path, original)
        raise RuntimeError(f"nginx -t failed: {sysexec.combined_output(test)}".strip())
    reloaded = sysexec.run(["systemctl", "reload", "nginx"], timeout=30, as_root=True)
    return {
        "updated": True,
        "reloaded": reloaded.returncode == 0,
        "socket": socket,
        "docroot": docroot,
        "path": str(path),
        "message": "" if reloaded.returncode == 0 else sysexec.combined_output(reloaded),
    }


def install_phpmyadmin() -> dict:
    """Install phpMyAdmin and PHP-FPM, then point nginx at the live socket."""
    if os.name == "nt":
        return {"updated": False, "message": "phpMyAdmin install skipped on Windows."}
    install_phpmyadmin_packages()
    socket = ensure_php_fpm_running()
    docroot = find_docroot() or FALLBACK_DOCROOT
    result = apply_nginx_site(socket, docroot)
    result["socket"] = socket
    result["docroot"] = docroot
    return result


def maybe_repair_phpmyadmin() -> Optional[dict]:
    """Fix an already-installed phpMyAdmin after a panel upgrade.

    Does nothing when phpMyAdmin is not on disk. Installs PHP-FPM only when
    no socket exists, then rewrites the panel nginx site if it still has the
    old upstream. Runs from the startup thread; failures are logged by the caller.
    """
    if os.name == "nt":
        return None
    if os.environ.get("COPANEL_TEST_CONFIG_DIR", "").strip():
        return None
    if os.environ.get("COPANEL_DISABLE_PMA_REPAIR", "").strip().lower() in {"1", "true", "yes"}:
        return None
    docroot = find_docroot()
    if not docroot:
        return None
    site = find_nginx_site()
    if site is None or not site.is_file():
        return None
    socket = ""
    live = list_live_sockets()
    if live:
        socket = live[0]
    else:
        install_php_fpm_packages()
        socket = ensure_php_fpm_running()
    return apply_nginx_site(socket, docroot, site)
