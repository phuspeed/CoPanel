#!/usr/bin/env python3
"""CLI entrypoint for cron-triggered backup profile sync."""
import sys
from pathlib import Path

BACKEND_ROOT = Path("/opt/copanel/backend")
if BACKEND_ROOT.is_dir() and str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from modules.backup_manager.logic import BackupTaskEngine  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: run_sync.py <profile_id>", file=sys.stderr)
        return 2
    try:
        profile_id = int(sys.argv[1])
    except ValueError:
        print("profile_id must be an integer", file=sys.stderr)
        return 2
    BackupTaskEngine.run_sync_task(profile_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
