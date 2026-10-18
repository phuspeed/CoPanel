"""Secret first-access path (security entrance) and panel TLS helpers.

Visiting ``https://<host>:8686/<token>/`` sets an HttpOnly cookie. Nginx
hides the login page until that cookie is present. This module is the
source of truth for the token file, the nginx snippet, and a matching
API check so a request that bypasses nginx still cannot use the panel.

The file is stdlib-only so ``install.sh`` can run it with system Python
before the virtualenv imports FastAPI (``python core/security_entrance.py``).
"""
from __future__ import annotations

import argparse
import hmac
import ipaddress
import json
import logging
import os
import re
import socket
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

COOKIE_NAME = "copanel_entrance"
ENTRANCE_FILENAME = "security_entrance.json"
PANEL_PORT = 8686
SSL_CERT_NAME = "panel.crt"
SSL_KEY_NAME = "panel.key"
CERT_DAYS = 3650  # 10 years

HTTP_START = "# BEGIN COPANEL SECURITY ENTRANCE"
HTTP_END = "# END COPANEL SECURITY ENTRANCE"
SERVER_START = "# BEGIN COPANEL SECURITY ENTRANCE SERVER"
SERVER_END = "# END COPANEL SECURITY ENTRANCE SERVER"

TOKEN_RE = re.compile(r"^[a-f0-9]{32}$")
_DNS_RE = re.compile(r"^[A-Za-z0-9._-]{1,253}$")
_LOOPBACK = {"127.0.0.1", "::1", "localhost"}

NGINX_CANDIDATES = (
    Path("/etc/nginx/sites-available/copanel"),
    Path("/etc/nginx/conf.d/copanel.conf"),
)


@dataclass(frozen=True)
class EntranceState:
    """Persisted entrance. ``enabled`` False keeps the token but does not enforce it."""

    token: str
    enabled: bool

    @property
    def active(self) -> bool:
        return self.enabled and bool(TOKEN_RE.fullmatch(self.token or ""))


def resolve_config_dir() -> Path:
    """Match ``core.paths.config_dir`` without importing the core package."""
    override = os.environ.get("COPANEL_TEST_CONFIG_DIR", "").strip()
    if override:
        path = Path(override)
        path.mkdir(parents=True, exist_ok=True)
        return path
    installed = Path("/opt/copanel")
    if installed.is_dir():
        return installed / "config"
    return Path(__file__).resolve().parent.parent.parent / "config"


def entrance_file(config: Path) -> Path:
    return config / ENTRANCE_FILENAME


def ssl_paths(config: Path) -> Tuple[Path, Path]:
    directory = config / "ssl"
    return directory / SSL_CERT_NAME, directory / SSL_KEY_NAME


def generate_token() -> str:
    """32 hex chars (128 bits). Safe to embed in a URL path and an nginx config."""
    return os.urandom(16).hex()


def _write_private(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, content.encode("utf-8"))
    finally:
        os.close(fd)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _parse_enabled(value: object) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def load_state(config: Path) -> EntranceState:
    """Load the entrance file.

    Missing file → not configured (panel open). A file that cannot be parsed
    while it exists is treated as enabled with no token, which hides the
    panel from non-loopback clients until an admin rotates it over SSH.
    """
    path = entrance_file(config)
    if not path.is_file():
        return EntranceState("", False)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return EntranceState("", True)
    if not isinstance(raw, dict):
        return EntranceState("", True)
    token = str(raw.get("token") or "").strip().lower()
    enabled = _parse_enabled(raw.get("enabled", True))
    if token and not TOKEN_RE.fullmatch(token):
        return EntranceState("", enabled)
    return EntranceState(token, enabled)


def save_state(config: Path, state: EntranceState) -> Path:
    if state.token and not TOKEN_RE.fullmatch(state.token):
        raise ValueError("security entrance token must be 32 hex characters")
    path = entrance_file(config)
    payload = json.dumps({"token": state.token, "enabled": bool(state.enabled)}, indent=2) + "\n"
    _write_private(path, payload)
    return path


def ensure_state(config: Path) -> EntranceState:
    """Create the token once. Reinstalls keep the existing token and enabled flag."""
    current = load_state(config)
    if TOKEN_RE.fullmatch(current.token or ""):
        save_state(config, current)
        return current
    created = EntranceState(generate_token(), True)
    save_state(config, created)
    return created


def set_enabled(config: Path, enabled: bool) -> EntranceState:
    current = load_state(config)
    if not TOKEN_RE.fullmatch(current.token or ""):
        current = EntranceState(generate_token(), enabled)
    else:
        current = EntranceState(current.token, enabled)
    save_state(config, current)
    return current


def rotate_state(config: Path) -> EntranceState:
    """New token. An existing enabled flag is kept. A missing file starts enabled."""
    current = load_state(config)
    keep = entrance_file(config).is_file() and bool(TOKEN_RE.fullmatch(current.token or ""))
    rotated = EntranceState(generate_token(), current.enabled if keep else True)
    save_state(config, rotated)
    return rotated


def _cookie_value(header: Optional[str], name: str) -> str:
    if not header:
        return ""
    for part in header.split(";"):
        piece = part.strip()
        if "=" not in piece:
            continue
        key, value = piece.split("=", 1)
        if key.strip() == name:
            return value.strip().strip('"')
    return ""


def cookie_matches(cookie_header: Optional[str], token: str) -> bool:
    if not token:
        return False
    value = _cookie_value(cookie_header, COOKIE_NAME)
    if len(value) != len(token):
        return False
    return hmac.compare_digest(value, token)


def _loopback(value: str) -> bool:
    host = (value or "").strip().lower()
    if host.startswith("::ffff:"):
        host = host[7:]
    return host in _LOOPBACK


def _direct_loopback(client_host: str, x_real_ip: str) -> bool:
    """True for a connection that reached the API directly on localhost.

    Nginx overwrites ``X-Real-IP`` with the browser address, so a proxied
    public client is not treated as local even though nginx itself connects
    from 127.0.0.1.
    """
    if not _loopback(client_host):
        return False
    if not (x_real_ip or "").strip():
        return True
    return _loopback(x_real_ip)


def _local_health(path: str, client_host: str, x_real_ip: str) -> bool:
    normalized = (path or "").rstrip("/") or "/"
    if normalized != "/health":
        return False
    if (x_real_ip or "").strip():
        return _loopback(client_host) and _loopback(x_real_ip)
    return _loopback(client_host)


def _is_entrance_path(path: str, token: str) -> bool:
    normalized = (path or "").rstrip("/") or "/"
    return normalized == f"/{token}"


def request_allowed(
    state: EntranceState,
    *,
    path: str,
    cookie_header: Optional[str],
    client_host: Optional[str],
    x_real_ip: Optional[str],
) -> bool:
    """Whether this request may reach the panel.

    External clients need the entrance cookie. Direct localhost (health
    checks, ``curl`` to 127.0.0.1:8000) stays open. Spoofing ``X-Real-IP``
    from a non-loopback peer does not count as local.
    """
    if not state.enabled:
        return True
    client = client_host or ""
    real_ip = x_real_ip or ""
    token = state.token if TOKEN_RE.fullmatch(state.token or "") else ""
    if token and cookie_matches(cookie_header, token):
        return True
    if token and _is_entrance_path(path, token):
        return True
    if _local_health(path, client, real_ip):
        return True
    if token and _direct_loopback(client, real_ip):
        return True
    if not token:
        return _direct_loopback(client, real_ip)
    return False


def render_http_block(state: EntranceState) -> str:
    if not state.active:
        body = "map $uri $copanel_entrance_pass {\n    default 1;\n}\n"
    else:
        token = state.token
        body = (
            "map $cookie_copanel_entrance $copanel_entrance_ok {\n"
            "    default 0;\n"
            f'    "{token}" 1;\n'
            "}\n"
            'map "$copanel_entrance_ok|$uri|$remote_addr" $copanel_entrance_pass {\n'
            "    default 0;\n"
            '    "~^1\\|" 1;\n'
            f'    "~^0\\|/{token}/?\\|" 1;\n'
            '    "~^0\\|/health/?\\|127\\.0\\.0\\.1$" 1;\n'
            '    "~^0\\|/health/?\\|::1$" 1;\n'
            '    "~^0\\|/health/?\\|::ffff:127\\.0\\.0\\.1$" 1;\n'
            "}\n"
        )
    return f"{HTTP_START}\n{body}{HTTP_END}\n"


def render_server_block(state: EntranceState) -> str:
    locations = ""
    if TOKEN_RE.fullmatch(state.token or ""):
        token = state.token
        cookie = (
            f"{COOKIE_NAME}={token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000"
        )
        locations = (
            f"    location = /{token} {{\n"
            "        auth_basic off;\n"
            f'        add_header Set-Cookie "{cookie}" always;\n'
            "        return 302 /;\n"
            "    }\n"
            f"    location = /{token}/ {{\n"
            "        auth_basic off;\n"
            f'        add_header Set-Cookie "{cookie}" always;\n'
            "        return 302 /;\n"
            "    }\n"
        )
    # Relative redirects so Cloudflare Tunnel (and any other proxy on 443)
    # is not sent to https://<public-host>:8686, which is firewalled.
    # CF-Connecting-IP is trusted only from loopback, where cloudflared runs,
    # so the entrance and login limits see the visitor instead of 127.0.0.1.
    proxy = (
        "    absolute_redirect off;\n"
        "    port_in_redirect off;\n"
        "    set_real_ip_from 127.0.0.1;\n"
        "    set_real_ip_from ::1;\n"
        "    real_ip_header CF-Connecting-IP;\n"
    )
    # ``!= 1`` fails closed if the map above is missing.
    gate = "    if ($copanel_entrance_pass != 1) {\n        return 404;\n    }\n"
    return f"{SERVER_START}\n{proxy}{locations}{gate}{SERVER_END}\n"


_REDIRECT_497_PINNED = re.compile(
    r"error_page\s+497\s+=301\s+https://\$host:\$server_port\$request_uri\s*;"
)
_REDIRECT_497_HOST = "error_page 497 =301 https://$http_host$request_uri;"
_LISTEN_8686 = re.compile(r"(?m)^([ \t]*listen\s+[^;\n]*\b8686\b[^;\n]*);")


def _relax_https_redirect(content: str) -> str:
    """Keep the port the client already used.

    A direct browser sends ``Host: 1.2.3.4:8686`` and stays on 8686.
    Cloudflare Tunnel sends ``Host: panel.example.com`` and must stay on 443.
    """
    return _REDIRECT_497_PINNED.sub(_REDIRECT_497_HOST, content)


def _enable_listen_http2(content: str) -> str:
    """cloudflared speaks HTTP/2 to an https:// origin unless the origin accepts it."""

    def repl(match: re.Match) -> str:
        line = match.group(0)
        if "ssl" not in line or "http2" in line:
            return line
        return match.group(1) + " http2;"

    return _LISTEN_8686.sub(repl, content)


def _upsert_block(content: str, start: str, end: str, block: str, insert_at: int) -> str:
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end) + r"\n?", re.DOTALL)
    if pattern.search(content):
        return pattern.sub(lambda _match: block, content, count=1)
    if insert_at < 0:
        raise RuntimeError("nginx site has no server block to attach the security entrance")
    return content[:insert_at] + block + content[insert_at:]


def _http_insert_at(content: str) -> int:
    match = re.search(r"(?m)^server\s*\{", content)
    if not match:
        return -1
    return match.start()


def _server_insert_at(content: str) -> int:
    marker = content.find("error_page 497")
    if marker != -1:
        newline = content.find("\n", marker)
        if newline != -1:
            return newline + 1
    match = re.search(r"(?m)^server\s*\{", content)
    if not match:
        return -1
    newline = content.find("\n", match.end())
    if newline == -1:
        return -1
    return newline + 1


def apply_nginx_text(content: str, state: EntranceState) -> str:
    """Insert or replace the entrance map and server gate. Idempotent."""
    if state.enabled and not TOKEN_RE.fullmatch(state.token or ""):
        raise ValueError("refusing to enable the security entrance without a valid token")
    updated = _upsert_block(content, HTTP_START, HTTP_END, render_http_block(state), _http_insert_at(content))
    updated = _upsert_block(
        updated, SERVER_START, SERVER_END, render_server_block(state), _server_insert_at(updated)
    )
    updated = _relax_https_redirect(updated)
    updated = _enable_listen_http2(updated)
    return updated


def entrance_nginx_current(content: str, state: EntranceState) -> bool:
    return render_http_block(state) in content and render_server_block(state) in content


def find_nginx_site(explicit: Optional[str] = None) -> Optional[Path]:
    if explicit:
        return Path(explicit)
    env = os.environ.get("COPANEL_NGINX_CONF", "").strip()
    if env:
        return Path(env)
    for candidate in NGINX_CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


def apply_nginx_file(path: Path, state: EntranceState) -> bool:
    """Write the entrance into ``path``. Returns True when the file changed."""
    original = path.read_text(encoding="utf-8")
    updated = apply_nginx_text(original, state)
    if updated == original:
        return False
    path.write_text(updated, encoding="utf-8")
    return True


def nginx_test() -> subprocess.CompletedProcess:
    return subprocess.run(["nginx", "-t"], capture_output=True, text=True, check=False)


def nginx_reload() -> subprocess.CompletedProcess:
    return subprocess.run(
        ["systemctl", "reload", "nginx"], capture_output=True, text=True, check=False
    )


def apply_and_reload(path: Path, state: EntranceState) -> bool:
    """Patch the live site, run ``nginx -t``, roll back on failure, then reload."""
    original = path.read_text(encoding="utf-8")
    try:
        apply_nginx_file(path, state)
        test = nginx_test()
        if test.returncode != 0:
            detail = (test.stderr or test.stdout or "").strip()
            raise RuntimeError(f"nginx -t failed: {detail}")
        reload = nginx_reload()
        return reload.returncode == 0
    except Exception:
        try:
            path.write_text(original, encoding="utf-8")
        except OSError:
            pass
        raise


def maybe_auto_repair(config: Optional[Path] = None, nginx_file: Optional[Path] = None) -> Optional[dict]:
    """Re-inject the entrance after install.sh overwrites the nginx site."""
    # Pytest sets this and imports the app. Never rewrite the machine nginx
    # site as a side effect of a test client's startup hook.
    if nginx_file is None and os.environ.get("COPANEL_TEST_CONFIG_DIR", "").strip():
        return None
    config = config or resolve_config_dir()
    state = load_state(config)
    if not TOKEN_RE.fullmatch(state.token or ""):
        return None
    path = nginx_file or find_nginx_site()
    if path is None or not path.is_file():
        return None
    try:
        content = path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.warning("security entrance auto-repair skipped: %s", exc)
        return None
    if entrance_nginx_current(content, state):
        return None
    try:
        reload_ok = apply_and_reload(path, state)
    except Exception as exc:
        logger.warning("security entrance auto-repair failed: %s", exc)
        return None
    logger.info("security entrance nginx block restored (reload_ok=%s)", reload_ok)
    return {"repaired": True, "reload_ok": reload_ok, "enabled": state.enabled}


def _valid_dns(name: str) -> bool:
    if not name or not _DNS_RE.fullmatch(name):
        return False
    if name.startswith("-") or ".." in name:
        return False
    return True


def _valid_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


def detect_dns_names() -> List[str]:
    names = ["localhost"]
    for candidate in (socket.gethostname(), socket.getfqdn()):
        candidate = (candidate or "").strip().rstrip(".")
        if _valid_dns(candidate) and candidate not in names and not _valid_ip(candidate):
            names.append(candidate)
    return names


def detect_ip_addrs() -> List[str]:
    ips = ["127.0.0.1"]
    try:
        out = subprocess.run(
            ["hostname", "-I"], capture_output=True, text=True, check=False, timeout=3
        )
        for part in (out.stdout or "").split():
            if _valid_ip(part) and part not in ips:
                ips.append(part)
    except (OSError, subprocess.TimeoutExpired):
        pass
    return ips


def _openssl_config(dns_names: Sequence[str], ip_addrs: Sequence[str]) -> str:
    lines = [
        "[req]",
        "prompt = no",
        "distinguished_name = dn",
        "x509_extensions = v3_req",
        "",
        "[dn]",
        "CN = copanel",
        "",
        "[v3_req]",
        "subjectAltName = @alt_names",
        "basicConstraints = CA:FALSE",
        "keyUsage = digitalSignature, keyEncipherment",
        "extendedKeyUsage = serverAuth",
        "",
        "[alt_names]",
    ]
    for index, name in enumerate(dns_names, start=1):
        lines.append(f"DNS.{index} = {name}")
    for index, addr in enumerate(ip_addrs, start=1):
        lines.append(f"IP.{index} = {addr}")
    return "\n".join(lines) + "\n"


def ensure_certificate(
    config: Path,
    *,
    dns_names: Optional[Iterable[str]] = None,
    ip_addrs: Optional[Iterable[str]] = None,
) -> Tuple[Path, Path]:
    """Create a 10-year self-signed cert if ``panel.crt`` and ``panel.key`` are absent.

    An existing pair is kept, including a real certificate the admin copied
    over the self-signed files.
    """
    crt, key = ssl_paths(config)
    if crt.is_file() and key.is_file() and crt.stat().st_size > 0 and key.stat().st_size > 0:
        try:
            os.chmod(key, 0o600)
        except OSError:
            pass
        return crt, key

    dns = [name for name in (dns_names if dns_names is not None else detect_dns_names()) if _valid_dns(name)]
    ips = [addr for addr in (ip_addrs if ip_addrs is not None else detect_ip_addrs()) if _valid_ip(addr)]
    if "localhost" not in dns:
        dns.insert(0, "localhost")
    if "127.0.0.1" not in ips:
        ips.insert(0, "127.0.0.1")
    if not dns or not ips:
        raise ValueError("cannot build a certificate without a DNS name and an IP")

    crt.parent.mkdir(parents=True, exist_ok=True)
    cnf_path = crt.parent / "panel.openssl.cnf"
    cnf_path.write_text(_openssl_config(dns, ips), encoding="utf-8")
    try:
        proc = subprocess.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-sha256",
                "-days",
                str(CERT_DAYS),
                "-nodes",
                "-keyout",
                str(key),
                "-out",
                str(crt),
                "-config",
                str(cnf_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    finally:
        try:
            cnf_path.unlink()
        except OSError:
            pass
    if proc.returncode != 0 or not crt.is_file() or not key.is_file():
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"openssl failed to create the panel certificate: {detail}")
    try:
        os.chmod(key, 0o600)
        os.chmod(crt, 0o644)
    except OSError:
        pass
    return crt, key


def format_host(host: str) -> str:
    value = (host or "").strip()
    if not value:
        return value
    if value.startswith("["):
        return value
    try:
        ipaddress.IPv6Address(value)
    except ValueError:
        return value
    return f"[{value}]"


def build_entrance_url(token: str, host: str, *, port: Optional[int] = PANEL_PORT, proto: str = "https") -> str:
    if not TOKEN_RE.fullmatch(token or ""):
        return ""
    pretty = format_host(host)
    if not pretty:
        return f"/{token}/"
    if port:
        return f"{proto}://{pretty}:{port}/{token}/"
    return f"{proto}://{pretty}/{token}/"


def split_host_header(value: str) -> Tuple[str, Optional[int]]:
    """Split ``Host`` into hostname and port. Bare IPv6 has no port."""
    raw = (value or "").strip()
    if not raw:
        return "", None
    if raw.startswith("["):
        bracket = raw.find("]")
        if bracket == -1:
            return raw, None
        host = raw[: bracket + 1]
        rest = raw[bracket + 1 :]
        if rest.startswith(":") and rest[1:].isdigit():
            return host, int(rest[1:])
        return host, None
    if raw.count(":") == 1:
        host, port_text = raw.split(":")
        if port_text.isdigit():
            return host, int(port_text)
    if raw.count(":") > 1:
        return format_host(raw), None
    return raw, None


def describe(state: EntranceState, *, host: Optional[str] = None, proto: str = "https") -> dict:
    token = state.token if TOKEN_RE.fullmatch(state.token or "") else ""
    url = ""
    if token and host:
        hostname, port = split_host_header(host)
        # A Host header that already includes :8686 must not grow a second port.
        url = build_entrance_url(token, hostname, port=port if port is not None else PANEL_PORT, proto=proto)
    elif token:
        url = f"/{token}/"
    crt, key = ssl_paths(resolve_config_dir())
    return {
        "enabled": bool(state.enabled and token),
        "configured": bool(token),
        "path": f"/{token}/" if token else "",
        "url": url,
        "cert_path": str(crt),
        "key_path": str(key),
    }


def _resolve_home_config(home: Optional[str]) -> Path:
    if home:
        path = Path(home) / "config"
        path.mkdir(parents=True, exist_ok=True)
        return path
    return resolve_config_dir()


def _print_show(state: EntranceState, host: str, config: Path, *, url_only: bool, as_json: bool) -> None:
    url = build_entrance_url(state.token, host) if TOKEN_RE.fullmatch(state.token or "") else ""
    if as_json:
        json.dump(
            {
                "enabled": bool(state.enabled and url),
                "configured": bool(url),
                "url": url,
                "path": f"/{state.token}/" if url else "",
            },
            sys.stdout,
        )
        sys.stdout.write("\n")
        return
    if url_only:
        if url:
            print(url)
        return
    if not url:
        print("Security entrance is not configured. Run: copanel-entrance enable")
        return
    crt, key = ssl_paths(config)
    print("CoPanel security entrance")
    print(f"  URL:     {url}")
    print(f"  Enabled: {'yes' if state.enabled else 'no'}")
    print(f"  TLS:     {crt}")
    print(f"  Key:     {key}")
    print("Lost this link? Run: copanel-entrance")


def _cmd_apply(config: Path, nginx: Path, *, reload: bool) -> int:
    state = load_state(config)
    if not TOKEN_RE.fullmatch(state.token or ""):
        state = ensure_state(config)
    if reload:
        apply_and_reload(nginx, state)
    else:
        apply_nginx_file(nginx, state)
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="CoPanel security entrance and panel certificate")
    parser.add_argument("--home", help="CoPanel install root (defaults to /opt/copanel or the repo)")
    parser.add_argument("--host", default="", help="IP or hostname used when printing the URL")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("ensure", help="Create the token file if it is missing")
    sub.add_parser("ensure-cert", help="Create the self-signed panel certificate if it is missing")

    apply_parser = sub.add_parser("apply-nginx", help="Write the entrance into an nginx site file")
    apply_parser.add_argument("nginx_file")
    apply_parser.add_argument("--reload", action="store_true")

    show_parser = sub.add_parser("show", help="Print the entrance URL")
    show_parser.add_argument("--url-only", action="store_true")
    show_parser.add_argument("--json", action="store_true")

    for name in ("rotate", "disable", "enable"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--nginx")
        cmd.add_argument("--no-reload", action="store_true")

    # Default command is show, so `copanel-entrance` with no args prints the URL.
    args = parser.parse_args(list(argv) if argv is not None else None)
    command = args.command or "show"
    config = _resolve_home_config(args.home)
    host = (args.host or os.environ.get("COPANEL_PANEL_IP") or "").strip() or _default_host()

    if command == "ensure":
        ensure_state(config)
        return 0
    if command == "ensure-cert":
        ensure_certificate(config)
        return 0
    if command == "apply-nginx":
        return _cmd_apply(config, Path(args.nginx_file), reload=bool(args.reload))
    if command == "show":
        _print_show(
            load_state(config),
            host,
            config,
            url_only=bool(getattr(args, "url_only", False)),
            as_json=bool(getattr(args, "json", False)),
        )
        return 0

    nginx = find_nginx_site(getattr(args, "nginx", None))
    reload = not bool(getattr(args, "no_reload", False))
    previous = load_state(config)
    if command == "rotate":
        state = rotate_state(config)
    elif command == "disable":
        state = set_enabled(config, False)
    elif command == "enable":
        state = set_enabled(config, True)
    else:
        parser.error(f"unknown command {command}")
        return 2

    try:
        if nginx is not None and nginx.is_file():
            if reload:
                apply_and_reload(nginx, state)
            else:
                apply_nginx_file(nginx, state)
        elif nginx is not None:
            raise RuntimeError(f"nginx site not found: {nginx}")
        else:
            print(
                "warning: nginx site not found; updated the token file only",
                file=sys.stderr,
            )
    except Exception:
        if TOKEN_RE.fullmatch(previous.token or ""):
            save_state(config, previous)
        elif not previous.token and entrance_file(config).is_file():
            try:
                entrance_file(config).unlink()
            except OSError:
                pass
        raise

    _print_show(state, host, config, url_only=False, as_json=False)
    return 0


def _default_host() -> str:
    for addr in detect_ip_addrs():
        if addr != "127.0.0.1":
            return addr
    return "127.0.0.1"


async def security_entrance_middleware(request, call_next):
    """Hide the API until the entrance cookie is set. Loopback health stays open."""
    from starlette.responses import Response

    client_host = request.client.host if request.client else ""
    real_ip = request.headers.get("x-real-ip", "")
    try:
        state = load_state(resolve_config_dir())
        allowed = request_allowed(
            state,
            path=request.url.path,
            cookie_header=request.headers.get("cookie"),
            client_host=client_host,
            x_real_ip=real_ip,
        )
    except Exception:
        logger.exception("security entrance check failed")
        allowed = _direct_loopback(client_host, real_ip)
    if allowed:
        return await call_next(request)
    return Response(status_code=404, content=b"Not Found\n", media_type="text/plain")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
