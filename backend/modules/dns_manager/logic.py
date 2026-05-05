"""
DNS Manager logic.

Two backends are supported:
    - ``"local"``: a JSON-on-disk store useful for self-hosted users that
      delegate DNS to an external provider (Cloudflare, Route53...) and
      simply want a pretty zone editor inside the panel.
    - ``"bind"``: optional minimal write to ``/etc/bind/zones/`` zone files
      when the BIND9 server is detected on the host. Reload happens via
      ``rndc reload``.

The default backend is ``"local"`` so the module works out of the box on
any system; admins flip to BIND once their server is set up.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

IS_WINDOWS = os.name == "nt"

STORE_PATH = (
    Path("./test_nginx/dns_zones.json")
    if IS_WINDOWS
    else Path("/var/lib/copanel/dns_zones.json")
)

VALID_RECORD_TYPES = {"A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"}


def _new_id(prefix: str) -> str:
    return f"{prefix}_{time.time_ns()}"


@dataclass
class Record:
    id: str
    type: str
    name: str
    value: str
    ttl: int = 300
    priority: Optional[int] = None


@dataclass
class Zone:
    id: str
    domain: str
    backend: str = "local"
    records: List[Record] = field(default_factory=list)
    updated_at: float = field(default_factory=lambda: time.time())


def _load_store() -> Dict[str, Any]:
    if not STORE_PATH.exists():
        STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        STORE_PATH.write_text(json.dumps({"zones": []}), encoding="utf-8")
    try:
        return json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"zones": []}


def _save_store(data: Dict[str, Any]) -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STORE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _zone_to_dict(z: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": z["id"],
        "domain": z["domain"],
        "backend": z.get("backend", "local"),
        "records": z.get("records", []),
        "updated_at": z.get("updated_at"),
    }


def list_zones() -> List[Dict[str, Any]]:
    return [_zone_to_dict(z) for z in _load_store().get("zones", [])]


def get_zone(zone_id: str) -> Optional[Dict[str, Any]]:
    for z in _load_store().get("zones", []):
        if z["id"] == zone_id:
            return _zone_to_dict(z)
    return None


def create_zone(domain: str, backend: str = "local") -> Dict[str, Any]:
    if not domain or "." not in domain:
        raise ValueError("Invalid domain.")
    domain = domain.lower().strip()
    data = _load_store()
    if any(z["domain"] == domain for z in data["zones"]):
        raise ValueError("Zone already exists.")
    zone = {
        "id": _new_id("zone"),
        "domain": domain,
        "backend": backend if backend in {"local", "bind"} else "local",
        "records": [],
        "updated_at": time.time(),
    }
    data["zones"].append(zone)
    _save_store(data)
    return _zone_to_dict(zone)


def delete_zone(zone_id: str) -> bool:
    data = _load_store()
    before = len(data["zones"])
    data["zones"] = [z for z in data["zones"] if z["id"] != zone_id]
    if len(data["zones"]) == before:
        return False
    _save_store(data)
    return True


def add_record(zone_id: str, record: Dict[str, Any]) -> Dict[str, Any]:
    rtype = (record.get("type") or "").upper()
    if rtype not in VALID_RECORD_TYPES:
        raise ValueError(f"Unsupported record type '{rtype}'.")
    name = record.get("name") or "@"
    value = record.get("value")
    if not value:
        raise ValueError("Record value is required.")

    data = _load_store()
    for z in data["zones"]:
        if z["id"] == zone_id:
            new_record = {
                "id": _new_id("rec"),
                "type": rtype,
                "name": name,
                "value": value,
                "ttl": int(record.get("ttl") or 300),
                "priority": record.get("priority"),
            }
            z["records"].append(new_record)
            z["updated_at"] = time.time()
            _save_store(data)
            if z["backend"] == "bind":
                _try_render_bind_zone(z)
            return new_record
    raise ValueError("Zone not found.")


def delete_record(zone_id: str, record_id: str) -> bool:
    data = _load_store()
    for z in data["zones"]:
        if z["id"] == zone_id:
            before = len(z["records"])
            z["records"] = [r for r in z["records"] if r["id"] != record_id]
            if len(z["records"]) == before:
                return False
            z["updated_at"] = time.time()
            _save_store(data)
            if z["backend"] == "bind":
                _try_render_bind_zone(z)
            return True
    return False


def _try_render_bind_zone(zone: Dict[str, Any]) -> None:
    """Best-effort writer for BIND9. Silently no-ops when BIND is missing."""
    if IS_WINDOWS or not shutil.which("named") and not Path("/etc/bind").exists():
        return
    zones_dir = Path("/etc/bind/zones")
    try:
        zones_dir.mkdir(parents=True, exist_ok=True)
        path = zones_dir / f"db.{zone['domain']}"
        lines = [
            "$TTL 300",
            f"@   IN  SOA ns1.{zone['domain']}. admin.{zone['domain']}. (",
            f"        {int(time.time())} 3600 600 86400 300 )",
            "    IN  NS  ns1.",
        ]
        for r in zone.get("records", []):
            extra = ""
            if r["type"] == "MX" and r.get("priority"):
                extra = f"{r['priority']} "
            lines.append(f"{r['name']:<20} {r['ttl']}    IN  {r['type']:<6} {extra}{r['value']}")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        if shutil.which("rndc"):
            subprocess.run(["sudo", "rndc", "reload"], check=False, capture_output=True)
    except Exception:
        pass
