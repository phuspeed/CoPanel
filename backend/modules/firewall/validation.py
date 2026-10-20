"""UFW rule validation and ``ufw status`` parsing."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

_PORT_SPEC_RE = re.compile(
    r"^(?P<port>(?:\d{1,5})(?::\d{1,5})?)(?:/(?P<proto>tcp|udp))?$",
    re.IGNORECASE,
)

_UFW_RULE_RE = re.compile(
    r"^(?P<to>.+?)\s+"
    r"(?P<action>ALLOW(?:\s+IN)?|DENY(?:\s+IN)?)\s+"
    r"(?P<from>\S+)"
    r"(?:\s+#\s*(?P<comment>.*))?$",
    re.IGNORECASE,
)


def validate_port_spec(port: str) -> str:
    """Validate a UFW port/range spec (e.g. ``80``, ``443/tcp``, ``8000:8010/udp``)."""
    raw = (port or "").strip()
    if not raw or "\n" in raw or "\r" in raw:
        raise ValueError("Port is required and must not contain newlines.")
    if "(v6)" in raw.lower():
        raise ValueError("Specify IPv4 rules without the (v6) suffix.")
    match = _PORT_SPEC_RE.match(raw)
    if not match:
        raise ValueError(f"Invalid port or range: {port}")
    start_s, end_s = (match.group("port").split(":", 1) + [None])[:2]
    start = int(start_s)
    end = int(end_s) if end_s else start
    if not (1 <= start <= 65535 and 1 <= end <= 65535 and start <= end):
        raise ValueError(f"Port must be between 1 and 65535: {port}")
    proto = (match.group("proto") or "tcp").lower()
    return f"{match.group('port')}/{proto}" if match.group("proto") else raw


def parse_ufw_status_lines(lines: List[str]) -> List[Dict[str, Any]]:
    """Parse ``ufw status`` numbered output into rule dicts."""
    rules: List[Dict[str, Any]] = []
    for line in lines:
        line_strip = line.strip()
        if not line_strip or "Status:" in line_strip:
            continue
        if line_strip.startswith("To ") or line_strip.startswith("--"):
            continue
        line_strip = re.sub(r"^\[\s*\d+\]\s*", "", line_strip)
        match = _UFW_RULE_RE.match(line_strip)
        if not match:
            continue
        port = match.group("to").strip()
        if "(v6)" in port:
            continue
        action = match.group("action").replace(" IN", "").replace(" in", "").strip().upper()
        comment = (match.group("comment") or "").strip()
        rules.append({"port": port, "action": action, "comment": comment})
    return rules
