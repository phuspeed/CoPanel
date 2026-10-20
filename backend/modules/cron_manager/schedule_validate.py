"""Validate cron schedule fields before writing crontab lines."""
from __future__ import annotations

import re
from typing import Dict

_CRON_MACROS = frozenset(
    {
        "@reboot",
        "@yearly",
        "@annually",
        "@monthly",
        "@weekly",
        "@daily",
        "@midnight",
        "@hourly",
    }
)

_FIELD_PART = re.compile(
    r"^(\*|\d+)(?:/(\d+))?$|"
    r"^(\d+)-(\d+)(?:/(\d+))?$|"
    r"^(\d+)$"
)


def _validate_field(name: str, value: str, lo: int, hi: int) -> None:
    raw = (value or "").strip()
    if not raw:
        raise ValueError(f"Invalid cron {name}: empty value.")
    if "\n" in raw or "\r" in raw:
        raise ValueError(f"Invalid cron {name}: newlines are not allowed.")

    parts = raw.split(",")
    for part in parts:
        token = part.strip()
        if token == "*":
            continue
        if "/" in token and not token.startswith("*/"):
            raise ValueError(f"Invalid cron {name}: '{token}'.")
        m = re.match(r"^(\*|\d+)(?:/(\d+))?$", token)
        if m:
            base, step = m.group(1), m.group(2)
            if step is not None and int(step) < 1:
                raise ValueError(f"Invalid cron {name} step in '{token}'.")
            if base != "*":
                n = int(base)
                if n < lo or n > hi:
                    raise ValueError(f"Invalid cron {name}: {n} out of range {lo}-{hi}.")
            continue
        m = re.match(r"^(\d+)-(\d+)(?:/(\d+))?$", token)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if a > b or a < lo or b > hi:
                raise ValueError(f"Invalid cron {name}: range '{token}' out of bounds.")
            if m.group(3) is not None and int(m.group(3)) < 1:
                raise ValueError(f"Invalid cron {name}: invalid step in '{token}'.")
            continue
        raise ValueError(f"Invalid cron {name}: '{token}'.")


def validate_cron_schedule(schedule: Dict[str, str]) -> None:
    """Raise ValueError when any time field is not a valid cron expression."""
    _validate_field("minute", schedule.get("minute", "*"), 0, 59)
    _validate_field("hour", schedule.get("hour", "*"), 0, 23)
    _validate_field("day", schedule.get("day", "*"), 1, 31)
    _validate_field("month", schedule.get("month", "*"), 1, 12)
    _validate_field("weekday", schedule.get("weekday", "*"), 0, 7)


def validate_cron_command(command: str) -> None:
    cmd = (command or "").strip()
    if not cmd:
        raise ValueError("Command is required.")
    if "\n" in cmd or "\r" in cmd:
        raise ValueError("Command must not contain newlines.")
    lowered = cmd.lower()
    for macro in _CRON_MACROS:
        if lowered.startswith(macro):
            raise ValueError("Use the schedule fields for timing; @macros are not allowed in command.")
