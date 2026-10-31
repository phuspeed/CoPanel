"""Cron helpers with optional core.cron_system — AppStore modules must not hard-require bleeding-edge core."""
from __future__ import annotations

import os
import subprocess
from typing import Any, Dict

SUBPROCESS_TIMEOUT_SECONDS = 15

try:
    from core.cron_system import ensure_cron_service as _ensure_cron_service
    from core.cron_system import get_cron_daemon_status as _get_cron_daemon_status
except ImportError:

    def _get_cron_daemon_status() -> Dict[str, Any]:
        if os.name == "nt":
            return {"available": False, "service": None, "active": False, "enabled": False}
        service = None
        active = False
        enabled = False
        for svc in ("cron", "crond"):
            try:
                probe = subprocess.run(
                    ["systemctl", "status", svc],
                    capture_output=True,
                    text=True,
                    timeout=SUBPROCESS_TIMEOUT_SECONDS,
                    shell=False,
                )
            except (OSError, subprocess.SubprocessError):
                continue
            if probe.returncode in (0, 3):
                service = svc
                try:
                    is_active = subprocess.run(
                        ["systemctl", "is-active", svc],
                        capture_output=True,
                        text=True,
                        timeout=SUBPROCESS_TIMEOUT_SECONDS,
                        shell=False,
                    )
                    active = (is_active.stdout or "").strip() == "active"
                except (OSError, subprocess.SubprocessError):
                    active = False
                try:
                    is_enabled = subprocess.run(
                        ["systemctl", "is-enabled", svc],
                        capture_output=True,
                        text=True,
                        timeout=SUBPROCESS_TIMEOUT_SECONDS,
                        shell=False,
                    )
                    enabled = (is_enabled.stdout or "").strip() in ("enabled", "static")
                except (OSError, subprocess.SubprocessError):
                    enabled = False
                break
        return {"available": service is not None, "service": service, "active": active, "enabled": enabled}

    def _ensure_cron_service() -> bool:
        if os.name == "nt":
            return False
        for svc in ("cron", "crond"):
            try:
                probe = subprocess.run(
                    ["systemctl", "status", svc],
                    capture_output=True,
                    text=True,
                    timeout=SUBPROCESS_TIMEOUT_SECONDS,
                    shell=False,
                )
            except (OSError, subprocess.SubprocessError):
                continue
            if probe.returncode in (0, 3):
                try:
                    subprocess.run(
                        ["systemctl", "enable", "--now", svc],
                        capture_output=True,
                        text=True,
                        timeout=SUBPROCESS_TIMEOUT_SECONDS,
                        shell=False,
                    )
                except (OSError, subprocess.SubprocessError):
                    return False
                return _get_cron_daemon_status().get("active", False)
        return False


def ensure_cron_service() -> bool:
    return _ensure_cron_service()


def get_cron_daemon_status() -> Dict[str, Any]:
    return _get_cron_daemon_status()
