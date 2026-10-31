"""
Cloudflare DDNS + DNS record + Tunnel management.

Persists settings under /opt/copanel/config/cloudflare_ddns.json and syncs DDNS
jobs to system crontab (Linux only).
"""
from __future__ import annotations

import base64
from contextlib import contextmanager
import json
import logging
import os
import re
import shlex
import shutil
import signal
import socket
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple
from urllib.request import Request, urlopen

import httpx

from .cron_compat import ensure_cron_service, get_cron_daemon_status

try:
    import fcntl
except ImportError:
    fcntl = None  # type: ignore[assignment]

IS_WINDOWS = os.name == "nt"

CONFIG_DIR = Path("./test_copanel/config") if IS_WINDOWS else Path("/opt/copanel/config")
STORE_PATH = CONFIG_DIR / "cloudflare_ddns.json"
LEGACY_STORE_PATHS = (
    Path("/var/lib/copanel/cloudflare_ddns.json"),
    Path("/opt/copanel/data/cloudflare_ddns.json"),
)
CF_CONFIG_DIR = (
    Path("./test_nginx/cloudflared")
    if IS_WINDOWS
    else Path("/etc/cloudflared")
)
LOG_DIR = Path("./test_nginx/logs") if IS_WINDOWS else Path("/opt/copanel/logs")
LOCK_DIR = CONFIG_DIR / "locks"
BACKEND_ROOT = Path("/opt/copanel/backend") if not IS_WINDOWS else Path(__file__).resolve().parents[2]
RUN_UPDATE_SCRIPT = BACKEND_ROOT / "modules" / "cloudflare_ddns" / "run_update.py"
CRON_TAG_START = "# BEGIN COPANEL CLOUDFLARE DDNS"
CRON_TAG_END = "# END COPANEL CLOUDFLARE DDNS"
DDNS_CRON_MARKER = "modules.cloudflare_ddns.run_update"
DEFAULT_CRON_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

MIN_INTERVAL_MINUTES = 1
MAX_INTERVAL_MINUTES = 1440
DEFAULT_INTERVAL_MINUTES = 5
MIN_WORKER_INTERVAL_SECONDS = 60
MAX_WORKER_BACKOFF_SECONDS = 3600
BASE_WORKER_BACKOFF_SECONDS = 60
SUBPROCESS_TIMEOUT_SECONDS = 15

logger = logging.getLogger(__name__)

CF_API = "https://api.cloudflare.com/client/v4"
PUBLIC_IP_URLS = (
    "https://api.ipify.org",
    "https://ifconfig.me/ip",
    "https://icanhazip.com",
)

TUNNEL_PERM_HINT = (
    "API token needs Account → Cloudflare Tunnel → Edit, "
    "and Account → Account Settings → Read (or paste Account ID manually)."
)


class CloudflareAPIError(Exception):
    """Raised when Cloudflare's API returns a non-success response."""

    def __init__(self, message: str, *, status_code: int = 0, errors: Optional[List[Any]] = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.errors = errors or []


class WorkerAlreadyRunningError(RuntimeError):
    """Raised when another run_update.py worker already holds the single-instance lock."""


def normalize_interval_minutes(raw: Any, default: int = DEFAULT_INTERVAL_MINUTES) -> int:
    """Clamp interval_minutes to [1, 1440] (minimum 60s between DDNS runs)."""
    try:
        val = int(raw)
    except (TypeError, ValueError):
        val = default
    if val <= 0:
        val = max(MIN_INTERVAL_MINUTES, default)
    return max(MIN_INTERVAL_MINUTES, min(MAX_INTERVAL_MINUTES, val))


def interval_minutes_to_seconds(interval_minutes: Any) -> int:
    """Convert interval in minutes to seconds, enforcing MIN_WORKER_INTERVAL_SECONDS (>= 60s)."""
    minutes = normalize_interval_minutes(interval_minutes, default=MIN_INTERVAL_MINUTES)
    return max(MIN_WORKER_INTERVAL_SECONDS, minutes * 60)


def compute_backoff_seconds(
    base_interval_seconds: int,
    consecutive_failures: int,
    *,
    base_backoff: int = BASE_WORKER_BACKOFF_SECONDS,
    max_backoff: int = MAX_WORKER_BACKOFF_SECONDS,
) -> int:
    """Compute sleep duration in seconds with exponential backoff on consecutive failures."""
    safe_base = max(MIN_WORKER_INTERVAL_SECONDS, int(base_interval_seconds or 0))
    if consecutive_failures <= 0:
        return safe_base
    exponent = min(int(consecutive_failures) - 1, 10)
    backoff = max(MIN_WORKER_INTERVAL_SECONDS, int(base_backoff)) * (2 ** exponent)
    return min(int(max_backoff), max(safe_base, backoff))


def _worker_lock_path(scope: str = "all") -> Path:
    safe_scope = re.sub(r"[^a-zA-Z0-9_-]", "_", str(scope or "all"))
    return LOCK_DIR / f"cloudflare_ddns_worker_{safe_scope}.lock"


@contextmanager
def acquire_worker_lock(scope: str = "all", lock_dir: Optional[Path] = None) -> Iterator[Path]:
    """Acquire a non-blocking exclusive flock so duplicate run_update.py workers cannot coexist."""
    target_dir = lock_dir if lock_dir is not None else LOCK_DIR
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        target_dir = Path("/tmp/copanel_locks")
        target_dir.mkdir(parents=True, exist_ok=True)

    safe_scope = re.sub(r"[^a-zA-Z0-9_-]", "_", str(scope or "all"))
    lock_path = target_dir / f"cloudflare_ddns_worker_{safe_scope}.lock"

    fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o600)
    locked = False
    try:
        if fcntl is not None:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
            except BlockingIOError as exc:
                raise WorkerAlreadyRunningError(
                    f"Another Cloudflare DDNS worker is already running for scope '{safe_scope}' ({lock_path})."
                ) from exc
        else:
            locked = True

        try:
            os.ftruncate(fd, 0)
            os.write(
                fd,
                json.dumps({"pid": os.getpid(), "scope": safe_scope, "started_at": time.time()}).encode("utf-8"),
            )
        except OSError:
            pass

        yield lock_path
    finally:
        if locked and fcntl is not None:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            except OSError:
                pass
        try:
            os.close(fd)
        except OSError:
            pass


def terminate_duplicate_workers(
    *,
    exclude_pids: Optional[set[int]] = None,
    proc_root: Path = Path("/proc"),
    kill_fn: Optional[Callable[[int, int], None]] = None,
) -> List[int]:
    """Find and terminate orphan/duplicate run_update.py processes on Linux via /proc."""
    if IS_WINDOWS or not proc_root.is_dir():
        return []
    excluded = set(exclude_pids or set())
    excluded.add(os.getpid())
    killer = kill_fn or os.kill
    terminated: List[int] = []

    try:
        entries = list(proc_root.iterdir())
    except OSError:
        return []

    for entry in entries:
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        if pid in excluded:
            continue
        cmdline_file = entry / "cmdline"
        try:
            raw = cmdline_file.read_bytes()
        except OSError:
            continue
        if not raw:
            continue
        parts = [p.decode("utf-8", errors="ignore") for p in raw.split(b"\x00") if p]
        if not parts:
            continue
        joined = " ".join(parts)
        if "cloudflare_ddns" in joined and "run_update" in joined:
            try:
                killer(pid, signal.SIGTERM)
                terminated.append(pid)
            except OSError:
                continue

    return terminated


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


def _ensure_store_permissions() -> None:
    """Keep config dir traversable and store file root-only (matches copanel service user)."""
    if IS_WINDOWS:
        return
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        os.chmod(CONFIG_DIR, 0o755)
        if STORE_PATH.is_file():
            os.chmod(STORE_PATH, 0o600)
    except OSError as exc:
        logger.warning("Could not set permissions on %s: %s", STORE_PATH, exc)


def _migrate_legacy_store() -> None:
    """Copy settings from older paths if the canonical store is missing or empty."""
    if IS_WINDOWS:
        return
    current_token = ""
    if STORE_PATH.is_file():
        try:
            current_token = (json.loads(STORE_PATH.read_text(encoding="utf-8")) or {}).get("api_token") or ""
        except OSError:
            current_token = ""
        except Exception:
            current_token = ""
    if current_token:
        return
    for legacy in LEGACY_STORE_PATHS:
        if not legacy.is_file() or legacy.resolve() == STORE_PATH.resolve():
            continue
        try:
            data = json.loads(legacy.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not (data.get("api_token") or data.get("ddns_profiles")):
            continue
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(legacy, STORE_PATH)
        _ensure_store_permissions()
        logger.info("Migrated Cloudflare DDNS store from %s to %s", legacy, STORE_PATH)
        return


def repair_store_on_startup() -> None:
    """Migrate legacy store paths, fix permissions, and clean up any hung run_update.py workers."""
    _migrate_legacy_store()
    _ensure_store_permissions()
    killed = terminate_duplicate_workers()
    if killed:
        logger.warning("Terminated %d stale Cloudflare DDNS run_update.py worker(s): %s", len(killed), killed)


def _load_store() -> Dict[str, Any]:
    _migrate_legacy_store()
    if not STORE_PATH.exists():
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        STORE_PATH.write_text(json.dumps(_default_store(), indent=2), encoding="utf-8")
        _ensure_store_permissions()
    try:
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except PermissionError as exc:
        raise PermissionError(
            f"Cannot read {STORE_PATH}: {exc}. "
            "Cron and CLI must run as root (same as copanel service). "
            "Manual test: sudo /opt/copanel/venv/bin/python .../run_update.py --interval 5"
        ) from exc
    except OSError as exc:
        if getattr(exc, "errno", None) == 13:
            raise PermissionError(
                f"Cannot read {STORE_PATH}: permission denied. "
                "Run as root: sudo systemctl restart copanel, or sudo .../run_update.py"
            ) from exc
        raise
    except Exception as exc:
        logger.warning("Cloudflare store corrupt at %s: %s — using defaults in memory", STORE_PATH, exc)
        data = _default_store()
    for key, val in _default_store().items():
        if key not in data:
            data[key] = val if not isinstance(val, list) else []
    return data


def _save_store(data: Dict[str, Any]) -> None:
    data["updated_at"] = time.time()
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    try:
        STORE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
        _ensure_store_permissions()
    except OSError as exc:
        if getattr(exc, "errno", None) == 13:
            raise PermissionError(
                f"Cannot write {STORE_PATH}: permission denied. "
                "CoPanel cron runs as root — use sudo for manual CLI tests."
            ) from exc
        raise


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
            timeout=httpx.Timeout(20.0, connect=10.0),
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
            msg = ""
            if errors and isinstance(errors[0], dict):
                msg = errors[0].get("message") or ""
            if not msg:
                msg = res.text or "Cloudflare API error"
            raise CloudflareAPIError(msg, status_code=res.status_code, errors=errors)
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
                params={"is_deleted": False, "per_page": 50},
            )
            or []
        )

    def create_tunnel(self, account_id: str, name: str) -> Dict[str, Any]:
        # Cloudflare expects tunnel_secret as base64-encoded 32 bytes.
        secret_b64 = base64.b64encode(os.urandom(32)).decode("ascii")
        tunnel = self._request(
            "POST",
            f"/accounts/{account_id}/cfd_tunnel",
            json={"name": name, "tunnel_secret": secret_b64, "config_src": "local"},
        ) or {}
        tid = tunnel.get("id") or ""
        creds = tunnel.get("credentials_file")
        if tid and not isinstance(creds, dict):
            tunnel["credentials_file"] = {
                "AccountTag": account_id,
                "TunnelID": tid,
                "TunnelSecret": secret_b64,
            }
        return tunnel

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


def _account_from_zones(client: CloudflareClient) -> Tuple[str, str]:
    """Derive account id/name from the first zone (works with many zone-scoped tokens)."""
    try:
        zones = client.list_zones() or []
    except CloudflareAPIError:
        return "", ""
    for zone in zones:
        account = zone.get("account") or {}
        aid = (account.get("id") or "").strip()
        if aid:
            return aid, (account.get("name") or "").strip()
    return "", ""


def _ensure_account_id(store: Optional[Dict[str, Any]] = None, client: Optional[CloudflareClient] = None) -> str:
    """Return a usable Cloudflare account_id, auto-detecting and persisting when missing."""
    own_client = False
    if store is None:
        store = _load_store()
    account_id = (store.get("account_id") or "").strip()
    if account_id:
        return account_id

    if client is None:
        client = CloudflareClient(store.get("api_token") or "")
        own_client = True

    try:
        accounts: List[Dict[str, Any]] = []
        try:
            accounts = client.list_accounts() or []
        except CloudflareAPIError as exc:
            logger.info("list_accounts failed while resolving account_id: %s", exc)

        if accounts:
            account_id = (accounts[0].get("id") or "").strip()
            account_name = (accounts[0].get("name") or "").strip()
        else:
            account_id, account_name = _account_from_zones(client)

        if not account_id:
            raise ValueError(
                "account_id is not configured and could not be auto-detected. "
                f"Paste Account ID on the API tab, then Save & Verify. {TUNNEL_PERM_HINT}"
            )

        store["account_id"] = account_id
        if account_name:
            store["account_name"] = account_name
        _save_store(store)
        return account_id
    finally:
        if own_client:
            client.close()


def _enrich_tunnel_error(exc: Exception) -> Exception:
    """Attach permission guidance to common Cloudflare tunnel failures."""
    msg = str(exc)
    lower = msg.lower()
    if not any(
        needle in lower
        for needle in (
            "authentication",
            "authorization",
            "permission",
            "not authorized",
            "access denied",
            "actor 'com.cloudflare",
            "could not route",
        )
    ):
        return exc
    enriched = f"{msg} — {TUNNEL_PERM_HINT}"
    if isinstance(exc, CloudflareAPIError):
        return CloudflareAPIError(enriched, status_code=exc.status_code, errors=exc.errors)
    return ValueError(enriched)


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
        "store_path": str(STORE_PATH),
        "updated_at": store.get("updated_at"),
    }


def save_config(api_token: Optional[str] = None, account_id: Optional[str] = None) -> Dict[str, Any]:
    store = _load_store()
    if api_token is not None and api_token.strip():
        store["api_token"] = api_token.strip()
    if account_id is not None:
        stripped = account_id.strip()
        # Empty string means "keep existing / auto-detect" — do not wipe a known account_id.
        if stripped:
            store["account_id"] = stripped
    _save_store(store)
    if store.get("api_token"):
        try:
            verify_config()
        except Exception:
            pass
    _safe_sync_crontab()
    return get_public_config()


def verify_config() -> Dict[str, Any]:
    store = _load_store()
    client = CloudflareClient(store.get("api_token") or "")
    try:
        verify = client.verify_token()
        accounts: List[Dict[str, Any]] = []
        try:
            accounts = client.list_accounts() or []
        except CloudflareAPIError as exc:
            logger.info("list_accounts failed during verify: %s", exc)
            accounts = []

        if not store.get("account_id") and accounts:
            store["account_id"] = accounts[0].get("id") or ""
            store["account_name"] = accounts[0].get("name") or ""
            _save_store(store)
        elif store.get("account_id"):
            matched = False
            for acc in accounts:
                if acc.get("id") == store["account_id"]:
                    store["account_name"] = acc.get("name") or ""
                    _save_store(store)
                    matched = True
                    break
            if not matched and not store.get("account_name"):
                # Keep existing account_id even if /accounts is empty (zone-scoped token).
                pass
        elif not store.get("account_id"):
            aid, aname = _account_from_zones(client)
            if aid:
                store["account_id"] = aid
                store["account_name"] = aname
                _save_store(store)

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


def _safe_sync_crontab() -> Dict[str, Any]:
    """Sync crontab after profile changes; never abort the CRUD response on cron errors."""
    try:
        return sync_crontab()
    except Exception as exc:
        logger.warning("Cloudflare DDNS cron sync after profile change failed: %s", exc)
        return {"ok": False, "message": str(exc), "entries": 0}


def create_ddns_profile(data: Dict[str, Any]) -> Dict[str, Any]:
    store = _load_store()
    name = (data.get("name") or "").strip()
    if not name:
        raise ValueError("Profile name is required.")
    zone_id = (data.get("zone_id") or "").strip()
    if not zone_id:
        raise ValueError("zone_id is required.")
    record_name = (data.get("record_name") or "@").strip() or "@"
    raw_interval = data.get("interval_minutes")
    interval = int(raw_interval) if raw_interval is not None else DEFAULT_INTERVAL_MINUTES
    if interval < MIN_INTERVAL_MINUTES or interval > MAX_INTERVAL_MINUTES:
        raise ValueError(f"interval_minutes must be between {MIN_INTERVAL_MINUTES} and {MAX_INTERVAL_MINUTES}.")
    profile = {
        "id": _new_id("ddns"),
        "name": name,
        "zone_id": zone_id,
        "zone_name": data.get("zone_name") or "",
        "record_name": record_name,
        "record_type": (data.get("record_type") or "A").upper(),
        "proxied": bool(data.get("proxied")),
        "ttl": int(data.get("ttl") or 1),
        "ip_source": data.get("ip_source") or "public",
        "interface_name": data.get("interface_name") or "",
        "custom_ip_url": data.get("custom_ip_url") or "",
        "interval_minutes": interval,
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
    _safe_sync_crontab()
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
            elif key == "interval_minutes":
                interval = int(data[key])
                if interval < MIN_INTERVAL_MINUTES or interval > MAX_INTERVAL_MINUTES:
                    raise ValueError(
                        f"interval_minutes must be between {MIN_INTERVAL_MINUTES} and {MAX_INTERVAL_MINUTES}."
                    )
                profile[key] = interval
            elif key == "ttl":
                profile[key] = int(data[key])
            elif key == "record_type":
                profile[key] = str(data[key]).upper()
            elif key == "record_name":
                profile[key] = str(data[key]).strip() or "@"
            else:
                profile[key] = data[key]
    profile["updated_at"] = time.time()
    store["ddns_profiles"][idx] = profile
    _save_store(store)
    _safe_sync_crontab()
    return profile


def delete_ddns_profile(profile_id: str) -> bool:
    store = _load_store()
    before = len(store.get("ddns_profiles") or [])
    store["ddns_profiles"] = [p for p in store.get("ddns_profiles") or [] if p.get("id") != profile_id]
    if len(store["ddns_profiles"]) == before:
        return False
    _save_store(store)
    _safe_sync_crontab()
    return True


def _fetch_url_ip(url: str) -> str:
    req = Request(url, headers={"User-Agent": "CoPanel-CloudflareDDNS/1.0"})
    with urlopen(req, timeout=10) as resp:
        ip = resp.read(256).decode("utf-8", errors="ignore").strip()
    if not ip or len(ip) > 64 or not re.match(r"^[\da-fA-F:.]+$", ip):
        raise ValueError(f"Invalid IP from URL: {ip[:64]}")
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
        timeout=SUBPROCESS_TIMEOUT_SECONDS,
        shell=False,
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
    try:
        client = CloudflareClient(store.get("api_token") or "")
    except Exception as exc:
        profile["last_run"] = time.time()
        profile["last_status"] = "error"
        profile["last_error"] = str(exc)
        store["ddns_profiles"][idx] = profile
        _save_store(store)
        raise

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


def _persist_scheduler_sync(status: Dict[str, Any]) -> None:
    store = _load_store()
    store["scheduler_sync"] = {**status, "at": time.time()}
    _save_store(store)


def _ensure_cron_service() -> None:
    ensure_cron_service()


def _ensure_crontab() -> Tuple[bool, str]:
    """Install cron package when crontab binary is missing."""
    if shutil.which("crontab"):
        _ensure_cron_service()
        return True, ""
    if IS_WINDOWS:
        return False, "Windows has no crontab."
    if shutil.which("apt-get"):
        env = {**os.environ, "DEBIAN_FRONTEND": "noninteractive"}
        if os.geteuid() == 0:
            cmd = ["apt-get", "install", "-y", "cron"]
        else:
            cmd = ["sudo", "-n", "DEBIAN_FRONTEND=noninteractive", "apt-get", "install", "-y", "cron"]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600, env=env, shell=False)
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip()
            return False, f"apt install cron failed: {err or proc.returncode}"
        _ensure_cron_service()
        if shutil.which("crontab"):
            return True, "Installed cron package."
        return False, "cron package installed but crontab still missing."
    return False, "Install cron: apt install cron && systemctl enable --now cron"


def _cron_schedule_for_minutes(minutes: int) -> str:
    """Return a valid 5-field cron schedule expression for interval in minutes."""
    safe = normalize_interval_minutes(minutes)
    if safe <= 1:
        return "* * * * *"
    if safe < 60:
        return f"*/{safe} * * * *"
    if safe == 60:
        return "0 * * * *"
    hours = max(1, min(23, safe // 60))
    if safe >= 1440:
        return "0 0 * * *"
    return f"0 */{hours} * * *"


def sync_crontab() -> Dict[str, Any]:
    """Write DDNS jobs to user crontab. Installs cron package on Debian if needed."""
    profiles = list_ddns_profiles()
    enabled = [p for p in profiles if p.get("enabled")]
    result: Dict[str, Any] = {"ok": False, "entries": 0, "message": "", "installed_cron": False}

    if IS_WINDOWS:
        result["message"] = "Cron not available on Windows."
        _persist_scheduler_sync(result)
        return result

    terminate_duplicate_workers()

    ok_crontab, install_msg = _ensure_crontab()
    if not ok_crontab:
        result["message"] = install_msg
        _persist_scheduler_sync(result)
        logger.warning("Cloudflare DDNS cron sync skipped: %s", install_msg)
        return result
    if install_msg:
        result["installed_cron"] = True

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    python_bin = _resolve_python_bin()
    run_script = str(RUN_UPDATE_SCRIPT)

    res = subprocess.run(
        ["crontab", "-l"],
        capture_output=True,
        text=True,
        timeout=SUBPROCESS_TIMEOUT_SECONDS,
        shell=False,
    )
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
            normalize_interval_minutes(p.get("interval_minutes") or DEFAULT_INTERVAL_MINUTES)
            for p in enabled
        }
    )
    for minutes in intervals:
        log_file = LOG_DIR / f"cloudflare_ddns_{minutes}m.log"
        schedule = _cron_schedule_for_minutes(minutes)
        cmd = (
            f"{schedule} cd {shlex.quote(str(BACKEND_ROOT))} && "
            f"PATH={DEFAULT_CRON_PATH} "
            f"{shlex.quote(python_bin)} {shlex.quote(run_script)} --interval {minutes} "
            f">> {shlex.quote(str(log_file))} 2>&1"
        )
        block.append(cmd)
    block.append(CRON_TAG_END)

    if len(block) > 2:
        clean.extend(block)

    proc = subprocess.run(
        ["crontab", "-"],
        input="\n".join(clean).rstrip() + "\n",
        text=True,
        capture_output=True,
        timeout=SUBPROCESS_TIMEOUT_SECONDS,
        shell=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip() or "crontab write failed"
        result["message"] = err
        _persist_scheduler_sync(result)
        raise RuntimeError(err)

    result["ok"] = True
    result["entries"] = len(intervals)
    ensure_cron_service()
    result["message"] = (
        f"Synced {len(intervals)} cron interval(s)."
        if intervals
        else "No enabled profiles — cron block cleared."
    )
    _persist_scheduler_sync(result)
    logger.info("Cloudflare DDNS cron sync: %s", result["message"])
    return result


def get_cron_status() -> Dict[str, Any]:
    """Report crontab entries and log tails for DDNS scheduler."""
    profiles = list_ddns_profiles()
    enabled = [p for p in profiles if p.get("enabled")]
    intervals = sorted(
        {
            normalize_interval_minutes(p.get("interval_minutes") or DEFAULT_INTERVAL_MINUTES)
            for p in enabled
        }
    )

    if IS_WINDOWS:
        return {
            "supported": False,
            "enabled_profiles": len(enabled),
            "intervals_minutes": intervals,
            "message": "Cron sync is Linux-only.",
        }

    has_crontab = bool(shutil.which("crontab"))
    daemon = get_cron_daemon_status()
    cron_lines: List[str] = []
    if has_crontab:
        res = subprocess.run(
            ["crontab", "-l"],
            capture_output=True,
            text=True,
            timeout=SUBPROCESS_TIMEOUT_SECONDS,
            shell=False,
        )
        if res.returncode == 0:
            in_block = False
            for line in res.stdout.splitlines():
                if line.strip() == CRON_TAG_START:
                    in_block = True
                    continue
                if line.strip() == CRON_TAG_END:
                    in_block = False
                    continue
                if in_block and line.strip():
                    cron_lines.append(line.strip())

    log_files: List[Dict[str, Any]] = []
    for minutes in intervals:
        lf = LOG_DIR / f"cloudflare_ddns_{minutes}m.log"
        entry: Dict[str, Any] = {"interval_minutes": minutes, "path": str(lf), "exists": lf.is_file()}
        if lf.is_file():
            try:
                entry["tail"] = lf.read_text(encoding="utf-8", errors="ignore").splitlines()[-8:]
            except OSError:
                entry["tail"] = []
        log_files.append(entry)

    expected_entries = len(intervals)
    store = _load_store()
    scheduler_sync = store.get("scheduler_sync") or {}
    install_hint = ""
    if not has_crontab:
        install_hint = "Chạy: apt install cron && systemctl enable --now cron — hoặc bấm «Cài cron & sync» trên panel."
    elif not daemon.get("active"):
        install_hint = "Crontab có dòng cron nhưng daemon cron chưa chạy. Bấm «Cài cron & sync» hoặc: systemctl enable --now cron"

    return {
        "supported": True,
        "crontab_available": has_crontab,
        "cron_daemon": daemon,
        "cron_service_active": bool(daemon.get("active")),
        "install_hint": install_hint,
        "scheduler_sync": scheduler_sync,
        "run_script": str(RUN_UPDATE_SCRIPT),
        "run_script_exists": RUN_UPDATE_SCRIPT.is_file(),
        "python_bin": _resolve_python_bin(),
        "cron_entries": cron_lines,
        "intervals_minutes": intervals,
        "enabled_profiles": len(enabled),
        "profiles_by_interval": {
            str(m): [
                p.get("name")
                for p in enabled
                if normalize_interval_minutes(p.get("interval_minutes") or DEFAULT_INTERVAL_MINUTES) == m
            ]
            for m in intervals
        },
        "log_files": log_files,
        "sync_ok": has_crontab and daemon.get("active") and ((not enabled) or (expected_entries > 0 and len(cron_lines) == expected_entries)),
    }


def run_ddns_for_interval(interval_minutes: int) -> List[Dict[str, Any]]:
    target = normalize_interval_minutes(interval_minutes)
    results: List[Dict[str, Any]] = []
    for p in list_ddns_profiles():
        if not p.get("enabled"):
            continue
        if normalize_interval_minutes(p.get("interval_minutes") or DEFAULT_INTERVAL_MINUTES) != target:
            continue
        pid = p.get("id") or ""
        name = p.get("name") or pid
        try:
            out = run_ddns_profile(pid)
            results.append({"ok": True, "id": pid, "name": name, **out})
        except Exception as exc:
            results.append({"ok": False, "id": pid, "name": name, "error": str(exc)})
    return results


# --- Cloudflare Tunnel ---

def list_tunnels() -> List[Dict[str, Any]]:
    store = _load_store()
    client = _client_from_store()
    try:
        account_id = _ensure_account_id(store, client)
        try:
            tunnels = client.list_tunnels(account_id)
        except CloudflareAPIError as exc:
            raise _enrich_tunnel_error(exc) from exc
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
    client = _client_from_store()
    try:
        account_id = _ensure_account_id(store, client)
        try:
            tunnel = client.create_tunnel(account_id, name.strip())
        except CloudflareAPIError as exc:
            raise _enrich_tunnel_error(exc) from exc
        tid = tunnel.get("id") or ""
        creds = tunnel.get("credentials_file") or {}
        if tid and creds:
            _write_tunnel_credentials(tid, creds)
        elif tid:
            logger.warning("Tunnel %s created without credentials_file in API response", tid)
        return {"id": tid, "name": tunnel.get("name"), "status": tunnel.get("status")}
    finally:
        client.close()


def delete_tunnel(tunnel_id: str) -> bool:
    store = _load_store()
    client = _client_from_store()
    try:
        account_id = _ensure_account_id(store, client)
        try:
            client.delete_tunnel(account_id, tunnel_id)
        except CloudflareAPIError as exc:
            raise _enrich_tunnel_error(exc) from exc
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
            timeout=SUBPROCESS_TIMEOUT_SECONDS,
            shell=False,
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
    client = _client_from_store()
    try:
        account_id = _ensure_account_id(store, client)
        try:
            token = client.get_tunnel_token(account_id, tunnel_id)
        except CloudflareAPIError as exc:
            raise _enrich_tunnel_error(exc) from exc
    finally:
        client.close()

    proc = subprocess.run(
        [cloudflared, "service", "install", token],
        capture_output=True,
        text=True,
        timeout=SUBPROCESS_TIMEOUT_SECONDS,
        shell=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(err or "cloudflared service install failed")

    subprocess.run(
        ["systemctl", "enable", "cloudflared"],
        check=False,
        capture_output=True,
        timeout=SUBPROCESS_TIMEOUT_SECONDS,
        shell=False,
    )
    subprocess.run(
        ["systemctl", "restart", "cloudflared"],
        check=False,
        capture_output=True,
        timeout=SUBPROCESS_TIMEOUT_SECONDS,
        shell=False,
    )
    return tunnel_service_status()
