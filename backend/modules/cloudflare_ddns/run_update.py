#!/usr/bin/env python3
"""CLI entrypoint for cron-triggered Cloudflare DDNS updates."""
import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path("/opt/copanel/backend")
if BACKEND_ROOT.is_dir() and str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from modules.cloudflare_ddns.logic import run_ddns_for_interval, run_all_ddns  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Cloudflare DDNS updates")
    parser.add_argument("--interval", type=int, default=0, help="Only profiles with this interval (minutes)")
    parser.add_argument("--all", action="store_true", help="Run all enabled profiles")
    args = parser.parse_args()

    if args.all:
        run_all_ddns()
        return 0
    if args.interval > 0:
        run_ddns_for_interval(args.interval)
        return 0
    run_all_ddns()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
