"""1.1.16 security regressions: install ownership, web_services allowlist,
PHP version/module validation, PM2 admin+target validation, and download SHA-256."""
from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.auth as auth_mod
from core.api import install_exception_handlers
from core import sysexec
from modules.auth.router import get_current_user
from modules.system_monitor import logic as sm_logic
from modules.system_monitor import router as sm_router
from modules.web_manager import logic as wm_logic
from modules.web_manager import router as wm_router


INSTALL_SH = Path(__file__).resolve().parents[2] / "scripts" / "install.sh"
ADMINER_SHA256 = "2fd7e6d8f987b243ab1839249551f62adce19704c47d3d0c8dd9e57ea5b9c6b3"


def _wm_client(monkeypatch) -> TestClient:
    app = FastAPI()
    app.include_router(wm_router.router, prefix="/api/web_manager")
    app.dependency_overrides[get_current_user] = lambda: {
        "id": 1,
        "username": "admin",
        "role": "superadmin",
        "permitted_modules": ["all"],
    }
    monkeypatch.setattr(wm_router, "IS_WINDOWS", False)
    monkeypatch.setattr(wm_logic, "IS_WINDOWS", False)
    return TestClient(app)


def _sm_client(monkeypatch, role: str = "superadmin", modules=None) -> TestClient:
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(sm_router.router, prefix="/api/system_monitor")
    user = {
        "id": 2 if role != "superadmin" else 1,
        "username": "operator" if role != "superadmin" else "admin",
        "role": role,
        "permitted_modules": modules if modules is not None else ["system_monitor"],
    }
    monkeypatch.setattr(auth_mod, "_AUTH_DISABLED", False)
    monkeypatch.setattr(auth_mod, "_resolve_user", lambda *_a, **_kw: user)
    return TestClient(app)


# ── Finding 1: install.sh ownership & permissions ────────────────────────────


def test_install_sh_does_not_chown_tree_to_copanel():
    text = INSTALL_SH.read_text(encoding="utf-8")
    assert 'chown -R "$CoPanel_USER:$CoPanel_USER"' not in text
    assert 'chown "${CoPanel_USER}:${CoPanel_USER}"' not in text
    assert 'copanel_run_as "$CoPanel_USER"' not in text
    assert "copanel_harden_install_permissions" in text
    assert "tar --no-same-owner -xzf" in text


def test_install_sh_useradd_uses_nologin_and_no_home_creation():
    text = INSTALL_SH.read_text(encoding="utf-8")
    fn_start = text.index("setup_user_and_dirs()")
    fn_end = text.index("copanel_harden_install_permissions()", fn_start)
    block = text[fn_start:fn_end]
    assert 'useradd -r -s "$nologin_shell" -d "$CoPanel_HOME" -M "$CoPanel_USER"' in block
    assert "copanel_harden_install_permissions" in block


def test_install_sh_repairs_permissions_after_frontend_setup():
    text = INSTALL_SH.read_text(encoding="utf-8")
    main_start = text.index("main()")
    main_block = text[main_start:]
    assert main_block.index("copanel_write_ui_track") < main_block.index("copanel_harden_install_permissions")


def test_harden_install_permissions_behavior(tmp_path):
    home = tmp_path / "copanel"
    for sub in ("backend/data", "venv/bin", "scripts", "frontend/dist", "config/ssl", "backups", "logs", "stacks", ".git"):
        (home / sub).mkdir(parents=True, exist_ok=True)
    (home / "backend" / "main.py").write_text("app = None\n", encoding="utf-8")
    (home / "frontend" / "dist" / "index.html").write_text("<html></html>\n", encoding="utf-8")
    secret = home / "config" / "jwt_secret"
    secret.write_text("supersecret\n", encoding="utf-8")
    secret.chmod(0o644)
    db_file = home / "config" / "copanel.db"
    db_file.write_text("", encoding="utf-8")
    db_file.chmod(0o644)
    home.chmod(0o777)
    (home / "backend" / "main.py").chmod(0o666)

    # Stub chown so non-root pytest can exercise chmod and path logic
    bindir = tmp_path / "bin"
    bindir.mkdir()
    chown_log = tmp_path / "chown.log"
    chown_stub = bindir / "chown"
    chown_stub.write_text(f"#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> {str(chown_log)!r}\nexit 0\n", encoding="utf-8")
    chown_stub.chmod(0o755)

    env = {
        **os.environ,
        "PATH": f"{bindir}:{os.environ.get('PATH', '')}",
        "CoPanel_HOME": str(home),
    }
    cmd = f'source "{INSTALL_SH}" && CoPanel_HOME="{home}" && copanel_harden_install_permissions'
    res = subprocess.run(["bash", "-c", cmd], env=env, capture_output=True, text=True)
    assert res.returncode == 0, res.stderr

    assert stat.S_IMODE(home.stat().st_mode) == 0o755
    assert stat.S_IMODE((home / "config").stat().st_mode) == 0o700
    assert stat.S_IMODE(secret.stat().st_mode) == 0o600
    assert stat.S_IMODE(db_file.stat().st_mode) == 0o600
    assert (stat.S_IMODE((home / "backend" / "main.py").stat().st_mode) & 0o022) == 0
    assert (stat.S_IMODE((home / "frontend" / "dist" / "index.html").stat().st_mode) & 0o044) == 0o044
    assert (stat.S_IMODE((home / "backups").stat().st_mode) & 0o077) == 0
    logged = chown_log.read_text(encoding="utf-8")
    assert "root:root" in logged
    assert "copanel:copanel" not in logged


# ── Finding 2: web_services allowlist + core.sysexec ─────────────────────────


@pytest.mark.parametrize(
    "bad_service",
    [
        "-o=APT::Update::Pre-Invoke::=id",
        "nginx;id",
        "curl",
        "httpd",
        "bad..id",
    ],
)
def test_web_services_rejects_unlisted_service_id(monkeypatch, bad_service):
    called = []
    monkeypatch.setattr(sysexec, "pkg_install", lambda pkgs, **kw: called.append(pkgs) or {"ok": True})
    monkeypatch.setattr(sysexec, "run", lambda cmd, **kw: called.append(cmd))
    monkeypatch.setattr(wm_router.subprocess, "run", lambda *a, **kw: called.append(a))

    client = _wm_client(monkeypatch)
    r = client.post(f"/api/web_manager/web_services/{bad_service}/install")
    assert r.status_code == 400
    assert called == []


@pytest.mark.parametrize("bad_action", ["remove", "purge", "reload", "--help"])
def test_web_services_rejects_unlisted_action(monkeypatch, bad_action):
    called = []
    monkeypatch.setattr(sysexec, "pkg_install", lambda pkgs, **kw: called.append(pkgs) or {"ok": True})
    monkeypatch.setattr(sysexec, "run", lambda cmd, **kw: called.append(cmd))
    client = _wm_client(monkeypatch)
    r = client.post(f"/api/web_manager/web_services/nginx/{bad_action}")
    assert r.status_code == 400
    assert called == []


def test_web_services_install_and_control_use_fixed_mapping_and_sysexec(monkeypatch):
    pkg_calls = []
    run_calls = []
    monkeypatch.setattr(wm_logic, "php_package_family", lambda: "apt")
    monkeypatch.setattr(
        sysexec,
        "pkg_install",
        lambda pkgs, **kw: pkg_calls.append(list(pkgs)) or {"ok": True, "missing": [], "output_tail": ""},
    )

    def fake_run(cmd, **kw):
        run_calls.append((list(cmd), kw))
        if cmd[:3] == ["systemctl", "cat", "--"]:
            return SimpleNamespace(returncode=0 if cmd[3] == "httpd" else 1, stdout="", stderr="")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(sysexec, "run", fake_run)
    client = _wm_client(monkeypatch)

    r1 = client.post("/api/web_manager/web_services/litespeed/install")
    assert r1.status_code == 200
    assert pkg_calls == [["openlitespeed"]]

    r2 = client.post("/api/web_manager/web_services/apache2/restart")
    assert r2.status_code == 200
    assert (["systemctl", "restart", "--", "httpd"], {"timeout": 60, "as_root": True}) in run_calls


# ── Finding 3: PHP version and module validation ─────────────────────────────


@pytest.mark.parametrize("bad_module", ["--help", "-v", "gd;id", "mod/evil", "..", "", "a" * 65])
def test_php_module_toggle_rejects_bad_module(monkeypatch, bad_module):
    called = []
    monkeypatch.setattr(sysexec, "run", lambda *a, **kw: called.append(a))
    client = _wm_client(monkeypatch)
    r = client.post(
        "/api/web_manager/php/module_toggle",
        json={"version": "8.2", "module": bad_module, "enable": True},
    )
    assert r.status_code == 400
    assert called == []


@pytest.mark.parametrize("bad_version", ["9.9", "8.2;id", "8..2", "7.0", "invalid"])
def test_php_endpoints_reject_unsupported_versions(monkeypatch, bad_version):
    called = []
    monkeypatch.setattr(sysexec, "run", lambda *a, **kw: called.append(a))
    client = _wm_client(monkeypatch)

    r1 = client.post(
        "/api/web_manager/php/module_toggle",
        json={"version": bad_version, "module": "mbstring", "enable": True},
    )
    assert r1.status_code == 400

    r2 = client.get(f"/api/web_manager/php/modules/{bad_version}")
    assert r2.status_code == 400

    r3 = client.get(f"/api/web_manager/php/php_ini/{bad_version}")
    assert r3.status_code == 400

    r4 = client.post(f"/api/web_manager/php/php_ini/{bad_version}", json={"content": "memory_limit = 256M"})
    assert r4.status_code == 400
    assert called == []

    with pytest.raises(ValueError):
        wm_logic.get_enabled_modules(bad_version)
    with pytest.raises(ValueError):
        wm_logic.get_php_ini(bad_version)
    with pytest.raises(ValueError):
        wm_logic.install_php_extensions(bad_version, ["curl"])
    with pytest.raises(ValueError):
        wm_logic.get_php_ini("..")
    assert wm_logic.save_php_ini("..", "x")["status"] == "error"


def test_php_module_toggle_allows_valid_input(monkeypatch):
    monkeypatch.setattr(wm_logic.shutil, "which", lambda name: f"/usr/sbin/{name}")
    calls = []

    def fake_run(cmd, timeout=60, **kw):
        calls.append(list(cmd))
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(sysexec, "run", fake_run)
    seq = iter([[], ["mbstring"]])
    monkeypatch.setattr(wm_logic, "get_enabled_modules", lambda ver: next(seq))

    client = _wm_client(monkeypatch)
    r = client.post(
        "/api/web_manager/php/module_toggle",
        json={"version": "8.2", "module": "mbstring", "enable": True},
    )
    assert r.status_code == 200
    assert ["phpenmod", "-v", "8.2", "mbstring"] in calls
    assert ["systemctl", "restart", "--", "php8.2-fpm"] in calls


# ── Finding 4: system_monitor PM2 admin + target validation ──────────────────


def test_pm2_action_requires_admin(monkeypatch):
    monkeypatch.setattr(sm_logic.shutil, "which", lambda _n: "/usr/bin/pm2")
    client = _sm_client(monkeypatch, role="user", modules=["system_monitor"])
    r = client.post("/api/system_monitor/pm2/restart/api")
    assert r.status_code == 403


@pytest.mark.parametrize("bad_target", ["--help", "-f", "a" * 129, "api;id", "bad$name"])
def test_pm2_action_rejects_bad_target(monkeypatch, bad_target):
    called = []
    monkeypatch.setattr(sm_logic.shutil, "which", lambda _n: "/usr/bin/pm2")
    monkeypatch.setattr(sm_logic.subprocess, "run", lambda *a, **kw: called.append(a))
    client = _sm_client(monkeypatch, role="superadmin")
    r = client.post(f"/api/system_monitor/pm2/start/{bad_target}")
    assert r.status_code == 400
    assert called == []
    assert sm_logic.validate_pm2_target("..") is False


def test_pm2_action_rejects_unknown_process_and_bad_action(monkeypatch):
    monkeypatch.setattr(sm_logic.shutil, "which", lambda _n: "/usr/bin/pm2")
    monkeypatch.setattr(sm_logic.SystemMonitor, "get_pm2_processes", staticmethod(lambda: [{"name": "api", "pm_id": 0}]))
    called = []
    monkeypatch.setattr(sm_logic.subprocess, "run", lambda cmd, **kw: called.append(list(cmd)) or SimpleNamespace(returncode=0))

    client = _sm_client(monkeypatch, role="superadmin")
    r_action = client.post("/api/system_monitor/pm2/exec/api")
    assert r_action.status_code == 400

    r_missing = client.post("/api/system_monitor/pm2/start/not_in_jlist")
    assert r_missing.status_code == 400
    assert called == []


def test_pm2_action_passes_double_dash_for_existing_process(monkeypatch):
    monkeypatch.setattr(sm_logic.shutil, "which", lambda _n: "/usr/bin/pm2")
    monkeypatch.setattr(sm_logic.SystemMonitor, "get_pm2_processes", staticmethod(lambda: [{"name": "api", "pm_id": 0}]))
    calls = []
    monkeypatch.setattr(
        sm_logic.subprocess,
        "run",
        lambda cmd, **kw: calls.append(list(cmd)) or SimpleNamespace(returncode=0, stdout="", stderr=""),
    )
    audits = []
    monkeypatch.setattr(sm_router, "record_audit", lambda *a, **kw: audits.append((a, kw)))

    client = _sm_client(monkeypatch, role="superadmin")
    r = client.post("/api/system_monitor/pm2/restart/api")
    assert r.status_code == 200
    assert calls == [["pm2", "restart", "--", "api"]]
    assert len(audits) == 1


# ── Low: SHA-256 verification for Adminer & prebuilt frontend downloads ──────


def test_adminer_install_verifies_sha256(monkeypatch, tmp_path):
    class _FakeResp:
        def __init__(self, data: bytes):
            self._data = data

        def read(self, _n=-1):
            return self._data

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    class _FakeOpener:
        def __init__(self, data: bytes):
            self._data = data

        def open(self, _req, timeout=30):
            return _FakeResp(self._data)

    monkeypatch.setattr(wm_router, "_pkg_manager", lambda: "apt-get")
    monkeypatch.setattr(wm_router.os, "makedirs", lambda *_a, **_kw: None)
    monkeypatch.setattr(wm_router.shutil, "which", lambda _n: None)
    monkeypatch.setattr(wm_router.urllib.request, "build_opener", lambda *_a: _FakeOpener(b"<?php evil(); ?>"))
    client = _wm_client(monkeypatch)
    r = client.post("/api/web_manager/db_admin_tools/adminer/install")
    assert r.status_code == 500
    assert "SHA-256 mismatch" in r.json()["detail"]

    # Matching SHA-256 succeeds and writes atomically via mkstemp -> os.replace
    good_payload = b"<?php /* valid adminer mock */ ?>"
    good_sha = hashlib.sha256(good_payload).hexdigest()
    # Temporarily patch hashlib? Better: compute real payload whose hash isn't hardcoded, or check mkstemp/replace
    out_dir = tmp_path / "adminer"
    out_dir.mkdir()
    real_mkstemp = wm_router.tempfile.mkstemp
    replaced = []
    monkeypatch.setattr(wm_router.tempfile, "mkstemp", lambda **kw: real_mkstemp(dir=str(out_dir)))
    monkeypatch.setattr(wm_router.os, "replace", lambda src, dst: replaced.append((src, dst)))
    monkeypatch.setattr(wm_router.hmac, "compare_digest", lambda a, b: a == hashlib.sha256(good_payload).hexdigest() and b == ADMINER_SHA256)
    monkeypatch.setattr(wm_router.urllib.request, "build_opener", lambda *_a: _FakeOpener(good_payload))
    r_ok = client.post("/api/web_manager/db_admin_tools/adminer/install")
    assert r_ok.status_code == 200
    assert len(replaced) == 1
    assert replaced[0][1] == "/usr/share/adminer/adminer.php"


def test_prebuilt_download_verifies_sha256(tmp_path):
    payload = b"fake-dist-tar-gz-bytes"
    good_sha = hashlib.sha256(payload).hexdigest()
    bad_sha = "0" * 64
    asset_url = "https://github.com/phuspeed/CoPanel/releases/download/v1.1.16/dist.tar.gz"

    bindir = tmp_path / "bin"
    bindir.mkdir()
    payload_file = tmp_path / "payload.bin"
    payload_file.write_bytes(payload)
    meta_file = tmp_path / "meta.json"

    curl_stub = bindir / "curl"
    curl_stub.write_text(
        f"""#!/usr/bin/env bash
out=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -H|--max-time) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
if [[ "$url" == *api.github.com* ]]; then
  cat "{meta_file}"
  exit 0
fi
if [[ -n "$out" ]]; then
  cp "{payload_file}" "$out"
  exit 0
fi
exit 1
""",
        encoding="utf-8",
    )
    curl_stub.chmod(0o755)
    env = {**os.environ, "PATH": f"{bindir}:{os.environ.get('PATH', '')}"}

    # 1. Valid SHA-256 passes
    meta_file.write_text(
        json.dumps({"assets": [{"name": "dist.tar.gz", "browser_download_url": asset_url, "digest": f"sha256:{good_sha}"}]}),
        encoding="utf-8",
    )
    dest_ok = tmp_path / "ok.tar.gz"
    r_ok = subprocess.run(
        ["bash", "-c", f'source "{INSTALL_SH}" && copanel_download_prebuilt_frontend "{dest_ok}"'],
        env=env,
        capture_output=True,
        text=True,
    )
    assert r_ok.returncode == 0, r_ok.stderr
    assert dest_ok.read_bytes() == payload

    # 2. Mismatched SHA-256 fails closed and removes file
    meta_file.write_text(
        json.dumps({"assets": [{"name": "dist.tar.gz", "browser_download_url": asset_url, "digest": f"sha256:{bad_sha}"}]}),
        encoding="utf-8",
    )
    dest_bad = tmp_path / "bad.tar.gz"
    r_bad = subprocess.run(
        ["bash", "-c", f'source "{INSTALL_SH}" && copanel_download_prebuilt_frontend "{dest_bad}"'],
        env=env,
        capture_output=True,
        text=True,
    )
    assert r_bad.returncode != 0
    assert not dest_bad.exists()

    # 3. Missing SHA-256 fails closed
    meta_file.write_text(
        json.dumps({"assets": [{"name": "dist.tar.gz", "browser_download_url": asset_url}]}),
        encoding="utf-8",
    )
    dest_missing = tmp_path / "missing.tar.gz"
    r_missing = subprocess.run(
        ["bash", "-c", f'source "{INSTALL_SH}" && copanel_download_prebuilt_frontend "{dest_missing}"'],
        env=env,
        capture_output=True,
        text=True,
    )
    assert r_missing.returncode != 0
    assert not dest_missing.exists()
