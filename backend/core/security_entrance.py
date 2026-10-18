"""Panel port helpers.

``install.sh`` serves port 8686 over plain HTTP so Cloudflare Tunnel can use
``http://<lan-ip>:8686`` or ``http://localhost:8686``. The self-signed HTTPS
listener and the secret ``/<token>/`` entrance are removed. ``apply-nginx``
and the startup repair rewrite a leftover HTTPS site back to HTTP.

Stdlib only, so ``install.sh`` can run this file before the virtualenv
imports FastAPI.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import logging
import os
import re
import socket
import subprocess
import sys
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

ENTRANCE_FILENAME = "security_entrance.json"
PANEL_PORT = 8686
SSL_CERT_NAME = "panel.crt"
SSL_KEY_NAME = "panel.key"
CERT_DAYS = 3650  # 10 years

# Markers written by panel versions that required the secret path.
HTTP_START = "# BEGIN COPANEL SECURITY ENTRANCE"
HTTP_END = "# END COPANEL SECURITY ENTRANCE"
SERVER_START = "# BEGIN COPANEL SECURITY ENTRANCE SERVER"
SERVER_END = "# END COPANEL SECURITY ENTRANCE SERVER"

TLS_START = "# BEGIN COPANEL PANEL TLS"
TLS_END = "# END COPANEL PANEL TLS"
TUNNEL_START = "# BEGIN COPANEL TUNNEL ORIGIN"
TUNNEL_END = "# END COPANEL TUNNEL ORIGIN"

_DNS_RE = re.compile(r"^[A-Za-z0-9._-]{1,253}$")

NGINX_CANDIDATES = (
    Path("/etc/nginx/sites-available/copanel"),
    Path("/etc/nginx/conf.d/copanel.conf"),
)

_LISTEN_8686 = re.compile(r"(?m)^([ \t]*listen\s+[^;\n]*\b8686\b[^;\n]*);")
_SERVER_BLOCK = re.compile(
    re.escape(SERVER_START) + r".*?" + re.escape(SERVER_END) + r"\n?",
    re.DOTALL,
)
_HTTP_BLOCK = re.compile(
    re.escape(HTTP_START) + r"\n.*?" + re.escape(HTTP_END) + r"\n?",
    re.DOTALL,
)


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


def ssl_paths(config: Path) -> Tuple[Path, Path]:
    directory = config / "ssl"
    return directory / SSL_CERT_NAME, directory / SSL_KEY_NAME


def entrance_file(config: Path) -> Path:
    return config / ENTRANCE_FILENAME


def forget_entrance(config: Path) -> bool:
    """Delete a leftover token file. Returns True when a file was removed."""
    path = entrance_file(config)
    if not path.is_file():
        return False
    try:
        path.unlink()
    except OSError as exc:
        logger.warning("could not remove %s: %s", path, exc)
        return False
    return True


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


def build_panel_url(host: str, *, port: Optional[int] = PANEL_PORT, proto: str = "http") -> str:
    pretty = format_host(host)
    if not pretty:
        return "/"
    if port:
        return f"{proto}://{pretty}:{port}/"
    return f"{proto}://{pretty}/"


def strip_entrance(content: str) -> str:
    """Drop the secret-path map and the server ``return 404`` gate."""
    # The server marker contains the http marker as a prefix, so remove it first.
    updated = _SERVER_BLOCK.sub("", content)
    updated = _HTTP_BLOCK.sub("", updated)
    return updated


_SSL_DIRECTIVE = re.compile(
    r"(?m)^[ \t]*ssl_(?:certificate|certificate_key|protocols|prefer_server_ciphers|session_timeout)\b[^;\n]*;\n?"
)
_ERROR_497 = re.compile(r"(?m)^[ \t]*error_page\s+497\b[^;\n]*;\n?")
_TLS_BLOCK = re.compile(re.escape(TLS_START) + r".*?" + re.escape(TLS_END) + r"\n?", re.DOTALL)
_TUNNEL_BLOCK = re.compile(re.escape(TUNNEL_START) + r".*?" + re.escape(TUNNEL_END) + r"\n?", re.DOTALL)


def _listen_plain_http(content: str) -> str:
    """Serve port 8686 as plain HTTP, the origin Cloudflare Tunnel already used."""

    def repl(match: re.Match) -> str:
        line = match.group(0)
        indent = re.match(r"[ \t]*", line).group(0)
        if "[::]" in line:
            return f"{indent}listen [::]:8686;"
        return f"{indent}listen 8686;"

    return _LISTEN_8686.sub(repl, content)


def strip_panel_tls(content: str) -> str:
    """Drop HTTPS on 8686 and a leftover loopback tunnel server on 8687."""
    updated = _TLS_BLOCK.sub("", content)
    updated = _TUNNEL_BLOCK.sub("", updated)
    updated = _ERROR_497.sub("", updated)
    updated = _SSL_DIRECTIVE.sub("", updated)
    return _listen_plain_http(updated)


def apply_nginx_text(content: str) -> str:
    """Remove the secret entrance and the HTTPS wrapper on port 8686."""
    updated = strip_entrance(content)
    return strip_panel_tls(updated)


def panel_nginx_current(content: str) -> bool:
    if HTTP_START in content or SERVER_START in content or "copanel_entrance_pass" in content:
        return False
    if TLS_START in content or TUNNEL_START in content or "error_page 497" in content or "ssl_certificate" in content:
        return False
    if "8687" in content:
        return False
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("listen") and "8686" in stripped and "ssl" in stripped:
            return False
    return "listen 8686;" in content


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


def apply_nginx_file(path: Path) -> bool:
    """Rewrite ``path`` to plain HTTP on 8686. Returns True when the file changed."""
    original = path.read_text(encoding="utf-8")
    updated = apply_nginx_text(original)
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


def apply_and_reload(path: Path) -> bool:
    """Patch the live site, run ``nginx -t``, roll back on failure, then reload."""
    original = path.read_text(encoding="utf-8")
    try:
        apply_nginx_file(path)
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
    """Drop a leftover secret-path gate after upgrade. Does not hide the panel."""
    if nginx_file is None and os.environ.get("COPANEL_TEST_CONFIG_DIR", "").strip():
        return None
    config = config or resolve_config_dir()
    removed_file = forget_entrance(config)
    path = nginx_file or find_nginx_site()
    if path is None or not path.is_file():
        if removed_file:
            return {"repaired": False, "entrance_file_removed": True}
        return None
    try:
        content = path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.warning("panel TLS auto-repair skipped: %s", exc)
        return None
    if panel_nginx_current(content):
        if removed_file:
            return {"repaired": False, "entrance_file_removed": True}
        return None
    try:
        reload_ok = apply_and_reload(path)
    except Exception as exc:
        logger.warning("panel TLS auto-repair failed: %s", exc)
        return None
    logger.info("removed security entrance from nginx (reload_ok=%s)", reload_ok)
    return {"repaired": True, "reload_ok": reload_ok, "entrance_file_removed": removed_file}


def _resolve_home_config(home: Optional[str]) -> Path:
    if home:
        path = Path(home) / "config"
        path.mkdir(parents=True, exist_ok=True)
        return path
    return resolve_config_dir()


def _default_host() -> str:
    for addr in detect_ip_addrs():
        if addr != "127.0.0.1":
            return addr
    return "127.0.0.1"


def _print_show(host: str, config: Path, *, url_only: bool, as_json: bool) -> None:
    url = build_panel_url(host)
    if as_json:
        json.dump({"enabled": False, "url": url, "path": "/"}, sys.stdout)
        sys.stdout.write("\n")
        return
    if url_only:
        print(url)
        return
    crt, key = ssl_paths(config)
    print("CoPanel")
    print(f"  URL: {url}")
    print(f"  TLS: {crt}")
    print(f"  Key: {key}")


def _cmd_apply(nginx: Path, *, reload: bool) -> int:
    if reload:
        apply_and_reload(nginx)
    else:
        apply_nginx_file(nginx)
    return 0


def _cmd_open(config: Path, nginx: Optional[Path], *, reload: bool, host: str) -> int:
    forget_entrance(config)
    if nginx is not None and nginx.is_file():
        if reload:
            apply_and_reload(nginx)
        else:
            apply_nginx_file(nginx)
    elif nginx is not None:
        raise RuntimeError(f"nginx site not found: {nginx}")
    _print_show(host, config, url_only=False, as_json=False)
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Restore plain HTTP on port 8686 and drop a leftover secret path")
    parser.add_argument("--home", help="CoPanel install root (defaults to /opt/copanel or the repo)")
    parser.add_argument("--host", default="", help="IP or hostname used when printing the URL")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("ensure", help="Remove a leftover security-entrance token file")
    sub.add_parser("ensure-cert", help="Create the self-signed panel certificate if it is missing")

    apply_parser = sub.add_parser("apply-nginx", help="Rewrite an nginx site to plain HTTP on port 8686")
    apply_parser.add_argument("nginx_file")
    apply_parser.add_argument("--reload", action="store_true")

    show_parser = sub.add_parser("show", help="Print the panel URL")
    show_parser.add_argument("--url-only", action="store_true")
    show_parser.add_argument("--json", action="store_true")

    for name in ("rotate", "disable", "enable"):
        cmd = sub.add_parser(name, help="Open http://<host>:8686/ and drop any leftover secret path")
        cmd.add_argument("--nginx")
        cmd.add_argument("--no-reload", action="store_true")

    args = parser.parse_args(list(argv) if argv is not None else None)
    command = args.command or "show"
    config = _resolve_home_config(args.home)
    host = (args.host or os.environ.get("COPANEL_PANEL_IP") or "").strip() or _default_host()

    if command == "ensure":
        forget_entrance(config)
        return 0
    if command == "ensure-cert":
        ensure_certificate(config)
        return 0
    if command == "apply-nginx":
        return _cmd_apply(Path(args.nginx_file), reload=bool(args.reload))
    if command == "show":
        _print_show(
            host,
            config,
            url_only=bool(getattr(args, "url_only", False)),
            as_json=bool(getattr(args, "json", False)),
        )
        return 0

    nginx = find_nginx_site(getattr(args, "nginx", None))
    reload = not bool(getattr(args, "no_reload", False))
    return _cmd_open(config, nginx, reload=reload, host=host)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
