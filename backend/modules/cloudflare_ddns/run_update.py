#!/usr/bin/env python3
"""CLI entrypoint for cron-triggered and daemonized Cloudflare DDNS updates."""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

LOCAL_BACKEND_ROOT = Path(__file__).resolve().parents[2]
for candidate in (Path("/opt/copanel/backend"), LOCAL_BACKEND_ROOT):
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from modules.cloudflare_ddns.logic import (  # noqa: E402
    DEFAULT_INTERVAL_MINUTES,
    MIN_WORKER_INTERVAL_SECONDS,
    WorkerAlreadyRunningError,
    acquire_worker_lock,
    compute_backoff_seconds,
    interval_minutes_to_seconds,
    normalize_interval_minutes,
    run_all_ddns,
    run_ddns_for_interval,
)


def _ts() -> str:
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %z")


def _log_line(message: str) -> None:
    print(f"[{_ts()}] {message}", flush=True)


def run_once(
    *,
    interval_minutes: int = 0,
    run_all: bool = False,
    log_fn: Callable[[str], None] = _log_line,
) -> int:
    """Execute one DDNS update pass and return exit code (0 on success, 1 on any failure)."""
    exit_code = 0

    if run_all or interval_minutes <= 0:
        label = "run_all_ddns start" if run_all else "run_all_ddns start (default)"
        log_fn(label)
        try:
            results: List[Dict[str, Any]] = run_all_ddns()
        except Exception as exc:
            log_fn(f"FAIL run_all_ddns error: {exc}")
            return 1
        for row in results:
            if row.get("ok"):
                log_fn(f"OK {row.get('name')}: {row.get('status', row)}")
            else:
                exit_code = 1
                log_fn(f"FAIL {row.get('name')}: {row.get('error')}")
        log_fn(f"run_all_ddns done ({len(results)} profile(s))")
        return exit_code

    safe_minutes = normalize_interval_minutes(interval_minutes)
    log_fn(f"run_ddns_for_interval start interval={safe_minutes}m")
    try:
        results = run_ddns_for_interval(safe_minutes)
    except Exception as exc:
        log_fn(f"FAIL run_ddns_for_interval error: {exc}")
        return 1

    if not results:
        log_fn(f"no enabled profiles for interval={safe_minutes}m")
        return 0

    for row in results:
        if row.get("ok"):
            log_fn(
                f"OK {row.get('name')}: status={row.get('status')} ip={row.get('ip', '?')}"
            )
        else:
            exit_code = 1
            log_fn(f"FAIL {row.get('name')}: {row.get('error')}")
    log_fn(f"run_ddns_for_interval done ({len(results)} profile(s))")
    return exit_code


def run_worker_loop(
    *,
    interval_minutes: int = DEFAULT_INTERVAL_MINUTES,
    run_all: bool = False,
    max_iterations: Optional[int] = None,
    sleep_fn: Callable[[float], None] = time.sleep,
    stop_check: Optional[Callable[[], bool]] = None,
    log_fn: Callable[[str], None] = _log_line,
) -> int:
    """Run periodic DDNS updates, always sleeping between iterations on both success and failure."""
    safe_minutes = normalize_interval_minutes(
        interval_minutes if interval_minutes and interval_minutes > 0 else DEFAULT_INTERVAL_MINUTES
    )
    base_sleep_seconds = max(MIN_WORKER_INTERVAL_SECONDS, interval_minutes_to_seconds(safe_minutes))
    consecutive_failures = 0
    iteration = 0
    last_exit_code = 0

    while True:
        if stop_check is not None and stop_check():
            break

        iteration += 1
        sleep_seconds = base_sleep_seconds
        try:
            rc = run_once(
                interval_minutes=0 if run_all else safe_minutes,
                run_all=run_all,
                log_fn=log_fn,
            )
            last_exit_code = rc
            if rc == 0:
                consecutive_failures = 0
                sleep_seconds = base_sleep_seconds
            else:
                consecutive_failures += 1
                sleep_seconds = compute_backoff_seconds(base_sleep_seconds, consecutive_failures)
                log_fn(
                    f"DDNS cycle reported error(s) (streak={consecutive_failures}); "
                    f"backing off for {sleep_seconds}s"
                )
        except Exception as exc:
            last_exit_code = 1
            consecutive_failures += 1
            sleep_seconds = compute_backoff_seconds(base_sleep_seconds, consecutive_failures)
            log_fn(
                f"Unhandled exception in DDNS worker (streak={consecutive_failures}): {exc}; "
                f"backing off for {sleep_seconds}s"
            )

        if max_iterations is not None and iteration >= max_iterations:
            break
        if stop_check is not None and stop_check():
            break

        sleep_fn(max(MIN_WORKER_INTERVAL_SECONDS, int(sleep_seconds)))

    return last_exit_code


def main(argv: Optional[List[str]] = None) -> int:
    if os.name != "nt" and os.geteuid() != 0:
        _log_line(
            "WARNING: not running as root — store file is root-only. "
            "Use: sudo /opt/copanel/venv/bin/python .../run_update.py --interval 5"
        )

    parser = argparse.ArgumentParser(description="Run Cloudflare DDNS updates")
    parser.add_argument("--interval", type=int, default=0, help="Only profiles with this interval (minutes)")
    parser.add_argument("--all", action="store_true", help="Run all enabled profiles")
    parser.add_argument(
        "--daemon",
        "--loop",
        dest="daemon",
        action="store_true",
        help="Run continuously, sleeping at least 60s between updates with backoff on errors",
    )
    parser.add_argument(
        "--max-iterations",
        type=int,
        default=None,
        help="Optional iteration cap when running with --daemon (for testing)",
    )
    args = parser.parse_args(argv)

    raw_interval = int(args.interval or 0)
    effective_interval = normalize_interval_minutes(raw_interval) if raw_interval > 0 else 0
    scope = f"interval_{effective_interval}m" if (effective_interval > 0 and not args.all) else "all"

    try:
        with acquire_worker_lock(scope=scope):
            if args.daemon:
                loop_minutes = effective_interval if effective_interval > 0 else DEFAULT_INTERVAL_MINUTES
                return run_worker_loop(
                    interval_minutes=loop_minutes,
                    run_all=args.all or effective_interval <= 0,
                    max_iterations=args.max_iterations,
                )
            return run_once(interval_minutes=effective_interval, run_all=args.all)
    except WorkerAlreadyRunningError as exc:
        _log_line(f"SKIP: {exc}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
