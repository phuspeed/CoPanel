"""Restricted users: full read/write inside their permitted folders (including
the home root itself), 403 outside, missing home created, new items owned by
the home folder's owner."""
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.auth as auth_mod
import core.user_home as user_home
from core.api import install_exception_handlers
from modules.auth.router import get_current_user
from modules.file_manager.router import router as fm_router
from modules.platform.router import router as platform_router


@pytest.fixture
def env(tmp_path, monkeypatch):
    home = tmp_path / "home" / "phutv"
    home.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep.txt").write_text("keep")
    user = {
        "id": 9,
        "username": "phutv",
        "role": "user",
        "permitted_folders": '["%s"]' % home,
        "permitted_modules": '["file_manager","download_manager"]',
    }
    monkeypatch.setattr(auth_mod, "_AUTH_DISABLED", False)
    monkeypatch.setattr(auth_mod, "_user_from_token", lambda _a: user)
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(fm_router, prefix="/api/file_manager")
    app.include_router(platform_router, prefix="/api/platform")
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    client.headers["Authorization"] = "Bearer x"
    return client, home, outside, user


@pytest.mark.parametrize("sub", ["", "sub/deeper"])
def test_full_write_cycle_in_home_root_and_subdirs(env, sub):
    client, home, _, _ = env
    base = home / sub if sub else home
    if sub:
        r = client.post("/api/file_manager/create-dir", json={"path": str(base)})
        assert r.status_code == 200, r.text
    r = client.post("/api/file_manager/create-dir", json={"path": str(base / "newdir")})
    assert r.status_code == 200, r.text
    assert (base / "newdir").is_dir()
    r = client.post("/api/file_manager/create-file", json={"path": str(base / "a.txt"), "content": "hi"})
    assert r.status_code == 200, r.text
    r = client.post("/api/file_manager/upload", params={"path": str(base)}, files={"file": ("up.bin", b"data")})
    assert r.status_code == 200, r.text
    assert (base / "up.bin").read_bytes() == b"data"
    r = client.post("/api/file_manager/write", json={"path": str(base / "a.txt"), "content": "edited"})
    assert r.status_code == 200
    r = client.post("/api/file_manager/rename", json={"old_path": str(base / "a.txt"), "new_path": str(base / "b.txt")})
    assert r.status_code == 200, r.text
    assert (base / "b.txt").read_text() == "edited"
    r = client.post("/api/file_manager/zip", json={"paths": [str(base / "b.txt")], "archive_path": str(base / "arc.zip")})
    assert r.status_code == 200, r.text
    r = client.post("/api/file_manager/extract", json={"archive_path": str(base / "arc.zip"), "target_dir": str(base / "x")})
    assert r.status_code == 200, r.text
    assert (base / "x" / "b.txt").read_text() == "edited"
    r = client.post("/api/file_manager/copy", json={"source_paths": [str(base / "b.txt")], "target_dir": str(base / "newdir")})
    assert r.status_code == 200, r.text
    r = client.post("/api/file_manager/move-multiple", json={"source_paths": [str(base / "up.bin")], "target_dir": str(base / "newdir")})
    assert r.status_code == 200, r.text
    r = client.post("/api/file_manager/delete-multiple", json={"paths": [str(base / "b.txt"), str(base / "x")]})
    assert r.status_code == 200, r.text
    assert not (base / "b.txt").exists()
    listing = client.get("/api/file_manager/list", params={"path": str(base / "newdir")}).json()
    assert sorted(f["name"] for f in listing["files"]) == ["b.txt", "up.bin"]


@pytest.mark.parametrize(
    "method,url,payload",
    [
        ("post", "/api/file_manager/create-dir", {"json": {"path": "OUT/d"}}),
        ("post", "/api/file_manager/create-file", {"json": {"path": "OUT/f.txt"}}),
        ("post", "/api/file_manager/write", {"json": {"path": "OUT/keep.txt", "content": "x"}}),
        ("post", "/api/file_manager/upload", {"params": {"path": "OUT"}, "files": {"file": ("u.txt", b"x")}}),
        ("post", "/api/file_manager/rename", {"json": {"old_path": "OUT/keep.txt", "new_path": "HOME/k.txt"}}),
        ("post", "/api/file_manager/delete-multiple", {"json": {"paths": ["OUT/keep.txt"]}}),
        ("post", "/api/file_manager/create-dir", {"json": {"path": "HOME/../../outside/d"}}),
        ("post", "/api/platform/folder-picker/create-dir", {"json": {"parent": "OUT", "name": "d"}}),
    ],
)
def test_writes_outside_home_are_403(env, method, url, payload):
    client, home, outside, _ = env

    def sub(v):
        if isinstance(v, str):
            return v.replace("OUT", str(outside)).replace("HOME", str(home))
        if isinstance(v, dict):
            return {k: sub(x) for k, x in v.items()}
        if isinstance(v, list):
            return [sub(x) for x in v]
        return v

    kwargs = {k: (v if k == "files" else sub(v)) for k, v in payload.items()}
    r = getattr(client, method)(url, **kwargs)
    assert r.status_code == 403, r.text
    assert sorted(os.listdir(outside)) == ["keep.txt"]
    assert (outside / "keep.txt").read_text() == "keep"


def test_error_body_carries_message(env):
    client, _, outside, _ = env
    r = client.post("/api/file_manager/create-dir", json={"path": str(outside / "d")})
    body = r.json()
    assert r.status_code == 403
    assert "isolated" in body["error"]["message"]


def test_list_does_not_create_missing_home(env, tmp_path):
    """GET must not have side effects; the home is created at login / user save."""
    client, home, _, user = env
    new_home = tmp_path / "home" / "newbie"
    user["permitted_folders"] = '["%s"]' % new_home
    assert not new_home.exists()
    r = client.get("/api/file_manager/list")
    assert r.status_code == 200
    assert r.json()["path"] == str(new_home)
    assert not new_home.exists()
    user_home.ensure_permitted_folders(user)  # what login does
    assert new_home.is_dir()
    r = client.post("/api/file_manager/upload", params={"path": str(new_home)}, files={"file": ("a.txt", b"1")})
    assert r.status_code == 200, r.text


def test_superadmin_not_touched(tmp_path):
    created = user_home.ensure_permitted_folders(
        {"role": "superadmin", "permitted_folders": '["%s"]' % (tmp_path / "x")}
    )
    assert created == [] and not (tmp_path / "x").exists()
    assert user_home.owner_for(str(tmp_path), {"role": "superadmin"}) is None


def test_new_items_get_home_owner(env, owner_recorder):
    client, home, _, _ = env
    st = home.stat()
    if st.st_uid == 0:
        pytest.skip("tmp home owned by root")
    client.post("/api/file_manager/create-dir", json={"path": str(home / "d1" / "d2")})
    client.post("/api/file_manager/create-file", json={"path": str(home / "f.txt")})
    client.post("/api/file_manager/upload", params={"path": str(home)}, files={"file": ("u.txt", b"x")})
    paths = {c[0] for c in owner_recorder}
    want = {str(home / "d1"), str(home / "d1" / "d2"), str(home / "f.txt"), str(home / "u.txt")}
    assert {os.path.realpath(p) for p in want} <= paths
    assert all(c[1] == st.st_uid and c[2] == st.st_gid for c in owner_recorder)


def test_root_owned_home_leaves_owner(monkeypatch, tmp_path):
    class St:
        st_uid = 0
        st_gid = 0

    monkeypatch.setattr(user_home.Path, "stat", lambda self, **kw: St())
    user = {"role": "user", "permitted_folders": [str(tmp_path)]}
    assert user_home.owner_for(str(tmp_path / "a"), user) is None


def test_outside_path_has_no_owner(tmp_path):
    user = {"role": "user", "permitted_folders": [str(tmp_path / "home")]}
    assert user_home.owner_for(str(tmp_path / "other"), user) is None
