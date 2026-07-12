"""SSL auto-renew settings and crontab sync."""
from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from core.cron_system import ensure_cron_service

IS_WINDOWS = os.name == "nt"
CONFIG_DIR = Path("/opt/copanel/config") if not IS_WINDOWS else Path("./test_copanel/config")
LOG_DIR = Path("/opt/copanel/logs") if not IS_WINDOWS else Path("./test_copanel/logs")
BACKEND_ROOT = Path("/opt/copanel/backend") if not IS_WINDOWS else Path(__file__).resolve().parents[2]
RUN_RENEW_SCRIPT = Path(__file__).resolve().parent / "run_renew.py"
SETTINGS_FILE = CONFIG_DIR / "ssl_auto_renew.json"
CRON_TAG_START = "# BEGIN COPANEL SSL AUTO RENEW"
CRON_TAG_END = "# END COPANEL SSL AUTO RENEW"
CRON_CMD_MARKER = "ssl_manager/run_renew.py"
DEFAULT_CRON_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

DEFAULT_SETTINGS: Dict[str, Any] = {
    "enabled": False,
    "hour": 3,
    "minute": 30,
    "last_run": None,
    "last_status": None,
    "last_message": None,
}


def _resolve_python_bin() -> str:
    for candidate in (
        shutil.which("python3"),
        "/usr/bin/python3",
        "/usr/local/bin/python3",
    ):
        if candidate and Path(candidate).is_file():
            return candidate
    return "python3"


def _is_ssl_cron_line(line: str) -> bool:
    stripped = line.strip()
    return CRON_CMD_MARKER in stripped or "ssl_manager.run_renew" in stripped


class AutoRenewManager:
    @staticmethod
    def _ensure_dirs() -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        LOG_DIR.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def get_settings() -> Dict[str, Any]:
        AutoRenewManager._ensure_dirs()
        if not SETTINGS_FILE.is_file():
            return dict(DEFAULT_SETTINGS)
        try:
            data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            out = dict(DEFAULT_SETTINGS)
            out.update(data if isinstance(data, dict) else {})
            return out
        except Exception:
            return dict(DEFAULT_SETTINGS)

    @staticmethod
    def save_settings(enabled: bool, hour: int = 3, minute: int = 30) -> Dict[str, Any]:
        AutoRenewManager._ensure_dirs()
        hour = max(0, min(23, int(hour)))
        minute = max(0, min(59, int(minute)))
        current = AutoRenewManager.get_settings()
        current.update({"enabled": bool(enabled), "hour": hour, "minute": minute})
        SETTINGS_FILE.write_text(json.dumps(current, indent=2), encoding="utf-8")
        if enabled:
            AutoRenewManager.sync_crontab()
        else:
            AutoRenewManager.remove_crontab()
        return current

    @staticmethod
    def record_run(result: Dict[str, Any]) -> None:
        AutoRenewManager._ensure_dirs()
        current = AutoRenewManager.get_settings()
        current["last_run"] = datetime.now(timezone.utc).isoformat()
        current["last_status"] = result.get("status", "unknown")
        current["last_message"] = result.get("message", "")
        SETTINGS_FILE.write_text(json.dumps(current, indent=2), encoding="utf-8")

    @staticmethod
    def detect_certbot_timer() -> Dict[str, Any]:
        if IS_WINDOWS:
            return {"active": False, "source": "mock"}
        if shutil.which("systemctl"):
            res = subprocess.run(
                ["systemctl", "is-active", "certbot.timer"],
                capture_output=True,
                text=True,
            )
            if res.returncode == 0 and (res.stdout or "").strip() == "active":
                return {"active": True, "source": "certbot.timer"}
        cron_path = Path("/etc/cron.d/certbot")
        if cron_path.is_file():
            return {"active": True, "source": "cron.d/certbot"}
        return {"active": False, "source": None}

    @staticmethod
    def get_status() -> Dict[str, Any]:
        settings = AutoRenewManager.get_settings()
        cron_installed = AutoRenewManager._cron_block_present()
        certbot_timer = AutoRenewManager.detect_certbot_timer()
        return {
            **settings,
            "cron_installed": cron_installed,
            "cron_expression": f"{settings['minute']} {settings['hour']} * * *" if settings.get("enabled") else None,
            "certbot_timer": certbot_timer,
            "certbot_installed": bool(shutil.which("certbot")),
            "log_file": str(LOG_DIR / "ssl_renew.log"),
        }

    @staticmethod
    def _cron_block_present() -> bool:
        if IS_WINDOWS:
            return False
        res = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        if res.returncode != 0:
            return False
        return CRON_TAG_START in (res.stdout or "")

    @staticmethod
    def remove_crontab() -> None:
        if IS_WINDOWS:
            return
        res = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        current_cron = res.stdout if res.returncode == 0 else ""
        clean_lines = []
        in_block = False
        for line in current_cron.splitlines():
            if line.strip() == CRON_TAG_START:
                in_block = True
                continue
            if line.strip() == CRON_TAG_END:
                in_block = False
                continue
            if in_block:
                continue
            if _is_ssl_cron_line(line):
                continue
            clean_lines.append(line)
        new_cron_text = "\n".join(clean_lines).rstrip() + "\n"
        subprocess.run(["crontab", "-"], input=new_cron_text, text=True, capture_output=True)

    @staticmethod
    def sync_crontab() -> None:
        if IS_WINDOWS:
            return
        settings = AutoRenewManager.get_settings()
        if not settings.get("enabled"):
            AutoRenewManager.remove_crontab()
            return

        AutoRenewManager._ensure_dirs()
        python_bin = _resolve_python_bin()
        script = str(RUN_RENEW_SCRIPT.resolve())
        log_file = LOG_DIR / "ssl_renew.log"
        minute = int(settings.get("minute", 30))
        hour = int(settings.get("hour", 3))
        cron_line = (
            f"{minute} {hour} * * * PATH={DEFAULT_CRON_PATH} "
            f"{shlex.quote(python_bin)} {shlex.quote(script)} "
            f">> {shlex.quote(str(log_file))} 2>&1"
        )

        res = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        current_cron = res.stdout if res.returncode == 0 else ""
        clean_lines = []
        in_block = False
        for line in current_cron.splitlines():
            if line.strip() == CRON_TAG_START:
                in_block = True
                continue
            if line.strip() == CRON_TAG_END:
                in_block = False
                continue
            if in_block:
                continue
            if _is_ssl_cron_line(line):
                continue
            clean_lines.append(line)

        clean_lines.extend([CRON_TAG_START, cron_line, CRON_TAG_END])
        new_cron_text = "\n".join(clean_lines).rstrip() + "\n"
        proc = subprocess.run(["crontab", "-"], input=new_cron_text, text=True, capture_output=True)
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip() or "crontab write failed"
            raise RuntimeError(err)
        ensure_cron_service()
