from __future__ import annotations


def format_bytes(n: float | int | None) -> str:
    if n is None or not isinstance(n, (int, float)) or n < 0:
        return "—"
    units = ["B", "K", "M", "G", "T"]
    value = float(n)
    i = 0
    while value >= 1024 and i < len(units) - 1:
        value /= 1024
        i += 1
    if i == 0:
        return f"{int(value)}{units[i]}"
    return f"{value:.1f}{units[i]}"


def bar(pct: float, width: int = 12) -> str:
    pct = max(0.0, min(100.0, float(pct or 0)))
    filled = int(round((pct / 100.0) * width))
    return "█" * filled + "░" * (width - filled)


def format_uptime(seconds: float | int | None) -> str:
    if not seconds or seconds <= 0:
        return "0m"
    s = int(seconds)
    d, rem = divmod(s, 86400)
    h, rem = divmod(rem, 3600)
    m, _ = divmod(rem, 60)
    if d:
        return f"{d}d {h}h"
    if h:
        return f"{h}h {m}m"
    return f"{m}m"
