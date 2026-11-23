"""Panel 1.1.13: core-module AppStore installs on no-AVX CPUs, File Manager
extract ownership, Web Manager document roots for restricted users."""
import io
import os
import subprocess
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.auth as auth_mod
import modules.appstore_manager.logic as store
import modules.file_manager.router as fm
import modules.web_manager.router as wm
from core.api import install_exception_handlers
from modules.auth.router import get_current_user


# ── AppStore: core modules on CPUs without AVX ───────────────────────────────


def _pkg_zip(path, with_frontend=True):
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("backend/__init__.py", "")
        zf.writestr("backend/router.py", "router = None\n")
        zf.writestr("backend/version.txt", "9.9.9\n")
        if with_frontend:
            zf.writestr("frontend/index.tsx", "export default null;\n")
            zf.writestr("frontend/config.ts", "export default {};\n")
    return path.as_uri()


@pytest.fixture
def store_home(tmp_path, monkeypatch):
    home = tmp_path / "copanel"
    (home / "backend" / "modules").mkdir(parents=True)
    (home / "frontend" / "src" / "modules").mkdir(parents=True)
    monkeypatch.setattr(store, "get_copanel_home", lambda: home)
    monkeypatch.setenv("COPANEL_FORCE_NO_AVX", "1")
    return home


def _run(pkg_id, url, is_core):
    store.BUILD_TASKS[pkg_id] = store._new_build_task()
    res = store._install_package_files(
        pkg_id,
        url,
        "9.9.9",
        frontend_install="rebuild",
        task_key=pkg_id,
        install_deps=False,
        run_frontend_build=False,
        is_core=is_core,
    )
    return res, store.BUILD_TASKS[pkg_id]["logs"]


def test_core_module_installs_backend_only_without_avx(store_home, tmp_path):
    url = _pkg_zip(tmp_path / "terminal.zip")
    res, logs = _run("terminal", url, True)
    assert res["ok"] is True
    assert res["install_mode"] == "none"
    assert res["frontend_updated"] is False and res["needs_rebuild"] is False
    assert (store_home / "backend" / "modules" / "terminal" / "router.py").is_file()
    assert not (store_home / "frontend" / "src" / "modules" / "terminal").exists()
    assert any("Panel" in line and "Update" in line for line in logs)
    assert not any(store.NO_AVX_REBUILD_ERROR in line for line in logs)


def test_non_core_rebuild_zip_still_refused_without_avx(store_home, tmp_path):
    url = _pkg_zip(tmp_path / "demo.zip")
    res, logs = _run("demo_ext", url, False)
    assert res["ok"] is False
    assert any("no AVX" in line for line in logs)
    assert not (store_home / "backend" / "modules" / "demo_ext").exists()


def test_core_module_with_avx_keeps_rebuild(store_home, tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_cpu_lacks_avx", lambda: False)
    url = _pkg_zip(tmp_path / "terminal.zip")
    res, _ = _run("terminal", url, True)
    assert res["ok"] is True
    assert res["install_mode"] == "rebuild"
    assert res["needs_rebuild"] is True


def test_is_core_hint_and_git_fallback(tmp_path):
    root = tmp_path / "panel"
    cfg = root / "frontend" / "src" / "modules" / "terminal" / "config.ts"
    cfg.parent.mkdir(parents=True)
    cfg.write_text("export default {};\n")
    (root / "frontend" / "src" / "modules" / "audio_station").mkdir()
    (root / "frontend" / "src" / "modules" / "audio_station" / "config.ts").write_text("x")
    assert store._is_core_module("anything", root, True) is True
    assert store._is_core_module("terminal", root, False) is False
    # Not a git checkout -> unknown -> not core.
    assert store._is_core_module("terminal", root) is False
    try:
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        subprocess.run(["git", "-C", str(root), "add", str(cfg)], check=True)
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("git not available")
    assert store._is_core_module("terminal", root) is True
    # Untracked (AppStore-installed) module is not core.
    assert store._is_core_module("audio_station", root) is False
    assert store._is_core_module("../terminal", root) is False


def test_router_forwards_is_core(monkeypatch):
    import modules.appstore_manager.router as srouter

    single, batch = [], []
    monkeypatch.setattr(
        srouter.AppStoreManager,
        "install_package",
        staticmethod(lambda *a, **k: single.append(a) or {"status": "started"}),
    )
    monkeypatch.setattr(
        srouter.AppStoreManager,
        "install_packages_batch",
        staticmethod(lambda pkgs: batch.append(pkgs) or {"status": "started"}),
    )
    base = {"id": "terminal", "download_url": "https://example.invalid/t.zip"}
    srouter.install_package({**base, "is_core": True})
    srouter.install_package({**base, "is_core": "yes"})
    srouter.install_package(dict(base))
    assert [a[-1] for a in single] == [True, None, None]
    srouter.install_packages_batch({"packages": [{**base, "is_core": True}, dict(base)]})
    assert [p["is_core"] for p in batch[0]] == [True, None]


# ── File Manager extract: new items owned by the home owner ─────────────────


@pytest.fixture
def fm_env(tmp_path, monkeypatch):
    home = tmp_path / "home" / "phutv"
    home.mkdir(parents=True)
    user = {
        "id": 9,
        "username": "phutv",
        "role": "user",
        "permitted_folders": '["%s"]' % home,
        "permitted_modules": '["file_manager","web_manager"]',
    }
    monkeypatch.setattr(auth_mod, "_AUTH_DISABLED", False)
    monkeypatch.setattr(auth_mod, "_user_from_token", lambda _a: user)
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(fm.router, prefix="/api/file_manager")
    app.include_router(wm.router, prefix="/api/web_manager")
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    client.headers["Authorization"] = "Bearer x"
    return client, home, tmp_path, user


def test_extract_chowns_created_items(fm_env, monkeypatch):
    client, home, _, user = fm_env
    calls = []
    monkeypatch.setattr(fm, "chown_new", lambda paths, u, **kw: calls.append(list(paths)))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("a/b.txt", "x")
        zf.writestr("c.txt", "y")
    (home / "arc.zip").write_bytes(buf.getvalue())
    r = client.post(
        "/api/file_manager/extract",
        json={"archive_path": str(home / "arc.zip"), "target_dir": str(home / "out")},
    )
    assert r.status_code == 200, r.text
    flat = {p for c in calls for p in c}
    assert {
        str(home / "out"),
        str(home / "out" / "a"),
        str(home / "out" / "a" / "b.txt"),
        str(home / "out" / "c.txt"),
    } <= {os.path.normpath(p) for p in flat}


def test_extract_into_existing_dir_does_not_chown_the_dir(fm_env, monkeypatch):
    client, home, _, _ = fm_env
    calls = []
    monkeypatch.setattr(fm, "chown_new", lambda paths, u, **kw: calls.append(list(paths)))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("c.txt", "y")
    (home / "arc.zip").write_bytes(buf.getvalue())
    r = client.post(
        "/api/file_manager/extract",
        json={"archive_path": str(home / "arc.zip"), "target_dir": str(home)},
    )
    assert r.status_code == 200, r.text
    flat = {os.path.normpath(p) for c in calls for p in c}
    assert str(home) not in flat
    assert str(home / "c.txt") in flat


# ── Web Manager: restricted users' document roots ───────────────────────────


@pytest.fixture
def web_roots(fm_env, monkeypatch):
    _, home, tmp_path, _ = fm_env
    outside = tmp_path / "www"
    outside.mkdir()
    monkeypatch.setenv("COPANEL_ALLOWED_WEB_ROOTS", f"{tmp_path}")
    # Stop right after the document root step (no vhost writes in tests).
    monkeypatch.setattr(wm, "detect_apache_layout", lambda: None)
    return outside


def test_web_doc_root_outside_home_is_403(fm_env, web_roots):
    client, _, _, _ = fm_env
    target = web_roots / "site1"
    r = client.post(
        "/api/web_manager/create",
        json={"domain": "example.com", "root": str(target), "engine": "apache"},
    )
    assert r.status_code == 403, r.text
    assert not target.exists()


def test_web_doc_root_inside_home_is_created_and_chowned(fm_env, web_roots, monkeypatch):
    import core.user_home as user_home

    client, home, _, _ = fm_env
    calls = []
    monkeypatch.setattr(user_home, "chown_new", lambda paths, u, **kw: calls.append(list(paths)))
    target = home / "www" / "site1"
    r = client.post(
        "/api/web_manager/create",
        json={"domain": "example.com", "root": str(target), "engine": "apache"},
    )
    # Apache layout is stubbed out, so the call stops after the doc root step.
    assert r.status_code == 400, r.text
    assert "Apache layout" in r.text
    assert target.is_dir()
    assert [str(target)] in calls


def test_web_doc_root_superadmin_unrestricted(fm_env, web_roots, monkeypatch):
    client, _, _, user = fm_env
    user["role"] = "superadmin"
    target = web_roots / "site2"
    r = client.post(
        "/api/web_manager/create",
        json={"domain": "example.com", "root": str(target), "engine": "apache"},
    )
    assert r.status_code == 400, r.text
    assert target.is_dir()
