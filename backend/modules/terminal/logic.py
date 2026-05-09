"""Terminal module: persisted command snippets (per user JSON store)."""
from __future__ import annotations

import json
import os
import re
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List

# Shipped with CoPanel — matches scripts/install.sh "Useful Commands" summary.
BUILTIN_SNIPPETS: List[Dict[str, str]] = [
    {
        "id": "_copanel_systemctl_start",
        "command": "systemctl start copanel",
        "title_en": "Start CoPanel service",
        "title_vi": "Khởi động dịch vụ CoPanel",
    },
    {
        "id": "_copanel_systemctl_stop",
        "command": "systemctl stop copanel",
        "title_en": "Stop CoPanel service",
        "title_vi": "Dừng dịch vụ CoPanel",
    },
    {
        "id": "_copanel_systemctl_restart",
        "command": "systemctl restart copanel",
        "title_en": "Restart CoPanel service",
        "title_vi": "Khởi động lại dịch vụ CoPanel",
    },
    {
        "id": "_copanel_journal_follow",
        "command": "journalctl -u copanel -f",
        "title_en": "Follow CoPanel logs (journalctl)",
        "title_vi": "Theo dõi log CoPanel (journalctl)",
    },
    {
        "id": "_copanel_systemctl_status",
        "command": "systemctl status copanel",
        "title_en": "CoPanel service status",
        "title_vi": "Trạng thái dịch vụ CoPanel",
    },
]

_MAX_SNIPPETS_PER_USER = 200
_MAX_TITLE_LEN = 200
_MAX_COMMAND_LEN = 8000
_ID_RE = re.compile(r"^[a-zA-Z0-9._-]{1,128}$")


def _store_path() -> Path:
    if os.name == "nt":
        return Path("./test_nginx/terminal_snippets.json")
    return Path("/var/lib/copanel/terminal_snippets.json")


def _normalize_custom_entry(raw: Dict[str, Any]) -> Dict[str, str]:
    sid = str(raw.get("id") or "").strip()
    if not sid or not _ID_RE.match(sid):
        sid = uuid.uuid4().hex
    title = str(raw.get("title") or "").strip()
    command = str(raw.get("command") or "").strip()
    if len(title) > _MAX_TITLE_LEN:
        title = title[:_MAX_TITLE_LEN]
    if len(command) > _MAX_COMMAND_LEN:
        command = command[:_MAX_COMMAND_LEN]
    return {"id": sid, "title": title, "command": command}


def _validate_custom_list(items: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    if len(items) > _MAX_SNIPPETS_PER_USER:
        raise ValueError(f"At most {_MAX_SNIPPETS_PER_USER} custom snippets allowed.")
    out: List[Dict[str, str]] = []
    seen: set[str] = set()
    for raw in items:
        if not isinstance(raw, dict):
            raise ValueError("Each snippet must be an object.")
        entry = _normalize_custom_entry(raw)
        if not entry["title"]:
            raise ValueError("Snippet title cannot be empty.")
        if not entry["command"]:
            raise ValueError("Snippet command cannot be empty.")
        if entry["id"] in seen:
            raise ValueError(f"Duplicate snippet id: {entry['id']}")
        seen.add(entry["id"])
        out.append(entry)
    return out


def _read_store() -> Dict[str, Any]:
    path = _store_path()
    if not path.is_file():
        return {"version": 1, "by_user": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"version": 1, "by_user": {}}
    if not isinstance(data, dict):
        return {"version": 1, "by_user": {}}
    by_user = data.get("by_user")
    if not isinstance(by_user, dict):
        by_user = {}
    return {"version": 1, "by_user": by_user}


def _write_store(store: Dict[str, Any]) -> None:
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    payload = json.dumps(store, ensure_ascii=False, indent=2)
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(path)


def list_snippets(user_id: int) -> Dict[str, Any]:
    """Return builtin templates plus this user's saved snippets."""
    uid = str(int(user_id))
    store = _read_store()
    raw_list = store["by_user"].get(uid)
    custom: List[Dict[str, str]] = []
    if isinstance(raw_list, list):
        for item in raw_list:
            if isinstance(item, dict):
                try:
                    entry = _normalize_custom_entry(item)
                except ValueError:
                    continue
                if entry["title"] and entry["command"]:
                    custom.append(entry)
    return {
        "builtin": deepcopy(BUILTIN_SNIPPETS),
        "custom": custom,
    }


def save_snippets(user_id: int, snippets: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Replace custom snippets for user; returns same shape as list_snippets."""
    validated = _validate_custom_list(snippets)
    uid = str(int(user_id))
    store = _read_store()
    if not isinstance(store.get("by_user"), dict):
        store["by_user"] = {}
    store["by_user"][uid] = validated
    store["version"] = 1
    _write_store(store)
    return list_snippets(int(user_id))
