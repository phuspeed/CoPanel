#!/usr/bin/env python3
"""Cron entrypoint: renew Let's Encrypt certificates and reload Nginx."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from modules.ssl_manager.auto_renew import AutoRenewManager  # noqa: E402
from modules.ssl_manager.logic import SSLManager  # noqa: E402


def main() -> int:
    result = SSLManager.renew_certificates()
    AutoRenewManager.record_run(result)
    print(json.dumps(result))
    return 0 if result.get("status") == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
