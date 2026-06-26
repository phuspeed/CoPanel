"""
Download Manager — task queue, settings, URL resolvers, file-hosting plugins.

Features:
  - temp folder (in-progress chunks)
  - destination folder (final files)
  - user-defined file hosting (curl template or API resolver + accounts)
"""
from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import sqlite3
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError as UrlHTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from .aria2_engine import Aria2Engine, get_engine_from_settings, parse_aria2_progress
from .google_oauth import GoogleOAuthService

IS_WINDOWS = os.name == "nt"
CONFIG_DIR = Path("./test_nginx/download_manager") if IS_WINDOWS else Path("/opt/copanel/config/download_manager")
DB_PATH = CONFIG_DIR / "download_manager.db"
WATCHED_SEEN_FILE = CONFIG_DIR / "watched_seen.json"

DEFAULT_SETTINGS: Dict[str, Any] = {
    "temp_folder": str(Path("/tmp/copanel-downloads") if not IS_WINDOWS else Path("./test_nginx/download_tmp")),
    "destination_folder": str(Path("/opt/copanel/downloads") if not IS_WINDOWS else Path("./test_nginx/downloads")),
    "max_concurrent": 3,
    "max_download_speed_kbps": 0,
    "max_upload_speed_kbps": 0,
    "watched_folder": "",
    "watched_auto_delete": False,
    "google_api_key": "",
    "google_service_account_json": "",
    "aria2_rpc_host": "127.0.0.1",
    "aria2_rpc_port": 6800,
    "aria2_rpc_secret": "",
}

GOOGLE_DRIVE_FILE_RE = re.compile(
    r"https?://(?:drive|docs)\.google\.com/(?:file/d/|open\?id=|uc\?id=)([a-zA-Z0-9_-]+)"
)
GOOGLE_DRIVE_FOLDER_RE = re.compile(
    r"https?://drive\.google\.com/(?:drive/(?:u/\d+/)?folders/|folderview\?id=)([a-zA-Z0-9_-]+)"
)

_engine_lock = threading.Lock()
_worker_started = False


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _db() -> sqlite3.Connection:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    with _db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS download_tasks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                source_url TEXT,
                source_type TEXT NOT NULL,
                file_hosting_id TEXT,
                account_id TEXT,
                destination TEXT NOT NULL,
                temp_path TEXT,
                status TEXT NOT NULL,
                total_bytes INTEGER DEFAULT 0,
                downloaded_bytes INTEGER DEFAULT 0,
                download_speed INTEGER DEFAULT 0,
                upload_speed INTEGER DEFAULT 0,
                progress REAL DEFAULT 0,
                error_message TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                created_by TEXT,
                meta TEXT
            );
            CREATE TABLE IF NOT EXISTS file_hosting_profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                url_patterns TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                curl_template TEXT,
                api_config TEXT,
                created_at TEXT,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS file_hosting_accounts (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL,
                label TEXT NOT NULL,
                username TEXT,
                password TEXT,
                api_key TEXT,
                cookie TEXT,
                extra TEXT,
                is_default INTEGER DEFAULT 0
            );
            """
        )
        for key, val in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, json.dumps(val)),
            )


def _get_setting(key: str) -> Any:
    with _db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if not row:
        return DEFAULT_SETTINGS.get(key)
    try:
        return json.loads(row["value"])
    except json.JSONDecodeError:
        return row["value"]


def _set_setting(key: str, value: Any) -> None:
    with _db() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )


def get_settings(mask_secrets: bool = True) -> Dict[str, Any]:
    _init_db()
    out = {k: _get_setting(k) for k in DEFAULT_SETTINGS}
    if mask_secrets:
        if out.get("google_api_key"):
            out["google_api_key_set"] = True
            out["google_api_key"] = ""
        if out.get("google_service_account_json"):
            out["google_service_account_set"] = True
            out["google_service_account_json"] = ""
        if out.get("aria2_rpc_secret"):
            out["aria2_rpc_secret_set"] = True
            out["aria2_rpc_secret"] = ""
    out["google_oauth_connected"] = GoogleOAuthService.get_access_token() is not None
    engine = _get_aria2()
    out["aria2_available"] = bool(engine and engine.is_available())
    return out


def save_settings(data: Dict[str, Any]) -> Dict[str, Any]:
    _init_db()
    for key in DEFAULT_SETTINGS:
        if key not in data or data[key] is None:
            continue
        if key in ("google_api_key", "google_service_account_json", "aria2_rpc_secret") and data[key] == "":
            continue
        _set_setting(key, data[key])
    _apply_aria2_speed_limits()
    return get_settings()


def _row_to_task(row: sqlite3.Row) -> Dict[str, Any]:
    meta = {}
    if row["meta"]:
        try:
            meta = json.loads(row["meta"])
        except json.JSONDecodeError:
            meta = {}
    return {
        "id": row["id"],
        "name": row["name"],
        "source_url": row["source_url"],
        "source_type": row["source_type"],
        "file_hosting_id": row["file_hosting_id"],
        "account_id": row["account_id"],
        "destination": row["destination"],
        "temp_path": row["temp_path"],
        "status": row["status"],
        "total_bytes": row["total_bytes"],
        "downloaded_bytes": row["downloaded_bytes"],
        "download_speed": row["download_speed"],
        "upload_speed": row["upload_speed"],
        "progress": row["progress"],
        "error_message": row["error_message"],
        "created_at": row["created_at"],
        "completed_at": row["completed_at"],
        "created_by": row["created_by"],
        "meta": meta,
    }


def list_tasks(
    filter_key: str = "all",
    search: str = "",
    limit: int = 200,
) -> List[Dict[str, Any]]:
    _init_db()
    clauses: List[str] = []
    params: List[Any] = []

    status_map = {
        "downloading": ("connecting", "downloading", "queued"),
        "completed": ("completed",),
        "active": ("connecting", "downloading", "queued"),
        "inactive": ("paused", "stopped", "error", "completed"),
        "stopped": ("stopped", "paused"),
    }
    if filter_key in status_map:
        placeholders = ",".join("?" * len(status_map[filter_key]))
        clauses.append(f"status IN ({placeholders})")
        params.extend(status_map[filter_key])

    if search.strip():
        clauses.append("(name LIKE ? OR source_url LIKE ?)")
        q = f"%{search.strip()}%"
        params.extend([q, q])

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"SELECT * FROM download_tasks {where} ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with _db() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_task(r) for r in rows]


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    _init_db()
    with _db() as conn:
        row = conn.execute("SELECT * FROM download_tasks WHERE id = ?", (task_id,)).fetchone()
    return _row_to_task(row) if row else None


def _update_task(task_id: str, **fields: Any) -> None:
    if not fields:
        return
    cols = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [task_id]
    with _db() as conn:
        conn.execute(f"UPDATE download_tasks SET {cols} WHERE id = ?", vals)


def detect_url(url: str) -> Dict[str, Any]:
    _init_db()
    raw = (url or "").strip()
    if raw.lower().startswith("magnet:"):
        return {"source_type": "torrent", "magnet": True}
    if raw.lower().endswith(".torrent") and Path(raw).exists():
        return {"source_type": "torrent", "torrent_path": raw}
    if GOOGLE_DRIVE_FOLDER_RE.search(raw):
        m = GOOGLE_DRIVE_FOLDER_RE.search(raw)
        return {"source_type": "google_drive_folder", "folder_id": m.group(1) if m else None}
    if GOOGLE_DRIVE_FILE_RE.search(raw) or "docs.google.com" in raw:
        m = GOOGLE_DRIVE_FILE_RE.search(raw)
        fid = m.group(1) if m else _extract_google_id(raw)
        return {"source_type": "google_drive", "file_id": fid}
    hosting = match_file_hosting(raw)
    if hosting:
        return {
            "source_type": "file_hosting",
            "file_hosting_id": hosting["id"],
            "file_hosting_name": hosting["name"],
        }
    return {"source_type": "direct"}


def _extract_google_id(url: str) -> Optional[str]:
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    if "id" in qs:
        return qs["id"][0]
    return None


def match_file_hosting(url: str) -> Optional[Dict[str, Any]]:
    host = (urlparse(url).netloc or "").lower()
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM file_hosting_profiles WHERE enabled = 1 ORDER BY name"
        ).fetchall()
    for row in rows:
        patterns = json.loads(row["url_patterns"] or "[]")
        for pat in patterns:
            if pat.lower() in url.lower() or pat.lower() in host:
                return {
                    "id": row["id"],
                    "name": row["name"],
                    "type": row["type"],
                }
    return None


def list_hosting_profiles() -> List[Dict[str, Any]]:
    _init_db()
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM file_hosting_profiles ORDER BY name"
        ).fetchall()
    out = []
    for row in rows:
        api_cfg = None
        if row["api_config"]:
            try:
                api_cfg = json.loads(row["api_config"])
            except json.JSONDecodeError:
                api_cfg = None
        out.append({
            "id": row["id"],
            "name": row["name"],
            "type": row["type"],
            "url_patterns": json.loads(row["url_patterns"] or "[]"),
            "enabled": bool(row["enabled"]),
            "curl_template": row["curl_template"] or "",
            "api_config": api_cfg,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        })
    return out


def get_hosting_profile(profile_id: str) -> Optional[Dict[str, Any]]:
    for p in list_hosting_profiles():
        if p["id"] == profile_id:
            accounts = list_hosting_accounts(profile_id)
            return {**p, "accounts": accounts}
    return None


def create_hosting_profile(data: Dict[str, Any]) -> Dict[str, Any]:
    _init_db()
    pid = str(uuid.uuid4())
    now = _utc_now()
    api_cfg = data.get("api_config")
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO file_hosting_profiles
            (id, name, type, url_patterns, enabled, curl_template, api_config, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                pid,
                data["name"],
                data.get("type", "curl"),
                json.dumps(data.get("url_patterns", [])),
                1 if data.get("enabled", True) else 0,
                data.get("curl_template", ""),
                json.dumps(api_cfg) if api_cfg else None,
                now,
                now,
            ),
        )
    return get_hosting_profile(pid) or {}


def update_hosting_profile(profile_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    _init_db()
    fields: Dict[str, Any] = {}
    if "name" in data and data["name"] is not None:
        fields["name"] = data["name"]
    if "type" in data and data["type"] is not None:
        fields["type"] = data["type"]
    if "url_patterns" in data and data["url_patterns"] is not None:
        fields["url_patterns"] = json.dumps(data["url_patterns"])
    if "enabled" in data and data["enabled"] is not None:
        fields["enabled"] = 1 if data["enabled"] else 0
    if "curl_template" in data and data["curl_template"] is not None:
        fields["curl_template"] = data["curl_template"]
    if "api_config" in data:
        fields["api_config"] = json.dumps(data["api_config"]) if data["api_config"] else None
    if not fields:
        return get_hosting_profile(profile_id)
    fields["updated_at"] = _utc_now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [profile_id]
    with _db() as conn:
        cur = conn.execute(f"UPDATE file_hosting_profiles SET {cols} WHERE id = ?", vals)
        if cur.rowcount == 0:
            return None
    return get_hosting_profile(profile_id)


def delete_hosting_profile(profile_id: str) -> bool:
    _init_db()
    with _db() as conn:
        conn.execute("DELETE FROM file_hosting_accounts WHERE profile_id = ?", (profile_id,))
        cur = conn.execute("DELETE FROM file_hosting_profiles WHERE id = ?", (profile_id,))
    return cur.rowcount > 0


def list_hosting_accounts(profile_id: str) -> List[Dict[str, Any]]:
    _init_db()
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, profile_id, label, username, api_key, cookie, extra, is_default FROM file_hosting_accounts WHERE profile_id = ? ORDER BY label",
            (profile_id,),
        ).fetchall()
    out = []
    for row in rows:
        extra = {}
        if row["extra"]:
            try:
                extra = json.loads(row["extra"])
            except json.JSONDecodeError:
                extra = {}
        out.append({
            "id": row["id"],
            "profile_id": row["profile_id"],
            "label": row["label"],
            "username": row["username"] or "",
            "api_key_set": bool(row["api_key"]),
            "cookie_set": bool(row["cookie"]),
            "extra": extra,
            "is_default": bool(row["is_default"]),
        })
    return out


def _get_account(profile_id: str, account_id: Optional[str]) -> Optional[Dict[str, Any]]:
    with _db() as conn:
        if account_id:
            row = conn.execute(
                "SELECT * FROM file_hosting_accounts WHERE id = ? AND profile_id = ?",
                (account_id, profile_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM file_hosting_accounts WHERE profile_id = ? ORDER BY is_default DESC, label LIMIT 1",
                (profile_id,),
            ).fetchone()
    if not row:
        return None
    extra = {}
    if row["extra"]:
        try:
            extra = json.loads(row["extra"])
        except json.JSONDecodeError:
            extra = {}
    return {
        "id": row["id"],
        "label": row["label"],
        "username": row["username"] or "",
        "password": row["password"] or "",
        "api_key": row["api_key"] or "",
        "cookie": row["cookie"] or "",
        "extra": extra,
    }


def create_hosting_account(profile_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    _init_db()
    aid = str(uuid.uuid4())
    if data.get("is_default"):
        with _db() as conn:
            conn.execute(
                "UPDATE file_hosting_accounts SET is_default = 0 WHERE profile_id = ?",
                (profile_id,),
            )
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO file_hosting_accounts
            (id, profile_id, label, username, password, api_key, cookie, extra, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                aid,
                profile_id,
                data["label"],
                data.get("username", ""),
                data.get("password", ""),
                data.get("api_key", ""),
                data.get("cookie", ""),
                json.dumps(data.get("extra", {})),
                1 if data.get("is_default") else 0,
            ),
        )
    accounts = list_hosting_accounts(profile_id)
    return next((a for a in accounts if a["id"] == aid), {})


def update_hosting_account(profile_id: str, account_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    _init_db()
    if data.get("is_default"):
        with _db() as conn:
            conn.execute(
                "UPDATE file_hosting_accounts SET is_default = 0 WHERE profile_id = ?",
                (profile_id,),
            )
    fields: Dict[str, Any] = {}
    for key in ("label", "username", "password", "api_key", "cookie"):
        if key in data and data[key] is not None:
            fields[key] = data[key]
    if "extra" in data and data["extra"] is not None:
        fields["extra"] = json.dumps(data["extra"])
    if "is_default" in data and data["is_default"] is not None:
        fields["is_default"] = 1 if data["is_default"] else 0
    if not fields:
        return next((a for a in list_hosting_accounts(profile_id) if a["id"] == account_id), None)
    cols = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [account_id, profile_id]
    with _db() as conn:
        cur = conn.execute(
            f"UPDATE file_hosting_accounts SET {cols} WHERE id = ? AND profile_id = ?",
            vals,
        )
        if cur.rowcount == 0:
            return None
    return next((a for a in list_hosting_accounts(profile_id) if a["id"] == account_id), None)


def delete_hosting_account(profile_id: str, account_id: str) -> bool:
    _init_db()
    with _db() as conn:
        cur = conn.execute(
            "DELETE FROM file_hosting_accounts WHERE id = ? AND profile_id = ?",
            (account_id, profile_id),
        )
    return cur.rowcount > 0


def browse_folders(path: str = "") -> Dict[str, Any]:
    """List directories for folder picker (destination / temp)."""
    settings = get_settings(mask_secrets=False)
    base = Path(path) if path else Path(settings["destination_folder"])
    try:
        base = base.resolve()
    except OSError:
        base = Path(settings["destination_folder"])
    if not base.exists():
        base.mkdir(parents=True, exist_ok=True)
    entries = []
    parent = str(base.parent) if base.parent != base else None
    try:
        for item in sorted(base.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if item.is_dir():
                entries.append({"name": item.name, "path": str(item), "type": "dir"})
    except PermissionError:
        pass
    return {
        "current": str(base),
        "parent": parent,
        "entries": entries,
        "volumes": _list_volumes(),
    }


def _list_volumes() -> List[Dict[str, str]]:
    if IS_WINDOWS:
        return [{"label": "Workspace", "path": str(Path("./test_nginx").resolve())}]
    out = []
    try:
        with open("/proc/mounts", "r", encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2 and parts[1].startswith("/"):
                    mp = parts[1]
                    if mp in ("/", "/home", "/opt", "/var", "/mnt") or mp.startswith("/mnt/"):
                        out.append({"label": mp, "path": mp})
    except OSError:
        pass
    if not out:
        out = [{"label": "/", "path": "/"}]
    return out


def create_task(data: Dict[str, Any], username: str = "") -> Dict[str, Any]:
    _init_db()
    url = (data.get("url") or "").strip()
    if not url:
        raise ValueError("URL is required")

    detected = detect_url(url)
    source_type = detected["source_type"]
    hosting_id = data.get("file_hosting_id") or detected.get("file_hosting_id")
    account_id = data.get("account_id")

    settings = get_settings(mask_secrets=False)
    destination = (data.get("destination") or settings["destination_folder"]).strip()
    temp_folder = settings["temp_folder"]

    name = (data.get("filename") or "").strip() or _guess_filename(url, source_type)

    task_id = str(uuid.uuid4())
    now = _utc_now()
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO download_tasks
            (id, name, source_url, source_type, file_hosting_id, account_id,
             destination, temp_path, status, created_at, created_by, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                name,
                url,
                source_type,
                hosting_id,
                account_id,
                destination,
                str(Path(temp_folder) / task_id),
                "queued",
                now,
                username,
                json.dumps(detected),
            ),
        )
    ensure_worker()
    return get_task(task_id) or {}


def create_task_from_torrent_bytes(
    content: bytes,
    filename: str,
    username: str = "",
    destination: Optional[str] = None,
) -> Dict[str, Any]:
    if not content:
        raise ValueError("Empty torrent file")
    settings = get_settings(mask_secrets=False)
    dest = (destination or settings["destination_folder"]).strip()
    temp_dir = Path(settings["temp_folder"])
    temp_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(filename or "upload.torrent").name
    torrent_path = temp_dir / f"{uuid.uuid4().hex}_{safe_name}"
    torrent_path.write_bytes(content)

    task_id = str(uuid.uuid4())
    now = _utc_now()
    meta = {"source_type": "torrent", "torrent_path": str(torrent_path), "uploaded": True}
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO download_tasks
            (id, name, source_url, source_type, file_hosting_id, account_id,
             destination, temp_path, status, created_at, created_by, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                Path(safe_name).stem,
                str(torrent_path),
                "torrent",
                None,
                None,
                dest,
                str(Path(settings["temp_folder"]) / task_id),
                "queued",
                now,
                username,
                json.dumps(meta),
            ),
        )
    ensure_worker()
    return get_task(task_id) or {}


def _guess_filename(url: str, source_type: str) -> str:
    if source_type == "torrent":
        if url.lower().startswith("magnet:"):
            return f"magnet_{int(time.time())}"
        return Path(url).stem or f"torrent_{int(time.time())}"
    if source_type.startswith("google"):
        return f"google_{source_type}_{int(time.time())}"
    path = urlparse(url).path
    base = Path(path).name
    return base or f"download_{int(time.time())}"


def delete_task(task_id: str) -> bool:
    task = get_task(task_id)
    if not task:
        return False
    gid = (task.get("meta") or {}).get("aria2_gid")
    if gid:
        engine = _get_aria2()
        if engine:
            try:
                engine.remove(gid)
            except Exception:
                pass
    if task["status"] in ("downloading", "connecting", "queued"):
        _update_task(task_id, status="stopped")
    with _db() as conn:
        cur = conn.execute("DELETE FROM download_tasks WHERE id = ?", (task_id,))
    _cleanup_temp(task.get("temp_path"))
    return cur.rowcount > 0


def clear_completed() -> int:
    _init_db()
    with _db() as conn:
        cur = conn.execute("DELETE FROM download_tasks WHERE status = ?", ("completed",))
    return cur.rowcount


def set_task_status(task_id: str, status: str) -> Optional[Dict[str, Any]]:
    task = get_task(task_id)
    if not task:
        return None
    allowed = {
        "pause": "paused",
        "resume": "queued",
        "stop": "stopped",
    }
    if status not in allowed:
        raise ValueError(f"Unknown action: {status}")
    new_status = allowed[status]
    gid = (task.get("meta") or {}).get("aria2_gid")
    engine = _get_aria2()
    if gid and engine:
        try:
            if status == "pause":
                engine.pause(gid)
            elif status == "resume":
                engine.unpause(gid)
            elif status == "stop":
                engine.remove(gid)
        except Exception:
            pass
    if status == "resume":
        ensure_worker()
    _update_task(task_id, status=new_status)
    return get_task(task_id)


# ---------------------------------------------------------------------------
# URL resolvers
# ---------------------------------------------------------------------------

def resolve_download(task: Dict[str, Any]) -> Tuple[str, Dict[str, str]]:
    """Return (direct_url, extra_headers) for the task."""
    url = task["source_url"] or ""
    st = task["source_type"]

    if st == "direct":
        return url, {}

    if st == "google_drive":
        fid = (task.get("meta") or {}).get("file_id") or _extract_google_id(url)
        if not fid:
            raise ValueError("Cannot parse Google Drive file id")
        return _resolve_google_drive_file(fid)

    if st == "google_drive_folder":
        raise ValueError("Folder downloads expand into multiple tasks — handled separately")

    if st == "file_hosting":
        return _resolve_file_hosting(task)

    raise ValueError(f"Unsupported source type: {st}")


def _resolve_google_drive_file(file_id: str) -> Tuple[str, Dict[str, str]]:
    token = GoogleOAuthService.get_access_token()
    if token:
        return (
            f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media",
            {"Authorization": f"Bearer {token}"},
        )
    api_key = _get_setting("google_api_key") or ""
    if api_key:
        return (
            f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&key={api_key}",
            {},
        )
    return (f"https://drive.google.com/uc?export=download&id={file_id}", {})


def _resolve_file_hosting(task: Dict[str, Any]) -> Tuple[str, Dict[str, str]]:
    profile_id = task.get("file_hosting_id")
    if not profile_id:
        raise ValueError("Missing file hosting profile")
    profile = get_hosting_profile(profile_id)
    if not profile:
        raise ValueError("File hosting profile not found")
    account = _get_account(profile_id, task.get("account_id"))
    url = task["source_url"] or ""

    if profile["type"] == "curl":
        out_path = str(Path(task["temp_path"]) / "resolved.bin")
        Path(task["temp_path"]).mkdir(parents=True, exist_ok=True)
        _run_curl_template(profile["curl_template"], url, account, out_path)
        return f"file://{out_path}", {}

    api_cfg = profile.get("api_config") or {}
    return _resolve_via_api(api_cfg, url, account)


def _substitute(template: str, url: str, account: Optional[Dict[str, Any]], out_path: str = "") -> str:
    acc = account or {}
    mapping = {
        "{URL}": url,
        "{url}": url,
        "{OUT}": out_path,
        "{out}": out_path,
        "{USER}": acc.get("username", ""),
        "{user}": acc.get("username", ""),
        "{PASS}": acc.get("password", ""),
        "{pass}": acc.get("password", ""),
        "{API_KEY}": acc.get("api_key", ""),
        "{api_key}": acc.get("api_key", ""),
        "{COOKIE}": acc.get("cookie", ""),
        "{cookie}": acc.get("cookie", ""),
    }
    result = template
    for k, v in mapping.items():
        result = result.replace(k, v)
    return result


def _run_curl_template(template: str, url: str, account: Optional[Dict[str, Any]], out_path: str) -> None:
    if not template.strip():
        raise ValueError("curl_template is empty")
    cmd = _substitute(template, url, account, out_path)
    try:
        parts = shlex.split(cmd)
    except ValueError as exc:
        raise ValueError(f"Invalid curl template: {exc}") from exc
    if not parts or parts[0] not in ("curl", "/usr/bin/curl", "curl.exe"):
        raise ValueError("curl_template must start with curl")
    proc = subprocess.run(parts, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "curl failed")
    if not Path(out_path).exists():
        raise RuntimeError("curl finished but output file missing")


def _resolve_via_api(
    api_cfg: Dict[str, Any],
    url: str,
    account: Optional[Dict[str, Any]],
) -> Tuple[str, Dict[str, str]]:
    resolve_url = api_cfg.get("resolve_url", "")
    if not resolve_url:
        raise ValueError("api_config.resolve_url is required")
    method = (api_cfg.get("method") or "POST").upper()
    headers = {k: _substitute(v, url, account) for k, v in (api_cfg.get("headers") or {}).items()}
    body_raw = _substitute(api_cfg.get("body_template") or "", url, account)
    if method == "GET":
        payload = _http_json_request(resolve_url, method="GET", headers=headers)
    else:
        payload = _http_json_request(
            resolve_url,
            method="POST",
            headers=headers,
            body=body_raw.encode("utf-8") if body_raw else None,
        )
    field = api_cfg.get("download_url_field") or "direct_link"
    direct = _dig_field(payload, field)
    if not direct:
        raise ValueError(f"API response missing field: {field}")
    return str(direct), {}


def _dig_field(obj: Any, dotted: str) -> Any:
    cur = obj
    for part in dotted.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _http_json_request(
    url: str,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    body: Optional[bytes] = None,
    timeout: int = 120,
) -> Any:
    hdrs = dict(headers or {})
    if body is not None and "Content-Type" not in hdrs:
        hdrs["Content-Type"] = "application/json"
    req = Request(url, data=body, headers=hdrs, method=method.upper())
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except UrlHTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace") if exc.fp else str(exc)
        raise RuntimeError(detail or f"HTTP {exc.code}") from exc
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Invalid JSON response") from exc


def _http_open(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 600):
    req = Request(url, headers=headers or {}, method="GET")
    try:
        return urlopen(req, timeout=timeout)
    except UrlHTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace") if exc.fp else str(exc)
        raise RuntimeError(detail or f"HTTP {exc.code}") from exc


# ---------------------------------------------------------------------------
# Download worker
# ---------------------------------------------------------------------------

def ensure_worker() -> None:
    global _worker_started
    with _engine_lock:
        if _worker_started:
            return
        _worker_started = True
        t = threading.Thread(target=_worker_loop, name="download-manager-worker", daemon=True)
        t.start()


def _worker_loop() -> None:
    _init_db()
    _apply_aria2_speed_limits()
    while True:
        try:
            sync_aria2_tasks()
            scan_watched_folder()
            _process_queue()
        except Exception:
            pass
        time.sleep(1.5)


def _active_count() -> int:
    with _db() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS c FROM download_tasks
            WHERE status IN ('connecting','downloading')
              AND (meta IS NULL OR meta NOT LIKE '%aria2_gid%')
            """
        ).fetchone()
    return int(row["c"]) if row else 0


def _process_queue() -> None:
    max_conc = int(_get_setting("max_concurrent") or 3)
    if _active_count() >= max_conc:
        return
    with _db() as conn:
        row = conn.execute(
            "SELECT id FROM download_tasks WHERE status = 'queued' ORDER BY created_at LIMIT 1"
        ).fetchone()
    if not row:
        return
    task = get_task(row["id"])
    if not task:
        return
    threading.Thread(
        target=_run_download,
        args=(task["id"],),
        name=f"dl-{task['id'][:8]}",
        daemon=True,
    ).start()


def _run_download(task_id: str) -> None:
    task = get_task(task_id)
    if not task or task["status"] != "queued":
        return
    _update_task(task_id, status="connecting", error_message=None)
    try:
        if task["source_type"] == "google_drive_folder":
            _expand_google_folder(task)
            return
        if task["source_type"] == "torrent":
            _run_torrent_download(task_id, task)
            return
        engine = _get_aria2()
        if engine and engine.is_available():
            direct_url, headers = resolve_download(task)
            _run_aria2_http(task_id, task, direct_url, headers, engine)
            return
        direct_url, headers = resolve_download(task)
        _download_http(task_id, direct_url, headers, task)
    except Exception as exc:
        _update_task(task_id, status="error", error_message=str(exc))


def _expand_google_folder(task: Dict[str, Any]) -> None:
    folder_id = (task.get("meta") or {}).get("folder_id")
    if not folder_id:
        _update_task(task["id"], status="error", error_message="Missing folder id")
        return
    token = GoogleOAuthService.get_access_token()
    api_key = _get_setting("google_api_key") or ""
    headers: Dict[str, str] = {}
    if token:
        list_url = (
            f"https://www.googleapis.com/drive/v3/files"
            f"?q='{folder_id}'+in+parents+and+trashed=false"
            f"&fields=files(id,name,mimeType)"
        )
        headers = {"Authorization": f"Bearer {token}"}
    elif api_key:
        list_url = (
            f"https://www.googleapis.com/drive/v3/files"
            f"?q='{folder_id}'+in+parents+and+trashed=false"
            f"&fields=files(id,name,mimeType)&key={api_key}"
        )
    else:
        _update_task(
            task["id"],
            status="error",
            error_message="Google API key or OAuth required for folder listing",
        )
        return
    files = (_http_json_request(list_url, headers=headers, timeout=60).get("files")) or []
    if not files:
        _update_task(task["id"], status="completed", progress=100.0, completed_at=_utc_now())
        return
    username = task.get("created_by") or ""
    for f in files:
        if f.get("mimeType") == "application/vnd.google-apps.folder":
            continue
        fid = f["id"]
        create_task(
            {
                "url": f"https://drive.google.com/file/d/{fid}/view",
                "destination": task["destination"],
                "filename": f.get("name"),
            },
            username=username,
        )
    _update_task(
        task["id"],
        status="completed",
        name=f"{task['name']} ({len(files)} files queued)",
        progress=100.0,
        completed_at=_utc_now(),
        meta=json.dumps({**(task.get("meta") or {}), "expanded": len(files)}),
    )


def _download_http(
    task_id: str,
    url: str,
    headers: Dict[str, str],
    task: Dict[str, Any],
) -> None:
    dest_dir = Path(task["destination"])
    dest_dir.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(task["temp_path"])
    temp_dir.mkdir(parents=True, exist_ok=True)
    final_name = task["name"]
    temp_file = temp_dir / f"{final_name}.part"
    final_path = dest_dir / final_name

    if url.startswith("file://"):
        local = Path(url[7:])
        shutil.copy2(local, final_path)
        size = final_path.stat().st_size
        _update_task(
            task_id,
            status="completed",
            downloaded_bytes=size,
            total_bytes=size,
            progress=100.0,
            completed_at=_utc_now(),
        )
        _cleanup_temp(task["temp_path"])
        return

    _update_task(task_id, status="downloading")
    downloaded = 0
    total = 0
    last_tick = time.time()
    last_bytes = 0
    speed = 0

    with _http_open(url, headers=headers, timeout=600) as resp:
        cl = resp.headers.get("Content-Length") or resp.headers.get("content-length")
        if cl and str(cl).isdigit():
            total = int(cl)
        cd = resp.headers.get("Content-Disposition") or resp.headers.get("content-disposition") or ""
        if "filename=" in cd and task["name"].startswith("google_"):
            m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";\n]+)"?', cd)
            if m:
                final_name = m.group(1).strip()
                final_path = dest_dir / final_name
                temp_file = temp_dir / f"{final_name}.part"
                _update_task(task_id, name=final_name)

        with open(temp_file, "wb") as fh:
            while True:
                chunk = resp.read(256 * 1024)
                if not chunk:
                    break
                cur = get_task(task_id)
                if not cur or cur["status"] in ("paused", "stopped"):
                    return
                fh.write(chunk)
                downloaded += len(chunk)
                now = time.time()
                if now - last_tick >= 1.0:
                    speed = int((downloaded - last_bytes) / (now - last_tick))
                    last_bytes = downloaded
                    last_tick = now
                    prog = (downloaded / total * 100) if total else 0.0
                    _update_task(
                        task_id,
                        downloaded_bytes=downloaded,
                        total_bytes=total,
                        download_speed=speed,
                        progress=round(prog, 1),
                    )

    _finalize_download_file(temp_file, final_path)
    size = final_path.stat().st_size
    _update_task(
        task_id,
        status="completed",
        downloaded_bytes=size,
        total_bytes=size or size,
        download_speed=0,
        progress=100.0,
        completed_at=_utc_now(),
    )
    _cleanup_temp(task["temp_path"])


def _finalize_download_file(temp_file: Path, final_path: Path) -> None:
    """Move completed .part file to destination (works across mount points)."""
    final_path.parent.mkdir(parents=True, exist_ok=True)
    if final_path.exists():
        final_path.unlink()
    shutil.move(str(temp_file), str(final_path))


def _cleanup_temp(temp_path: Optional[str]) -> None:
    if not temp_path:
        return
    p = Path(temp_path)
    if p.exists() and p.is_dir():
        shutil.rmtree(p, ignore_errors=True)


# ---------------------------------------------------------------------------
# aria2 + watched folder
# ---------------------------------------------------------------------------

def _get_aria2() -> Optional[Aria2Engine]:
    return get_engine_from_settings({
        "aria2_rpc_host": _get_setting("aria2_rpc_host"),
        "aria2_rpc_port": _get_setting("aria2_rpc_port"),
        "aria2_rpc_secret": _get_setting("aria2_rpc_secret"),
    })


def _apply_aria2_speed_limits() -> None:
    engine = _get_aria2()
    if not engine:
        return
    try:
        if not engine.is_available():
            return
        engine.apply_speed_limits(
            int(_get_setting("max_download_speed_kbps") or 0),
            int(_get_setting("max_upload_speed_kbps") or 0),
        )
    except Exception:
        pass


def _aria2_options(task: Dict[str, Any]) -> Dict[str, str]:
    opts: Dict[str, str] = {"dir": task["destination"]}
    if task.get("name"):
        opts["out"] = task["name"]
    dl = int(_get_setting("max_download_speed_kbps") or 0)
    ul = int(_get_setting("max_upload_speed_kbps") or 0)
    if dl > 0:
        opts["max-download-limit"] = f"{dl}K"
    if ul > 0:
        opts["max-upload-limit"] = f"{ul}K"
    return opts


def _merge_meta(task: Dict[str, Any], extra: Dict[str, Any]) -> str:
    base = dict(task.get("meta") or {})
    base.update(extra)
    return json.dumps(base)


def _run_torrent_download(task_id: str, task: Dict[str, Any]) -> None:
    engine = _get_aria2()
    if not engine or not engine.is_available():
        raise RuntimeError("aria2 is not available — install and start aria2c with --enable-rpc")
    Path(task["destination"]).mkdir(parents=True, exist_ok=True)
    opts = _aria2_options(task)
    meta = task.get("meta") or {}
    url = task["source_url"] or ""
    if meta.get("magnet") or url.lower().startswith("magnet:"):
        gid = engine.add_magnet(url, opts)
    else:
        torrent_path = meta.get("torrent_path") or url
        data = Path(torrent_path).read_bytes()
        gid = engine.add_torrent(data, opts)
    _update_task(
        task_id,
        status="downloading",
        meta=_merge_meta(task, {"aria2_gid": gid}),
    )


def _run_aria2_http(
    task_id: str,
    task: Dict[str, Any],
    url: str,
    headers: Dict[str, str],
    engine: Aria2Engine,
) -> None:
    if url.startswith("file://"):
        _download_http(task_id, url, headers, task)
        return
    Path(task["destination"]).mkdir(parents=True, exist_ok=True)
    opts = _aria2_options(task)
    if headers:
        opts["header"] = [f"{k}: {v}" for k, v in headers.items()]
    gid = engine.add_uri([url], opts)
    _update_task(
        task_id,
        status="downloading",
        meta=_merge_meta(task, {"aria2_gid": gid}),
    )


def sync_aria2_tasks() -> None:
    engine = _get_aria2()
    if not engine or not engine.is_available():
        return
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, meta, status FROM download_tasks WHERE meta LIKE '%aria2_gid%'"
        ).fetchall()
    for row in rows:
        task_id = row["id"]
        try:
            meta = json.loads(row["meta"] or "{}")
        except json.JSONDecodeError:
            continue
        gid = meta.get("aria2_gid")
        if not gid:
            continue
        try:
            info = engine.tell_status(gid)
            parsed = parse_aria2_progress(info)
        except Exception:
            continue
        fields: Dict[str, Any] = {
            "downloaded_bytes": parsed["downloaded_bytes"],
            "total_bytes": parsed["total_bytes"],
            "download_speed": parsed["download_speed"],
            "upload_speed": parsed["upload_speed"],
            "progress": parsed["progress"],
            "status": parsed["status"],
        }
        if parsed.get("name"):
            fields["name"] = parsed["name"]
        if parsed["status"] == "error" and parsed.get("error_message"):
            fields["error_message"] = parsed["error_message"]
        if parsed["status"] == "completed":
            fields["completed_at"] = _utc_now()
        _update_task(task_id, **fields)


def _load_watched_seen() -> Dict[str, float]:
    if not WATCHED_SEEN_FILE.exists():
        return {}
    try:
        return json.loads(WATCHED_SEEN_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_watched_seen(data: Dict[str, float]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    WATCHED_SEEN_FILE.write_text(json.dumps(data), encoding="utf-8")


def scan_watched_folder() -> None:
    folder = (_get_setting("watched_folder") or "").strip()
    if not folder:
        return
    watch_path = Path(folder)
    if not watch_path.is_dir():
        return
    seen = _load_watched_seen()
    auto_delete = bool(_get_setting("watched_auto_delete"))
    changed = False
    for torrent in sorted(watch_path.glob("*.torrent")):
        key = str(torrent.resolve())
        mtime = torrent.stat().st_mtime
        if seen.get(key) == mtime:
            continue
        try:
            content = torrent.read_bytes()
            create_task_from_torrent_bytes(content, torrent.name, destination=_get_setting("destination_folder"))
            seen[key] = mtime
            changed = True
            if auto_delete:
                torrent.unlink(missing_ok=True)
        except Exception:
            continue
    if changed:
        _save_watched_seen(seen)


def get_engine_status() -> Dict[str, Any]:
    engine = _get_aria2()
    if not engine:
        return {"aria2_available": False, "version": "", "message": "aria2 not configured"}
    try:
        if engine.is_available():
            return {"aria2_available": True, "version": engine.get_version(), "message": "connected"}
    except Exception as exc:
        return {"aria2_available": False, "version": "", "message": str(exc)}
    return {
        "aria2_available": False,
        "version": "",
        "message": "aria2 RPC unreachable — start aria2c --enable-rpc",
    }


# Start worker when backend loads this module (sub-router startup events are unreliable).
ensure_worker()
