"""Tests for Cloudflare DDNS worker loop, interval enforcement, error backoff, and single-instance lock."""
from __future__ import annotations

import json
import signal
from pathlib import Path
from typing import Any, Dict, List

import pytest

from modules.cloudflare_ddns import logic, run_update


@pytest.fixture
def isolated_ddns_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    cfg_dir = tmp_path / "config"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    log_dir = tmp_path / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    lock_dir = cfg_dir / "locks"
    lock_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(logic, "CONFIG_DIR", cfg_dir)
    monkeypatch.setattr(logic, "STORE_PATH", cfg_dir / "cloudflare_ddns.json")
    monkeypatch.setattr(logic, "LEGACY_STORE_PATHS", ())
    monkeypatch.setattr(logic, "LOG_DIR", log_dir)
    monkeypatch.setattr(logic, "LOCK_DIR", lock_dir)
    return tmp_path


def test_interval_minimum_and_seconds_conversion() -> None:
    """Intervals <= 0 or < 1 minute are clamped to at least 1 minute (60 seconds)."""
    assert logic.normalize_interval_minutes(0) == 5
    assert logic.normalize_interval_minutes(-10) == 5
    assert logic.normalize_interval_minutes(1) == 1
    assert logic.normalize_interval_minutes(5) == 5
    assert logic.normalize_interval_minutes(99999) == 1440

    # Even if a small value is passed, worker sleep is never below 60 seconds (5s is forbidden).
    assert logic.interval_minutes_to_seconds(0) >= 60
    assert logic.interval_minutes_to_seconds(1) == 60
    assert logic.interval_minutes_to_seconds(5) == 300


def test_compute_backoff_seconds_grows_and_caps() -> None:
    base = 60
    assert logic.compute_backoff_seconds(base, 0) == 60
    assert logic.compute_backoff_seconds(base, 1) == 60
    assert logic.compute_backoff_seconds(base, 2) == 120
    assert logic.compute_backoff_seconds(base, 3) == 240
    assert logic.compute_backoff_seconds(base, 4) == 480
    assert logic.compute_backoff_seconds(base, 20) == logic.MAX_WORKER_BACKOFF_SECONDS
    # If base interval is already larger than initial backoff (e.g. 5m = 300s), never sleep less than base.
    assert logic.compute_backoff_seconds(300, 1) == 300
    assert logic.compute_backoff_seconds(300, 3) == 300
    assert logic.compute_backoff_seconds(300, 4) == 480


def test_worker_loop_sleeps_on_success(isolated_ddns_env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Proves the loop sleeps between iterations on the success path."""
    sleeps: List[float] = []
    logs: List[str] = []

    monkeypatch.setattr(
        run_update,
        "run_ddns_for_interval",
        lambda m: [{"ok": True, "id": "p1", "name": "home", "status": "unchanged", "ip": "203.0.113.10"}],
    )

    rc = run_update.run_worker_loop(
        interval_minutes=5,
        max_iterations=3,
        sleep_fn=lambda s: sleeps.append(s),
        log_fn=logs.append,
    )

    assert rc == 0
    # 3 iterations -> 2 sleeps between iterations, each 300s (5 minutes)
    assert sleeps == [300, 300]
    assert all(s >= logic.MIN_WORKER_INTERVAL_SECONDS for s in sleeps)


def test_worker_loop_sleeps_with_backoff_on_failure_and_exceptions(
    isolated_ddns_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Proves the loop always sleeps (with backoff) when IP lookup / Cloudflare API fails or raises."""
    sleeps: List[float] = []
    logs: List[str] = []
    call_count = 0

    def fake_run_for_interval(minutes: int) -> List[Dict[str, Any]]:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return [{"ok": False, "id": "p1", "name": "home", "error": "Failed to detect public IP"}]
        if call_count == 2:
            raise RuntimeError("Cloudflare API timeout")
        if call_count == 3:
            return [{"ok": False, "id": "p1", "name": "home", "error": "Cloudflare 502 Bad Gateway"}]
        return [{"ok": True, "id": "p1", "name": "home", "status": "updated", "ip": "198.51.100.7"}]

    monkeypatch.setattr(run_update, "run_ddns_for_interval", fake_run_for_interval)

    rc = run_update.run_worker_loop(
        interval_minutes=1,  # 60s base
        max_iterations=5,
        sleep_fn=lambda s: sleeps.append(s),
        log_fn=logs.append,
    )

    assert rc == 0
    # Iterations 1, 2, 3 fail -> backoff 60s, 120s, 240s; Iteration 4 succeeds -> resets to 60s
    assert sleeps == [60, 120, 240, 60]
    assert all(s >= logic.MIN_WORKER_INTERVAL_SECONDS for s in sleeps)


def test_worker_loop_clamps_sub_minute_interval(
    isolated_ddns_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Even if interval_minutes=0 or negative is passed, worker enforces >= 60s sleep."""
    sleeps: List[float] = []
    monkeypatch.setattr(run_update, "run_all_ddns", lambda: [])

    run_update.run_worker_loop(
        interval_minutes=0,
        run_all=True,
        max_iterations=2,
        sleep_fn=lambda s: sleeps.append(s),
        log_fn=lambda _: None,
    )
    assert len(sleeps) == 1
    assert sleeps[0] >= 60


def test_single_instance_lock_prevents_duplicate_workers(isolated_ddns_env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Holding the worker lock causes a second worker invocation for the same scope to exit cleanly without running."""
    ran_inner = False

    def fake_run_once(**kwargs: Any) -> int:
        nonlocal ran_inner
        ran_inner = True
        return 0

    monkeypatch.setattr(run_update, "run_once", fake_run_once)

    with logic.acquire_worker_lock(scope="interval_5m"):
        with pytest.raises(logic.WorkerAlreadyRunningError):
            with logic.acquire_worker_lock(scope="interval_5m"):
                pass

        # CLI main() catches WorkerAlreadyRunningError and returns 0 without spawning duplicate work
        rc = run_update.main(["--interval", "5"])
        assert rc == 0
        assert ran_inner is False

    # After lock is released, worker runs normally
    rc2 = run_update.main(["--interval", "5"])
    assert rc2 == 0
    assert ran_inner is True


def test_terminate_duplicate_workers_cleans_orphan_processes(tmp_path: Path) -> None:
    """terminate_duplicate_workers finds orphan run_update.py processes in /proc and sends SIGTERM."""
    fake_proc = tmp_path / "proc"
    fake_proc.mkdir()

    def write_proc(pid: int, args: List[str]) -> None:
        pdir = fake_proc / str(pid)
        pdir.mkdir()
        (pdir / "cmdline").write_bytes(b"\x00".join(a.encode("utf-8") for a in args) + b"\x00")

    write_proc(
        41234,
        [
            "/opt/copanel/venv/bin/python",
            "/opt/copanel/backend/modules/cloudflare_ddns/run_update.py",
            "--interval",
            "5",
        ],
    )
    write_proc(41235, ["/usr/sbin/cron", "-f"])
    write_proc(99999, ["/opt/copanel/venv/bin/python", "-m", "uvicorn", "main:app"])

    killed: List[tuple[int, int]] = []
    out = logic.terminate_duplicate_workers(
        exclude_pids={99999},
        proc_root=fake_proc,
        kill_fn=lambda pid, sig: killed.append((pid, sig)),
    )

    assert out == [41234]
    assert killed == [(41234, signal.SIGTERM)]


def test_sync_crontab_kills_orphans_and_formats_valid_schedules(
    isolated_ddns_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Saving settings / syncing crontab cleans up duplicate workers and writes valid cron expressions."""
    written_crontabs: List[str] = []
    terminated_calls: List[int] = []

    monkeypatch.setattr(logic, "IS_WINDOWS", False)
    monkeypatch.setattr(logic, "terminate_duplicate_workers", lambda **kw: terminated_calls.append(1) or [])
    monkeypatch.setattr(logic, "_ensure_crontab", lambda: (True, ""))
    monkeypatch.setattr(logic, "ensure_cron_service", lambda: True)

    class DummyCompleted:
        def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = "") -> None:
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = stderr

    def fake_subprocess_run(cmd: List[str], **kwargs: Any) -> DummyCompleted:
        assert kwargs.get("shell") is False
        assert kwargs.get("timeout") is not None
        if cmd == ["crontab", "-l"]:
            return DummyCompleted(
                0,
                stdout=(
                    "# user job\n"
                    "0 1 * * * /bin/true\n"
                    "*/5 * * * * /opt/copanel/venv/bin/python /opt/copanel/backend/modules/cloudflare_ddns/run_update.py --interval 5\n"
                ),
            )
        if cmd == ["crontab", "-"]:
            written_crontabs.append(kwargs.get("input") or "")
            return DummyCompleted(0)
        return DummyCompleted(0)

    monkeypatch.setattr(logic.subprocess, "run", fake_subprocess_run)

    # Create profiles with 5m and 120m intervals
    p1 = logic.create_ddns_profile({"name": "Home", "zone_id": "z1", "interval_minutes": 5})
    p2 = logic.create_ddns_profile({"name": "Office", "zone_id": "z1", "interval_minutes": 120})
    assert p1["interval_minutes"] == 5
    assert p2["interval_minutes"] == 120

    assert len(terminated_calls) >= 2
    final_cron = written_crontabs[-1]
    assert "0 1 * * * /bin/true" in final_cron
    assert "*/5 * * * *" in final_cron
    assert "0 */2 * * *" in final_cron
    # Orphan duplicate line outside managed block was stripped
    assert final_cron.count("--interval 5") == 1


def test_run_ddns_profile_persists_error_when_token_missing(isolated_ddns_env: Path) -> None:
    """Missing API token records error state on profile without hanging."""
    store = logic._load_store()
    store["api_token"] = ""
    store["ddns_profiles"] = [
        {
            "id": "ddns_test1",
            "name": "Test",
            "zone_id": "z1",
            "zone_name": "example.com",
            "record_name": "home",
            "record_type": "A",
            "proxied": False,
            "ttl": 1,
            "ip_source": "public",
            "interface_name": "",
            "custom_ip_url": "",
            "interval_minutes": 5,
            "enabled": True,
        }
    ]
    logic._save_store(store)

    results = logic.run_ddns_for_interval(5)
    assert len(results) == 1
    assert results[0]["ok"] is False
    assert "token" in results[0]["error"].lower()

    updated = json.loads(logic.STORE_PATH.read_text(encoding="utf-8"))
    prof = updated["ddns_profiles"][0]
    assert prof["last_status"] == "error"
    assert prof["last_run"] is not None
