"""
Cloudflare DDNS + DNS record + Tunnel management.

Persists settings under /var/lib/copanel/cloudflare_ddns.json and syncs DDNS
jobs to system crontab (Linux only).
"""
from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.request import Request, urlopen

import httpx

IS_WINDOWS = os.name == "nt"

STORE_PATH = (
    Path("./test_nginx/cloudflare_ddns.json")
    if IS_WINDOWS
    else Path("/var/lib/copanel/cloudflare_ddns.json")
)
CF_CONFIG_DIR = (
    Path("./test_nginx/cloudflared")
    if IS_WINDOWS
    else Path("/etc/cloudflared")
)
LOG_DIR = Path("./test_nginx/logs") if IS_WINDOWS else Path("/opt/copanel/logs")
BACKEND_ROOT = Path("/opt/copanel/backend") if not IS_WINDOWS else Path(__file__).resolve().parents[2]
RUN_UPDATE_SCRIPT = BACKEND_ROOT / "modules" / "cloudflare_ddns" / "run_update.py"
CRON_TAG_START = "# BEGIN COPANEL CLOUDFLARE DDNS"
CRON_TAG_END = "# END COPANEL CLOUDFLARE DDNS"
DDNS_CRON_MARKER = "modules.cloudflare_ddns.run_update"
DEFAULT_CRON_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

CF_API = "https://api.cloudflare.com/client/v4"
PUBLIC_IP_URLS = (
    "https://api.ipify.org",
    "https://ifconfig.me/ip",
    "https://icanhazip.com",
)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "****"
    return f"{value[:4]}****{value[-4:]}"


def _default_store() -> Dict[str, Any]:
    return {
        "api_token": "",
        "account_id": "",
        "account_name": "",
        "ddns_profiles": [],
        "tunnel_local": {},
        "updated_at": time.time(),
    }


def _load_store() -> Dict[str, Any]:
    if not STORE_PATH.exists():
        STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        STORE_PATH.write_text(json.dumps(_default_store(), indent=2), encoding="utf-8")
    try:
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except Exception:
        data = _default_store()
    for key, val in _default_store().items():
        if key not in data:
            data[key] = val if not isinstance(val, list) else []
    return data


def _save_store(data: Dict[str, Any]) -> None:
    data["updated_at"] = time.time()
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STORE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _resolve_python_bin() -> str:
    for candidate in (
        "/opt/copanel/venv/bin/python",
        "/opt/copanel/venv/bin/python3",
        shutil.which("python3"),
        shutil.which("python"),
    ):
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return "python3"


def _resolve_cloudflared_bin() -> Optional[str]:
    for candidate in (
        shutil.which("cloudflared"),
        "/usr/local/bin/cloudflared",
        "/usr/bin/cloudflared",
    ):
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def _is_orphan_ddns_cron_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return False
    return DDNS_CRON_MARKER in stripped or "run_update.py" in stripped


class CloudflareClient:
    def __init__(self, api_token: str) -> None:
        if not api_token:
            raise ValueError("Cloudflare API token is not configured.")
        self.api_token = api_token
        self._client = httpx.Client(
            base_url=CF_API,
            headers={
                "Authorization": f"Bearer {api_token}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    def close(self) -> None:
        self._client.close()

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        res = self._client.request(method, path, **kwargs)
        try:
            body = res.json()
        except Exception:
            body = {"success": False, "errors": [{"message": res.text or res.reason_phrase}]}
        if not res.is_success or not body.get("success", False):
            errors = body.get("errors") or []
            msg = errors[0].get("message") if errors else res.text or "Cloudflare API error"
            raise ValueError(msg)
        return body.get("result")

    def verify_token(self) -> Dict[str, Any]:
        return self._request("GET", "/user/tokens/verify")

    def list_accounts(self) -> List[Dict[str, Any]]:
        return self._request("GET", "/accounts") or []

    def list_zones(self) -> List[Dict[str, Any]]:
        return self._request("GET", "/zones", params={"per_page": 50}) or []

    def list_dns_records(self, zone_id: str, name: Optional[str] = None) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"per_page": 100}
        if name:
            params["name"] = name
        return self._request("GET", f"/zones/{zone_id}/dns_records", params=params) or []

    def create_dns_record(self, zone_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._request("POST", f"/zones/{zone_id}/dns_records", json=payload)

    def update_dns_record(self, zone_id: str, record_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._request("PATCH", f"/zones/{zone_id}/dns_records/{record_id}", json=payload)

    def delete_dns_record(self, zone_id: str, record_id: str) -> bool:
        self._request("DELETE", f"/zones/{zone_id}/dns_records/{record_id}")
        return True

    def list_tunnels(self, account_id: str) -> List[Dict[str, Any]]:
        return (
            self._request(
                "GET",
                f"/accounts/{account_id}/cfd_tunnel",
                params={"is_deleted": "false", "per_page": 50},
            )
            or []
        )

    def create_tunnel(self, account_id: str, name: str) -> Dict[str, Any]:
        secret = os.urandom(32).hex()
        return self._request(
            "POST",
            f"/accounts/{account_id}/cfd_tunnel",
            json={"name": name, "tunnel_secret": secret, "config_src": "local"},
        )

    def delete_tunnel(self, account_id: str, tunnel_id: str) -> bool:
        self._request("DELETE", f"/accounts/{account_id}/cfd_tunnel/{tunnel_id}")
        return True

    def get_tunnel_token(self, account_id: str, tunnel_id: str) -> str:
        result = self._request("GET", f"/accounts/{account_id}/cfd_tunnel/{tunnel_id}/token")
        if isinstance(result, str):
            return result
        raise ValueError("Tunnel token not returned by Cloudflare API.")


def _client_from_store() -> CloudflareClient:
    store = _load_store()
    return CloudflareClient(store.get("api_token") or "")


def get_public_config() -> Dict[str, Any]:
    store = _load_store()
    token = store.get("api_token") or ""
    return {
        "api_token_set": bool(token),
        "api_token_hint": _mask_secret(token),
        "account_id": store.get("account_id") or "",
        "account_name": store.get("account_name") or "",
        "cloudflared_installed": bool(_resolve_cloudflared_bin()),
        "cloudflared_path": _resolve_cloudflared_bin() or "",
        "config_dir": str(CF_CONFIG_DIR),
        "updated_at": store.get("updated_at"),
    }


def save_config(api_token: Optional[str] = None, account_id: Optional[str] = None) -> Dict[str, Any]:
    store = _load_store()
    if api_token is not None and api_token.strip():
        store["api_token"] = api_token.strip()
    if account_id is not None:
        store["account_id"] = account_id.strip()
    _save_store(store)
    if store.get("api_token"):
        try:
            verify_config()
        except Exception:
            pass
    sync_crontab()
    return get_public_config()


def verify_config() -> Dict[str, Any]:
    store = _load_store()
    client = CloudflareClient(store.get("api_token") or "")
    try:
        verify = client.verify_token()
        accounts = client.list_accounts()
        if not store.get("account_id") and accounts:
            store["account_id"] = accounts[0].get("id") or ""
            store["account_name"] = accounts[0].get("name") or ""
            _save_store(store)
        elif store.get("account_id"):
            for acc in accounts:
                if acc.get("id") == store["account_id"]:
                    store["account_name"] = acc.get("name") or ""
                    _save_store(store)
                    break
        return {
            "valid": True,
            "status": verify.get("status"),
            "accounts": [{"id": a.get("id"), "name": a.get("name")} for a in accounts],
            "account_id": store.get("account_id") or "",
            "account_name": store.get("account_name") or "",
        }
    finally:
        client.close()


def list_zones() -> List[Dict[str, Any]]:
    client = _client_from_store()
    try:
        zones = client.list_zones()
        return [
            {
                "id": z.get("id"),
                "name": z.get("name"),
                "status": z.get("status"),
                "paused": z.get("paused"),
            }
            for z in zones
        ]
    finally:
        client.close()


def list_records(zone_id: str) -> List[Dict[str, Any]]:
    client = _client_from_store()
    try:
        records = client.list_dns_records(zone_id)
        return [
            {
                "id": r.get("id"),
                "type": r.get("type"),
                "name": r.get("name"),
                "content": r.get("content"),
                "ttl": r.get("ttl"),
                "proxied": r.get("proxied"),
                "priority": r.get("priority"),
                "modified_on": r.get("modified_on"),
            }
            for r in records
        ]
    finally:
        client.close()


def create_record(zone_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    rtype = (payload.get("type") or "").upper()
    if rtype not in {"A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA", "PTR"}:
        raise ValueError(f"Unsupported record type '{rtype}'.")
    body = {
        "type": rtype,
        "name": payload["name"],
        "content": payload["content"],
        "ttl": int(payload.get("ttl") or 1),
        "proxied": bool(payload.get("proxied")),
    }
    if payload.get("priority") is not None:
        body["priority"] = int(payload["priority"])
    client = _client_from_store()
    try:
        rec = client.create_dns_record(zone_id, body)
        return {
            "id": rec.get("id"),
            "type": rec.get("type"),
            "name": rec.get("name"),
            "content": rec.get("content"),
            "ttl": rec.get("ttl"),
            "proxied": rec.get("proxied"),
        }
    finally:
        client.close()


def update_record(zone_id: str, record_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    body = {k: v for k, v in payload.items() if v is not None}
    if "type" in body:
        body["type"] = str(body["type"]).upper()
    client = _client_from_store()
    try:
        rec = client.update_dns_record(zone_id, record_id, body)
        return {
            "id": rec.get("id"),
            "type": rec.get("type"),
            "name": rec.get("name"),
            "content": rec.get("content"),
            "ttl": rec.get("ttl"),
            "proxied": rec.get("proxied"),
        }
    finally:
        client.close()


def delete_record(zone_id: str, record_id: str) -> bool:
    client = _client_from_store()
    try:
        return client.delete_dns_record(zone_id, record_id)
    finally:
        client.close()


def list_ddns_profiles() -> List[Dict[str, Any]]:
    return list(_load_store().get("ddns_profiles") or [])


def _find_ddns(profile_id: str) -> Tuple[Dict[str, Any], Dict[str, Any], int]:
    store = _load_store()
    for idx, p in enumerate(store.get("ddns_profiles") or []):
        if p.get("id") == profile_id:
            return store, p, idx
    raise ValueError("DDNS profile not found.")


def create_ddns_profile(data: Dict[str, Any]) -> Dict[str, Any]:
    store = _load_store()
    profile = {
        "id": _new_id("ddns"),
        "name": data["name"].strip(),
        "zone_id": data["zone_id"],
        "zone_name": data.get("zone_name") or "",
        "record_name": data["record_name"].strip(),
        "record_type": (data.get("record_type") or "A").upper(),
        "proxied": bool(data.get("proxied")),
        "ttl": int(data.get("ttl") or 1),
        "ip_source": data.get("ip_source") or "public",
        "interface_name": data.get("interface_name") or "",
        "custom_ip_url": data.get("custom_ip_url") or "",
        "interval_minutes": int(data.get("interval_minutes") or 5),
        "enabled": bool(data.get("enabled", True)),
        "record_id": "",
        "last_ip": "",
        "last_run": None,
        "last_status": "",
        "last_error": "",
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    store.setdefault("ddns_profiles", []).append(profile)
    _save_store(store)
    sync_crontab()
    return profile


def update_ddns_profile(profile_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    store, profile, idx = _find_ddns(profile_id)
    for key in (
        "name", "zone_id", "zone_name", "record_name", "record_type",
        "proxied", "ttl", "ip_source", "interface_name", "custom_ip_url",
        "interval_minutes", "enabled",
    ):
        if key in data and data[key] is not None:
            if key in {"proxied", "enabled"}:
                profile[key] = bool(data[key])
            elif key in {"ttl", "interval_minutes"}:
                profile[key] = int(data[key])
            elif key == "record_type":
                profile[key] = str(data[key]).upper()
            else:
                profile[key] = data[key]
    profile["updated_at"] = time.time()
    store["ddns_profiles"][idx] = profile
    _save_store(store)
    sync_crontab()
    return profile


def delete_ddns_profile(profile_id: str) -> bool:
    store = _load_store()
    before = len(store.get("ddns_profiles") or [])
    store["ddns_profiles"] = [p for p in store.get("ddns_profiles") or [] if p.get("id") != profile_id]
    if len(store["ddns_profiles"]) == before:
        return False
    _save_store(store)
    sync_crontab()
    return True


def _fetch_url_ip(url: str) -> str:
    req = Request(url, headers={"User-Agent": "CoPanel-CloudflareDDNS/1.0"})
    with urlopen(req, timeout=15) as resp:
        ip = resp.read().decode("utf-8", errors="ignore").strip()
    if not re.match(r"^[\da-fA-F:.]+$", ip):
        raise ValueError(f"Invalid IP from URL: {ip}")
    return ip


def _get_public_ip() -> str:
    last_err: Optional[Exception] = None
    for url in PUBLIC_IP_URLS:
        try:
            return _fetch_url_ip(url)
        except Exception as exc:
            last_err = exc
    raise ValueError(f"Failed to detect public IP: {last_err}")


def _get_interface_ip(iface: str, record_type: str) -> str:
    if IS_WINDOWS:
        raise ValueError("Interface IP source is not supported on Windows.")
    if not iface:
        raise ValueError("interface_name is required for interface IP source.")
    family = socket.AF_INET6 if record_type == "AAAA" else socket.AF_INET
    proc = subprocess.run(
        ["ip", "-j", "-f", "inet6" if family == socket.AF_INET6 else "inet", "addr", "show", "dev", iface],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise ValueError(proc.stderr.strip() or f"Failed to read interface {iface}")
    try:
        data = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
        raise ValueError(f"Failed to parse IP data for {iface}")
    for block in data:
        for info in block.get("addr_info") or []:
            ip = info.get("local")
            if not ip:
                continue
            if family == socket.AF_INET and ":" in ip:
                continue
            if family == socket.AF_INET6 and ":" not in ip:
                continue
            if ip.startswith("fe80:"):
                continue
            return ip
    raise ValueError(f"No {record_type} address on interface {iface}")


def resolve_profile_ip(profile: Dict[str, Any]) -> str:
    source = profile.get("ip_source") or "public"
    rtype = (profile.get("record_type") or "A").upper()
    if source == "interface":
        return _get_interface_ip(profile.get("interface_name") or "", rtype)
    if source == "custom_url":
        url = (profile.get("custom_ip_url") or "").strip()
        if not url:
            raise ValueError("custom_ip_url is required for custom_url IP source.")
        return _fetch_url_ip(url)
    return _get_public_ip()


def _fqdn(record_name: str, zone_name: str) -> str:
    name = (record_name or "@").strip().rstrip(".")
    zone = (zone_name or "").strip().rstrip(".")
    if name in ("@", ""):
        return zone
    if name.endswith(f".{zone}"):
        return name
    return f"{name}.{zone}" if zone else name


def run_ddns_profile(profile_id: str) -> Dict[str, Any]:
    store, profile, idx = _find_ddns(profile_id)
    client = CloudflareClient(store.get("api_token") or "")
    try:
        new_ip = resolve_profile_ip(profile)
        zone_id = profile["zone_id"]
        zone_name = profile.get("zone_name") or ""
        fqdn = _fqdn(profile.get("record_name") or "@", zone_name)
        rtype = (profile.get("record_type") or "A").upper()

        record_id = profile.get("record_id") or ""
        existing = None
        if record_id:
            records = client.list_dns_records(zone_id, name=fqdn)
            existing = next((r for r in records if r.get("id") == record_id), None)
        if not existing:
            records = client.list_dns_records(zone_id, name=fqdn)
            existing = next((r for r in records if (r.get("type") or "").upper() == rtype), None)

        if profile.get("last_ip") == new_ip and existing and existing.get("content") == new_ip:
            profile["last_run"] = time.time()
            profile["last_status"] = "unchanged"
            profile["last_error"] = ""
            store["ddns_profiles"][idx] = profile
            _save_store(store)
            return {"status": "unchanged", "ip": new_ip, "record_id": existing.get("id")}

        body = {
            "type": rtype,
            "name": profile.get("record_name") or "@",
            "content": new_ip,
            "ttl": int(profile.get("ttl") or 1),
            "proxied": bool(profile.get("proxied")),
        }
        if existing:
            rec = client.update_dns_record(zone_id, existing["id"], body)
            action = "updated"
        else:
            rec = client.create_dns_record(zone_id, body)
            action = "created"

        profile["record_id"] = rec.get("id") or ""
        profile["last_ip"] = new_ip
        profile["last_run"] = time.time()
        profile["last_status"] = action
        profile["last_error"] = ""
        store["ddns_profiles"][idx] = profile
        _save_store(store)
        return {"status": action, "ip": new_ip, "record_id": profile["record_id"]}
    except Exception as exc:
        profile["last_run"] = time.time()
        profile["last_status"] = "error"
        profile["last_error"] = str(exc)
        store["ddns_profiles"][idx] = profile
        _save_store(store)
        raise
    finally:
        client.close()


def run_all_ddns() -> List[Dict[str, Any]]:
    results = []
    for p in list_ddns_profiles():
        if not p.get("enabled"):
            continue
        try:
            out = run_ddns_profile(p["id"])
            results.append({"id": p["id"], "name": p.get("name"), "ok": True, **out})
        except Exception as exc:
            results.append({"id": p["id"], "name": p.get("name"), "ok": False, "error": str(exc)})
    return results


def sync_crontab() -> None:
    if IS_WINDOWS or not shutil.which("crontab"):
        return
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    python_bin = _resolve_python_bin()
    run_script = str(RUN_UPDATE_SCRIPT)

    res = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    current = res.stdout if res.returncode == 0 else ""
    lines = current.splitlines()
    clean: List[str] = []
    in_block = False
    for line in lines:
        if line.strip() == CRON_TAG_START:
            in_block = True
            continue
        if line.strip() == CRON_TAG_END:
            in_block = False
            continue
        if in_block:
            continue
        if _is_orphan_ddns_cron_line(line):
            continue
        clean.append(line)

    block = [CRON_TAG_START]
    intervals = sorted(
        {
            int(p.get("interval_minutes") or 5)
            for p in list_ddns_profiles()
            if p.get("enabled")
        }
    )
    for minutes in intervals:
        log_file = LOG_DIR / f"cloudflare_ddns_{minutes}m.log"
        cmd = (
            f"*/{minutes} * * * * PATH={DEFAULT_CRON_PATH} "
            f"{shlex.quote(python_bin)} {shlex.quote(run_script)} --interval {minutes} "
            f">> {shlex.quote(str(log_file))} 2>&1"
        )
        block.append(cmd)
    block.append(CRON_TAG_END)

    if len(block) > 2:
        clean.extend(block)

    proc = subprocess.run(["crontab", "-"], input="\n".join(clean).rstrip() + "\n", text=True, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "").strip() or "crontab write failed")


def run_ddns_for_interval(interval_minutes: int) -> None:
    for p in list_ddns_profiles():
        if not p.get("enabled"):
            continue
        if int(p.get("interval_minutes") or 5) != int(interval_minutes):
            continue
        try:
            run_ddns_profile(p["id"])
        except Exception:
            pass


# --- Cloudflare Tunnel ---

def list_tunnels() -> List[Dict[str, Any]]:
    store = _load_store()
    account_id = store.get("account_id") or ""
    if not account_id:
        raise ValueError("account_id is not configured. Verify API token first.")
    client = _client_from_store()
    try:
        tunnels = client.list_tunnels(account_id)
        local = store.get("tunnel_local") or {}
        out = []
        for t in tunnels:
            tid = t.get("id") or ""
            out.append({
                "id": tid,
                "name": t.get("name"),
                "status": t.get("status"),
                "created_at": t.get("created_at"),
                "connections": t.get("connections") or [],
                "local_configured": tid in local,
            })
        return out
    finally:
        client.close()


def _write_tunnel_credentials(tunnel_id: str, credentials: Dict[str, Any]) -> Path:
    CF_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    cred_path = CF_CONFIG_DIR / f"{tunnel_id}.json"
    cred_path.write_text(json.dumps(credentials, indent=2), encoding="utf-8")
    try:
        os.chmod(cred_path, 0o600)
    except Exception:
        pass
    return cred_path


def create_tunnel(name: str) -> Dict[str, Any]:
    store = _load_store()
    account_id = store.get("account_id") or ""
    if not account_id:
        raise ValueError("account_id is not configured.")
    client = _client_from_store()
    try:
        tunnel = client.create_tunnel(account_id, name.strip())
        tid = tunnel.get("id") or ""
        creds = tunnel.get("credentials_file") or {}
        if tid and creds:
            _write_tunnel_credentials(tid, creds)
        return {"id": tid, "name": tunnel.get("name"), "status": tunnel.get("status")}
    finally:
        client.close()


def delete_tunnel(tunnel_id: str) -> bool:
    store = _load_store()
    account_id = store.get("account_id") or ""
    client = _client_from_store()
    try:
        client.delete_tunnel(account_id, tunnel_id)
    finally:
        client.close()
    local = store.get("tunnel_local") or {}
    if tunnel_id in local:
        del local[tunnel_id]
        store["tunnel_local"] = local
        _save_store(store)
    cred = CF_CONFIG_DIR / f"{tunnel_id}.json"
    cfg = CF_CONFIG_DIR / "config.yml"
    for path in (cred, cfg):
        try:
            if path.exists():
                path.unlink()
        except Exception:
            pass
    return True


def get_tunnel_local_config(tunnel_id: str) -> Dict[str, Any]:
    store = _load_store()
    local = store.get("tunnel_local") or {}
    entry = local.get(tunnel_id) or {}
    cfg_path = CF_CONFIG_DIR / "config.yml"
    content = ""
    if cfg_path.exists():
        try:
            content = cfg_path.read_text(encoding="utf-8")
        except Exception:
            content = ""
    return {
        "tunnel_id": tunnel_id,
        "tunnel_name": entry.get("tunnel_name") or "",
        "ingress": entry.get("ingress") or [],
        "config_path": str(cfg_path),
        "config_content": content,
    }


def save_tunnel_local_config(tunnel_id: str, tunnel_name: str, ingress: List[Dict[str, Any]]) -> Dict[str, Any]:
    store = _load_store()
    cred_path = CF_CONFIG_DIR / f"{tunnel_id}.json"
    if not cred_path.exists():
        raise ValueError("Tunnel credentials missing. Create the tunnel first or reinstall credentials.")

    rules = ingress or [{"hostname": "", "service": "http_status:404"}]
    yaml_lines = [
        f"tunnel: {tunnel_id}",
        f"credentials-file: {cred_path}",
        "ingress:",
    ]
    for rule in rules:
        hostname = (rule.get("hostname") or "").strip()
        service = (rule.get("service") or "http_status:404").strip()
        path = (rule.get("path") or "").strip()
        yaml_lines.append("  -")
        if hostname:
            yaml_lines.append(f"    hostname: {hostname}")
        if path:
            yaml_lines.append(f"    path: {path}")
        yaml_lines.append(f"    service: {service}")

    cfg_path = CF_CONFIG_DIR / "config.yml"
    cfg_path.write_text("\n".join(yaml_lines) + "\n", encoding="utf-8")

    local = store.get("tunnel_local") or {}
    local[tunnel_id] = {
        "tunnel_name": tunnel_name,
        "ingress": rules,
        "updated_at": time.time(),
    }
    store["tunnel_local"] = local
    _save_store(store)

    return get_tunnel_local_config(tunnel_id)


def tunnel_service_status() -> Dict[str, Any]:
    cloudflared = _resolve_cloudflared_bin()
    if IS_WINDOWS:
        return {"installed": bool(cloudflared), "running": False, "active": False, "message": "Windows dev mode"}
    if not cloudflared:
        return {"installed": False, "running": False, "active": False, "message": "cloudflared not installed"}

    running = False
    active = False
    message = ""
    try:
        proc = subprocess.run(
            ["systemctl", "is-active", "cloudflared"],
            capture_output=True,
            text=True,
        )
        active = proc.stdout.strip() == "active"
        running = active
        message = proc.stdout.strip() or proc.stderr.strip()
    except Exception as exc:
        message = str(exc)
    return {
        "installed": True,
        "cloudflared_path": cloudflared,
        "running": running,
        "active": active,
        "message": message,
        "config_dir": str(CF_CONFIG_DIR),
    }


def install_tunnel_service(tunnel_id: str) -> Dict[str, Any]:
    if IS_WINDOWS:
        raise ValueError("Tunnel service install is only supported on Linux.")
    cloudflared = _resolve_cloudflared_bin()
    if not cloudflared:
        raise ValueError("cloudflared binary not found. Install cloudflared first.")

    cfg_path = CF_CONFIG_DIR / "config.yml"
    cred_path = CF_CONFIG_DIR / f"{tunnel_id}.json"
    if not cfg_path.exists() or not cred_path.exists():
        raise ValueError("Tunnel config not saved yet. Save ingress config first.")

    store = _load_store()
    account_id = store.get("account_id") or ""
    client = _client_from_store()
    try:
        token = client.get_tunnel_token(account_id, tunnel_id)
    finally:
        client.close()

    proc = subprocess.run(
        [cloudflared, "service", "install", token],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(err or "cloudflared service install failed")

    subprocess.run(["systemctl", "enable", "cloudflared"], check=False, capture_output=True)
    subprocess.run(["systemctl", "restart", "cloudflared"], check=False, capture_output=True)
    return tunnel_service_status()
