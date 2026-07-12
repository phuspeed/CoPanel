"""Shared helpers for Linux system cron (crontab + cron/crond daemon)."""
from __future__ import annotations

import os
import shutil
import subprocess
from typing import Any, Dict, Tuple

IS_WINDOWS = os.name == "nt"


def has_crontab() -> bool:
    return not IS_WINDOWS and shutil.which("crontab") is not None


def get_cron_daemon_status() -> Dict[str, Any]:
    """Return whether systemd knows cron/crond and if the unit is active."""
    if IS_WINDOWS:
        return {"available": False, "service": None, "active": False, "enabled": False}
    service = None
    active = False
    enabled = False
    for svc in ("cron", "crond"):
        probe = subprocess.run(["systemctl", "status", svc], capture_output=True, text=True)
        if probe.returncode in (0, 3):
            service = svc
            is_active = subprocess.run(["systemctl", "is-active", svc], capture_output=True, text=True)
            active = (is_active.stdout or "").strip() == "active"
            is_enabled = subprocess.run(["systemctl", "is-enabled", svc], capture_output=True, text=True)
            enabled = (is_enabled.stdout or "").strip() in ("enabled", "static")
            break
    return {
        "available": service is not None,
        "service": service,
        "active": active,
        "enabled": enabled,
    }


def ensure_cron_service() -> bool:
    """Enable and start cron/crond when the unit exists. Returns True if daemon is active."""
    if IS_WINDOWS:
        return False
    for svc in ("cron", "crond"):
        probe = subprocess.run(["systemctl", "status", svc], capture_output=True, text=True)
        if probe.returncode in (0, 3):
            subprocess.run(["systemctl", "enable", "--now", svc], capture_output=True, text=True)
            return get_cron_daemon_status().get("active", False)
    return False


def ensure_crontab_ready() -> Tuple[bool, str]:
    """Ensure crontab binary exists and cron daemon is running."""
    if not has_crontab():
        return False, "crontab binary missing — install cron package"
    if not ensure_cron_service():
        return False, "cron daemon not running — systemctl enable --now cron"
    return True, ""
