"""Cron schedule field validation."""
from __future__ import annotations

import re
from typing import Dict, Tuple

_FIELD_LIMITS: Dict[str, Tuple[int, int]] = {
    "minute": (0, 59),
    "hour": (0, 23),
    "day": (1, 31),
    "month": (1, 12),
    "weekday": (0, 7),
}

_STEP_RE = re.compile(r"^\*/(\d+)$")
_RANGE_RE = re.compile(r"^(\d+)-(\d+)(?:/(\d+))?$")


def _validate_part(part: str, lo: int, hi: int) -> None:
    part = part.strip()
    if part == "*":
        return
    step = _STEP_RE.match(part)
    if step:
        n = int(step.group(1))
        if n < 1:
            raise ValueError(f"Invalid cron step: {part}")
        return
    rng = _RANGE_RE.match(part)
    if rng:
        a, b = int(rng.group(1)), int(rng.group(2))
        if a > b or not (lo <= a <= hi and lo <= b <= hi):
            raise ValueError(f"Cron value out of range: {part}")
        if rng.group(3) and int(rng.group(3)) < 1:
            raise ValueError(f"Invalid cron step: {part}")
        return
    if part.isdigit():
        v = int(part)
        if not lo <= v <= hi:
            raise ValueError(f"Cron value out of range: {part}")
        return
    raise ValueError(f"Invalid cron field: {part}")


def validate_cron_field(name: str, value: str) -> str:
    lo, hi = _FIELD_LIMITS[name]
    raw = (value or "").strip()
    if not raw:
        raise ValueError(f"Cron field {name} is required.")
    if any(ch in raw for ch in ("\n", "\r", "\0")):
        raise ValueError(f"Cron field {name} must not contain newlines.")
    for segment in raw.split(","):
        _validate_part(segment, lo, hi)
    return raw


def validate_cron_schedule(schedule: Dict[str, str]) -> Dict[str, str]:
    return {
        "minute": validate_cron_field("minute", schedule.get("minute", "*")),
        "hour": validate_cron_field("hour", schedule.get("hour", "*")),
        "day": validate_cron_field("day", schedule.get("day", "*")),
        "month": validate_cron_field("month", schedule.get("month", "*")),
        "weekday": validate_cron_field("weekday", schedule.get("weekday", "*")),
    }


def validate_cron_command(command: str) -> str:
    cmd = (command or "").strip()
    if not cmd:
        raise ValueError("Command is required.")
    if any(ch in cmd for ch in ("\n", "\r", "\0")):
        raise ValueError("Command must not contain newlines.")
    return cmd
