"""Persistent CoAgent AI endpoint settings."""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

IS_WINDOWS = os.name == "nt"

CONFIG_DIR = (
    Path("./test_nginx/coagent")
    if IS_WINDOWS
    else Path("/opt/copanel/config")
)
STORE_PATH = CONFIG_DIR / "coagent_settings.json"

DEFAULTS: Dict[str, Any] = {
    "base_url": os.getenv("COAGENT_BASE_URL", "https://api.domain.com/v1"),
    "api_key": os.getenv("COAGENT_API_KEY", ""),
    "model": os.getenv("COAGENT_MODEL", "gpt-4o-mini"),
    "enabled": True,
    "max_tool_rounds": 6,
}


def _ensure_dir() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def load_config() -> Dict[str, Any]:
    data = dict(DEFAULTS)
    # Env always seeds defaults; file overrides when present.
    data["base_url"] = os.getenv("COAGENT_BASE_URL", data["base_url"])
    data["api_key"] = os.getenv("COAGENT_API_KEY", data["api_key"])
    data["model"] = os.getenv("COAGENT_MODEL", data["model"])

    if STORE_PATH.is_file():
        try:
            raw = json.loads(STORE_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                for key in DEFAULTS:
                    if key in raw and raw[key] is not None:
                        data[key] = raw[key]
        except Exception as exc:
            logger.warning("Failed to read coagent settings: %s", exc)

    try:
        data["max_tool_rounds"] = max(1, min(int(data.get("max_tool_rounds") or 6), 12))
    except (TypeError, ValueError):
        data["max_tool_rounds"] = 6
    data["enabled"] = bool(data.get("enabled", True))
    data["base_url"] = str(data.get("base_url") or "").rstrip("/")
    data["api_key"] = str(data.get("api_key") or "")
    data["model"] = str(data.get("model") or "gpt-4o-mini")
    return data


def save_config(updates: Dict[str, Any]) -> Dict[str, Any]:
    current = load_config()
    if "base_url" in updates and updates["base_url"] is not None:
        current["base_url"] = str(updates["base_url"]).strip().rstrip("/")
    if "model" in updates and updates["model"] is not None:
        current["model"] = str(updates["model"]).strip() or "gpt-4o-mini"
    if "api_key" in updates and updates["api_key"] is not None:
        key = str(updates["api_key"]).strip()
        # Empty string or placeholder means "keep existing"
        if key and not _looks_masked(key):
            current["api_key"] = key
    if "enabled" in updates and updates["enabled"] is not None:
        current["enabled"] = bool(updates["enabled"])
    if "max_tool_rounds" in updates and updates["max_tool_rounds"] is not None:
        current["max_tool_rounds"] = max(1, min(int(updates["max_tool_rounds"]), 12))

    _ensure_dir()
    payload = {
        "base_url": current["base_url"],
        "api_key": current["api_key"],
        "model": current["model"],
        "enabled": current["enabled"],
        "max_tool_rounds": current["max_tool_rounds"],
    }
    STORE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    try:
        os.chmod(STORE_PATH, 0o600)
    except OSError:
        pass
    return current


def mask_api_key(key: str) -> str:
    key = key or ""
    if not key:
        return ""
    if len(key) <= 8:
        return "***"
    return f"{key[:4]}***{key[-4:]}"


def _looks_masked(key: str) -> bool:
    return "***" in key


def public_config(cfg: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cfg = cfg or load_config()
    return {
        "base_url": cfg.get("base_url") or "",
        "api_key_masked": mask_api_key(cfg.get("api_key") or ""),
        "api_key_set": bool(cfg.get("api_key")),
        "model": cfg.get("model") or "",
        "enabled": bool(cfg.get("enabled", True)),
        "max_tool_rounds": int(cfg.get("max_tool_rounds") or 6),
    }
