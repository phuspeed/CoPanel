"""Platform folder picker: directories only, limited to permitted folders,
usable without the File Manager module (which stays gated)."""
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.auth as auth_mod
from modules.auth.router import get_current_user
from modules.file_manager.router import router as fm_router
from modules.platform.router import router as platform_router


@pytest.fixture
def env(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / "proj").mkdir(parents=True)
    (home / "notes.txt").write_text("secret contents")
    outside = tmp_path / "outside"
    (outside / "other").mkdir(parents=True)
    user = {
        "id": 7,
        "username": "dock",
        "role": "user",
        "permitted_folders": [str(home)],
        "permitted_modules": ["docker_manager"],
    }
    monkeypatch.setattr(auth_mod, "_AUTH_DISABLED", False)
    monkeypatch.setattr(auth_mod, "_user_from_token", lambda _a: user)
    app = FastAPI()
    app.include_router(platform_router, prefix="/api/platform")
    app.include_router(fm_router, prefix="/api/file_manager")
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    client.headers["Authorization"] = "Bearer x"
    return client, home, outside, user


def test_lists_only_dirs_inside_permitted_folder(env):
    client, home, _, _ = env
    res = client.get("/api/platform/folder-picker", params={"path": str(home)})
    assert res.status_code == 200
    body = res.json()
    assert body["path"] == str(home)
    assert [d["name"] for d in body["files"]] == ["proj"]
    assert all(d["is_dir"] for d in body["files"])
    assert "secret contents" not in res.text and "notes.txt" not in res.text


def test_default_path_is_first_permitted_folder(env):
    client, home, _, _ = env
    res = client.get("/api/platform/folder-picker")
    assert res.status_code == 200
    assert res.json()["path"] == str(home)


@pytest.mark.parametrize("which", ["outside", "dotdot", "root"])
def test_outside_permitted_folder_is_403(env, which):
    client, home, outside, _ = env
    path = {"outside": str(outside), "dotdot": str(home) + "/../outside", "root": "/"}[which]
    res = client.get("/api/platform/folder-picker", params={"path": path})
    assert res.status_code == 403


def test_requires_login(env, monkeypatch):
    client, home, _, _ = env
    monkeypatch.setattr(auth_mod, "_user_from_token", lambda _a: None)
    res = client.get("/api/platform/folder-picker", params={"path": str(home)})
    assert res.status_code == 401


def test_create_dir_inside_permitted_folder(env):
    client, home, _, _ = env
    res = client.post("/api/platform/folder-picker/create-dir", json={"parent": str(home), "name": "new"})
    assert res.status_code == 200
    assert (home / "new").is_dir()
    assert res.json()["path"] == str(home / "new")
    again = client.post("/api/platform/folder-picker/create-dir", json={"parent": str(home), "name": "new"})
    assert again.status_code == 400


@pytest.mark.parametrize("name", ["", ".", "..", "../escape", "a/b", "/abs", "x\x00y"])
def test_create_dir_rejects_unsafe_names(env, name):
    client, home, outside, _ = env
    res = client.post("/api/platform/folder-picker/create-dir", json={"parent": str(home), "name": name})
    assert 400 <= res.status_code < 500
    assert not (outside.parent / "escape").exists()
    assert sorted(os.listdir(outside)) == ["other"]
    assert sorted(os.listdir(home)) == ["notes.txt", "proj"]


def test_create_dir_outside_permitted_folder_is_403(env):
    client, _, outside, _ = env
    res = client.post("/api/platform/folder-picker/create-dir", json={"parent": str(outside), "name": "x"})
    assert res.status_code == 403
    assert not (outside / "x").exists()


@pytest.mark.skipif(os.name == "nt", reason="symlinks")
def test_symlink_out_of_sandbox_not_followed(env):
    client, home, outside, _ = env
    os.symlink(outside, home / "link")
    res = client.get("/api/platform/folder-picker", params={"path": str(home / "link")})
    assert res.status_code == 403
    res = client.post("/api/platform/folder-picker/create-dir", json={"parent": str(home / "link"), "name": "x"})
    assert res.status_code == 403
    assert not (outside / "x").exists()


@pytest.mark.parametrize(
    "method,url,kwargs",
    [
        ("get", "/api/file_manager/list", {"params": {"path": "HOME"}}),
        ("get", "/api/file_manager/read", {"params": {"path": "HOME/notes.txt"}}),
        ("post", "/api/file_manager/write", {"json": {"path": "HOME/notes.txt", "content": "x"}}),
        ("post", "/api/file_manager/create-dir", {"json": {"path": "HOME/fm"}}),
        ("post", "/api/file_manager/delete", {"json": {"path": "HOME/notes.txt"}}),
    ],
)
def test_file_manager_endpoints_still_need_module(env, method, url, kwargs):
    client, home, _, _ = env
    for k in ("params", "json"):
        if k in kwargs:
            kwargs = {k: {kk: (v.replace("HOME", str(home)) if isinstance(v, str) else v) for kk, v in kwargs[k].items()}}
    res = getattr(client, method)(url, **kwargs)
    assert res.status_code == 403
    assert (home / "notes.txt").read_text() == "secret contents"
    assert not (home / "fm").exists()


def test_file_manager_works_with_grant(env):
    client, home, _, user = env
    user["permitted_modules"] = ["docker_manager", "file_manager"]
    res = client.get("/api/file_manager/list", params={"path": str(home)})
    assert res.status_code == 200
