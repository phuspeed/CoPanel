"""Web Panel Update runs install.sh detached from copanel.service and reports
through files that survive the service restart."""
import json
import os
import subprocess
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.auth as auth_mod
import core.panel_update as pu
import core.panel_update_runner as runner
from core.api import install_exception_handlers

ROOT = Path(__file__).resolve().parents[2]
INSTALL_SH = ROOT / "scripts" / "install.sh"


@pytest.fixture
def state_dir(tmp_path, monkeypatch):
    d = tmp_path / "update-state"
    monkeypatch.setenv("COPANEL_UPDATE_STATE_DIR", str(d))
    monkeypatch.setattr(pu, "check_for_update", lambda: {"remote_version": "9.9.9"})
    monkeypatch.setattr(pu, "read_local_version", lambda: "1.0.0")
    return d


# ── launch command ──────────────────────────────────────────────────────────


def test_launch_command_is_systemd_run_argv(tmp_path):
    cmd = pu.build_launch_command("/usr/bin/python3", tmp_path / "runner.py", tmp_path / "s", Path("/opt/copanel"))
    assert isinstance(cmd, list) and all(isinstance(a, str) for a in cmd)
    assert cmd[0] == "systemd-run"
    assert "--unit=copanel-update" in cmd
    assert "--collect" in cmd
    # The updater itself: python + runner copy, never a shell string.
    i = cmd.index("/usr/bin/python3")
    assert cmd[i + 1] == str(tmp_path / "runner.py")
    assert "--state-dir" in cmd and "--home" in cmd
    assert not any(a in ("sh", "bash", "-c", "/bin/sh", "/bin/bash") for a in cmd)


def test_launch_uses_systemd_run_without_shell(state_dir, monkeypatch):
    calls = []

    def fake_run(cmd, **kw):
        calls.append((cmd, kw))
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(pu, "systemd_run_available", lambda: True)
    monkeypatch.setattr(pu._subprocess, "run", fake_run)
    monkeypatch.setattr(pu, "_unit_active", lambda: True)
    st = pu.launch_update(actor="admin")
    (cmd, kw), = [c for c in calls if c[0][0] == "systemd-run"]
    assert kw.get("shell", False) is False
    assert isinstance(cmd, list)
    assert (state_dir / "runner.py").is_file()
    state = json.loads((state_dir / "state.json").read_text())
    assert state["status"] == "starting" and state["mode"] == "systemd"
    assert state["unit"] == "copanel-update" and state["target_version"] == "9.9.9"
    assert st["status"] == "starting"
    # A second start while the unit is active is refused.
    with pytest.raises(pu.UpdateAlreadyRunning):
        pu.launch_update()


def test_launch_failure_is_reported(state_dir, monkeypatch):
    monkeypatch.setattr(pu, "systemd_run_available", lambda: True)
    monkeypatch.setattr(
        pu._subprocess, "run", lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1, "", "Access denied")
    )
    with pytest.raises(RuntimeError, match="Access denied"):
        pu.launch_update()
    assert json.loads((state_dir / "state.json").read_text())["status"] == "failed"


def test_fallback_without_systemd_starts_new_session(state_dir, monkeypatch):
    seen = {}

    class FakePopen:
        pid = 4242

        def __init__(self, cmd, **kw):
            seen["cmd"], seen["kw"] = cmd, kw

    monkeypatch.setattr(pu, "systemd_run_available", lambda: False)
    monkeypatch.setattr(pu._subprocess, "Popen", FakePopen)
    pu.launch_update()
    assert seen["kw"]["start_new_session"] is True
    assert "shell" not in seen["kw"]
    assert seen["cmd"][1] == str(state_dir / "runner.py")
    assert json.loads((state_dir / "state.json").read_text())["pid"] == 4242


# ── status ──────────────────────────────────────────────────────────────────


def test_status_reads_log_incrementally(state_dir):
    state_dir.mkdir(parents=True)
    runner.write_state(state_dir, status="success", exit_code=0, mode="systemd")
    (state_dir / "update.log").write_bytes(b"line1\nline2\n")
    st = pu.update_status(0)
    assert st["status"] == "success" and st["exit_code"] == 0
    assert st["log"] == "line1\nline2\n" and st["offset"] == 12
    st2 = pu.update_status(6)
    assert st2["log"] == "line2\n"
    # Offset past the end (new run truncated the log): restart from the top.
    st3 = pu.update_status(999)
    assert st3["log"] == "line1\nline2\n"


def test_status_detects_dead_updater(state_dir, monkeypatch):
    state_dir.mkdir(parents=True)
    runner.write_state(state_dir, status="running", mode="systemd", started_at=time.time())
    monkeypatch.setattr(pu, "_unit_active", lambda: False)
    assert pu.update_status()["status"] == "interrupted"
    monkeypatch.setattr(pu, "_unit_active", lambda: True)
    assert pu.update_status()["status"] == "running"


def test_status_idle_without_state(state_dir):
    assert pu.update_status()["status"] == "idle"


# ── runner (the detached process) ───────────────────────────────────────────


def _fake_home(tmp_path, body):
    home = tmp_path / "home"
    (home / "scripts").mkdir(parents=True)
    (home / "scripts" / "install.sh").write_text(body)
    return home


@pytest.mark.parametrize("code,status", [(0, "success"), (3, "failed")])
def test_runner_runs_staged_installer_and_records_exit(tmp_path, monkeypatch, code, status):
    monkeypatch.setenv("COPANEL_ENV", "inherited")
    home = _fake_home(
        tmp_path,
        'echo "dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\n'
        'echo "noninteractive=${COPANEL_NONINTERACTIVE:-}"\n'
        'echo "copanel_env=${COPANEL_ENV:-unset}"\n'
        f"exit {code}\n",
    )
    sd = tmp_path / "state"
    rc = runner.main(["--state-dir", str(sd), "--home", str(home)])
    assert rc == (0 if code == 0 else 1)
    log = (sd / "update.log").read_text()
    # install.sh runs from a copy outside the panel tree (takes its git-update path).
    assert f"dir={sd}" in log
    assert "noninteractive=1" in log
    assert "copanel_env=unset" in log
    assert f"__COPANEL_EXIT__:{code}" in log
    state = json.loads((sd / "state.json").read_text())
    assert state["status"] == status and state["exit_code"] == code


def test_router_endpoints(state_dir, monkeypatch):
    from modules.platform.router import router

    who = {"user": {"id": 1, "username": "admin", "role": "superadmin"}}
    monkeypatch.setattr(auth_mod, "_AUTH_DISABLED", False)
    monkeypatch.setattr(auth_mod, "_user_from_token", lambda _a: who["user"])
    monkeypatch.setattr(pu, "install_script_path", lambda: INSTALL_SH)
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(router, prefix="/api/platform")
    client = TestClient(app)
    client.headers["Authorization"] = "Bearer x"

    r = client.get("/api/platform/panel-update/status")
    assert r.status_code == 200 and r.json()["data"]["status"] == "idle"

    monkeypatch.setattr(pu, "launch_update", lambda actor=None: {"status": "starting", "actor": actor})
    monkeypatch.setattr("modules.platform.router.record_audit", lambda *a, **k: None)
    r = client.post("/api/platform/panel-update/run")
    assert r.status_code == 200, r.text
    assert r.json()["data"] == {"status": "starting", "actor": "admin"}

    def busy(actor=None):
        raise pu.UpdateAlreadyRunning("A panel update is already running.")

    monkeypatch.setattr(pu, "launch_update", busy)
    assert client.post("/api/platform/panel-update/run").status_code == 409

    who["user"] = {"id": 2, "username": "u", "role": "user", "permitted_modules": "[]"}
    assert client.get("/api/platform/panel-update/status").status_code == 403
    assert client.post("/api/platform/panel-update/run").status_code == 403


# ── install.sh: apt recovery and prebuilt frontend on low-RAM hosts ─────────


def _bash(script: str, env=None) -> subprocess.CompletedProcess:
    full_env = {**os.environ, **(env or {})}
    return subprocess.run(
        ["bash", "-c", f'source "{INSTALL_SH}"\n{script}'],
        capture_output=True,
        text=True,
        env=full_env,
        timeout=60,
    )


APT_LOG = """Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease
Hit:2 https://download.docker.com/linux/ubuntu noble InRelease
Hit:3 https://deb.nodesource.com/node_20.x nodistro InRelease
Get:4 https://ppa.launchpadcontent.net/ondrej/php/ubuntu noble InRelease [24.3 kB]
E: Repository 'https://ppa.launchpadcontent.net/ondrej/php/ubuntu noble InRelease' changed its 'Label' value from '***** The main PPA for supported PHP versions with many PECL extensions *****' to '(deprecated)'
W: https://download.docker.com/linux/ubuntu/dists/noble/InRelease: Key is stored in legacy trusted.gpg keyring
"""


@pytest.fixture
def apt_dir(tmp_path):
    d = tmp_path / "sources.list.d"
    d.mkdir()
    (d / "ubuntu.sources").write_text("URIs: http://archive.ubuntu.com/ubuntu\nSuites: noble\n")
    (d / "docker.list").write_text("deb https://download.docker.com/linux/ubuntu noble stable\n")
    (d / "nodesource.list").write_text("deb https://deb.nodesource.com/node_20.x nodistro main\n")
    (d / "ondrej-ubuntu-php-noble.sources").write_text(
        "URIs: https://ppa.launchpadcontent.net/ondrej/php/ubuntu/\nSuites: noble\n"
    )
    log = tmp_path / "apt.log"
    log.write_text(APT_LOG)
    return d, log


def test_apt_failed_sources_only_names_the_failing_one(apt_dir):
    d, log = apt_dir
    r = _bash(f'copanel_apt_failed_source_list_files "{log}"', {"COPANEL_APT_SOURCES_DIR": str(d)})
    assert r.returncode == 0, r.stderr
    assert r.stdout.split() == [str(d / "ondrej-ubuntu-php-noble.sources")]


def test_apt_never_disables_distro_sources(apt_dir):
    d, log = apt_dir
    log.write_text("Err:1 http://archive.ubuntu.com/ubuntu noble InRelease\nE: Failed to fetch http://archive.ubuntu.com/ubuntu/dists/noble/InRelease\n")
    r = _bash(
        f'copanel_apt_failed_source_list_files "{log}"; copanel_disable_apt_source_file "{d}/ubuntu.sources" || echo rc=$?',
        {"COPANEL_APT_SOURCES_DIR": str(d)},
    )
    listed = [l for l in r.stdout.splitlines() if l.startswith(str(d))]
    assert listed == []
    assert "rc=1" in r.stdout
    assert (d / "ubuntu.sources").is_file()


def test_apt_restores_sources_disabled_by_older_installs(apt_dir):
    d, _ = apt_dir
    for name in ("ubuntu.sources", "docker.list"):
        (d / name).rename(d / f"{name}.copanel-bak")
    (d / "keep.list").write_text("x")
    (d / "keep.list.copanel-bak").write_text("older copy")
    r = _bash("copanel_apt_restore_disabled_sources", {"COPANEL_APT_SOURCES_DIR": str(d)})
    assert r.returncode == 0, r.stderr
    assert (d / "ubuntu.sources").is_file() and (d / "docker.list").is_file()
    assert not (d / "ubuntu.sources.copanel-bak").exists()
    # An existing file is never overwritten by a backup.
    assert (d / "keep.list").read_text() == "x"


def test_apt_accepts_release_info_change_before_disabling():
    text = INSTALL_SH.read_text(encoding="utf-8")
    start = text.index("apt_update_or_recover() {")
    body = text[start : text.index("\n}\n", start)]
    assert "--allow-releaseinfo-change" in body
    assert body.index("--allow-releaseinfo-change") < body.index("copanel_apt_failed_source_list_files")


def _prebuilt_env(tmp_path):
    home = tmp_path / "copanel"
    (home / "frontend" / "prebuilt").mkdir(parents=True)
    (home / "frontend" / "prebuilt" / "dist.tar.gz").write_bytes(b"x")
    return home


@pytest.mark.parametrize(
    "mem,avx,force,expected",
    [
        ("952", 1, "0", "yes"),  # low RAM + current prebuilt -> skip Vite
        ("3000", 1, "0", "no"),  # enough RAM -> normal build
        ("952", 1, "1", "no"),  # COPANEL_FORCE_FRONTEND_BUILD=1
        ("8000", 0, "0", "yes"),  # no AVX -> always prebuilt
    ],
)
def test_prebuilt_frontend_choice(tmp_path, mem, avx, force, expected):
    home = _prebuilt_env(tmp_path)
    script = (
        f'CoPanel_HOME="{home}"\n'
        f"copanel_cpu_has_avx() {{ return {0 if avx else 1}; }}\n"
        "copanel_frontend_preserved_module_ids() { :; }\n"
        "if copanel_should_use_prebuilt_frontend; then echo yes; else echo no; fi\n"
    )
    r = _bash(script, {"COPANEL_MEM_TOTAL_MB": mem, "COPANEL_FORCE_FRONTEND_BUILD": force})
    assert r.stdout.strip().splitlines()[-1] == expected, r.stderr


def test_low_ram_keeps_vite_when_appstore_module_needs_it(tmp_path):
    home = _prebuilt_env(tmp_path)
    mod = home / "frontend" / "src" / "modules" / "demo_app"
    mod.mkdir(parents=True)
    (mod / "index.tsx").write_text("export default null;")
    script = (
        f'CoPanel_HOME="{home}"\n'
        "copanel_cpu_has_avx() { return 0; }\n"
        "copanel_frontend_preserved_module_ids() { echo demo_app; }\n"
        "if copanel_should_use_prebuilt_frontend; then echo yes; else echo no; fi\n"
    )
    r = _bash(script, {"COPANEL_MEM_TOTAL_MB": "952"})
    assert r.stdout.strip().splitlines()[-1] == "no", r.stderr
