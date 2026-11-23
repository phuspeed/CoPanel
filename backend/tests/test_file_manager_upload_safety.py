"""File Manager: upload filenames and copy/move destinations stay in the sandbox.

Defensive regression tests: unsafe names are rejected (4xx) and nothing is
written outside the destination directory / permitted folders.
"""
import asyncio
import io
import os

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

import core.auth as auth_mod
from modules.file_manager import router as fm
from modules.file_manager.router import (
    copy_items,
    move_multiple_items,
    upload_file,
    CopyRequest,
    MoveMultipleRequest,
)

ADMIN = {"id": 1, "username": "admin", "role": "superadmin"}


def _user(folder):
    return {
        "id": 2,
        "username": "alice",
        "role": "user",
        "permitted_folders": [str(folder)],
        "permitted_modules": ["file_manager"],
    }


def _upload(dest_dir, filename, user, data=b"hello"):
    up = UploadFile(file=io.BytesIO(data), filename=filename)
    return asyncio.run(upload_file(path=str(dest_dir), file=up, user=user))


@pytest.fixture
def sandbox(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    return home, outside


def _all_files(root):
    return sorted(
        os.path.relpath(os.path.join(d, f), root)
        for d, _, files in os.walk(root)
        for f in files
    )


# --- happy path -----------------------------------------------------------

@pytest.mark.parametrize("who", ["user", "admin"])
def test_plain_upload_still_works(sandbox, who):
    home, _ = sandbox
    user = _user(home) if who == "user" else ADMIN
    out = _upload(home, "report.txt", user, b"data")
    assert out["status"] == "success"
    assert (home / "report.txt").read_bytes() == b"data"


def test_upload_overwrites_existing_file_in_dest(sandbox):
    home, _ = sandbox
    (home / "a.txt").write_text("old")
    _upload(home, "a.txt", _user(home), b"new")
    assert (home / "a.txt").read_bytes() == b"new"


def test_directory_components_are_stripped(sandbox):
    home, outside = sandbox
    _upload(home, "sub/dir/name.txt", _user(home), b"x")
    assert (home / "name.txt").read_bytes() == b"x"
    assert _all_files(outside) == []


# --- rejected / contained -------------------------------------------------

@pytest.mark.parametrize("who", ["user", "admin"])
def test_parent_segments_do_not_escape_dest(sandbox, who):
    home, outside = sandbox
    user = _user(home) if who == "user" else ADMIN
    name = "../outside/evil.txt"
    _upload(home, name, user, b"x")
    # Only the base name is kept, and it lands inside the destination dir.
    assert not (outside / "evil.txt").exists()
    assert (home / "evil.txt").exists()


@pytest.mark.parametrize("who", ["user", "admin"])
def test_absolute_filename_does_not_escape_dest(sandbox, who):
    home, outside = sandbox
    user = _user(home) if who == "user" else ADMIN
    _upload(home, str(outside / "abs.txt"), user, b"x")
    assert not (outside / "abs.txt").exists()
    assert (home / "abs.txt").exists()


def test_windows_style_separators_are_stripped(sandbox):
    home, outside = sandbox
    _upload(home, "..\\outside\\win.txt", _user(home), b"x")
    assert not (outside / "win.txt").exists()
    assert (home / "win.txt").exists()


@pytest.mark.parametrize("name", ["", ".", "..", "../", "/", "a/..", "bad\x00name.txt"])
def test_invalid_names_rejected(sandbox, name):
    home, outside = sandbox
    with pytest.raises(HTTPException) as exc:
        _upload(home, name, _user(home))
    assert 400 <= exc.value.status_code < 500
    assert _all_files(home) == []
    assert _all_files(outside) == []


@pytest.mark.skipif(os.name == "nt", reason="symlinks")
def test_symlink_in_dest_pointing_outside_is_rejected(sandbox):
    home, outside = sandbox
    target = outside / "target.txt"
    target.write_text("original")
    os.symlink(target, home / "link.txt")
    with pytest.raises(HTTPException) as exc:
        _upload(home, "link.txt", _user(home), b"overwritten")
    assert exc.value.status_code == 403
    assert target.read_text() == "original"


@pytest.mark.skipif(os.name == "nt", reason="symlinks")
def test_dangling_symlink_pointing_outside_is_rejected(sandbox):
    home, outside = sandbox
    os.symlink(outside / "new.txt", home / "dangling.txt")
    with pytest.raises(HTTPException) as exc:
        _upload(home, "dangling.txt", _user(home), b"x")
    assert exc.value.status_code == 403
    assert not (outside / "new.txt").exists()


def test_dest_dir_outside_sandbox_still_rejected(sandbox):
    home, outside = sandbox
    with pytest.raises(HTTPException) as exc:
        _upload(outside, "x.txt", _user(home))
    assert exc.value.status_code == 403
    assert _all_files(outside) == []


# --- copy / move-multiple destinations -------------------------------------

@pytest.mark.skipif(os.name == "nt", reason="symlinks")
def test_copy_into_symlink_pointing_outside_is_rejected(sandbox):
    home, outside = sandbox
    src_dir = home / "src"
    src_dir.mkdir()
    (src_dir / "f.txt").write_text("payload")
    dst_dir = home / "dst"
    dst_dir.mkdir()
    victim = outside / "victim.txt"
    victim.write_text("original")
    os.symlink(victim, dst_dir / "f.txt")
    req = CopyRequest(source_paths=[str(src_dir / "f.txt")], target_dir=str(dst_dir))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(copy_items(req, user=_user(home)))
    assert exc.value.status_code == 403
    assert victim.read_text() == "original"


def test_copy_and_move_multiple_happy_path(sandbox):
    home, _ = sandbox
    (home / "a.txt").write_text("a")
    (home / "b.txt").write_text("b")
    dst = home / "dst"
    dst.mkdir()
    user = _user(home)
    asyncio.run(copy_items(CopyRequest(source_paths=[str(home / "a.txt")], target_dir=str(dst)), user=user))
    assert (dst / "a.txt").read_text() == "a"
    asyncio.run(copy_items(CopyRequest(source_paths=[str(home / "a.txt")], target_dir=str(dst)), user=user))
    assert (dst / "copy_of_a.txt").read_text() == "a"
    asyncio.run(move_multiple_items(MoveMultipleRequest(source_paths=[str(home / "b.txt")], target_dir=str(dst)), user=user))
    assert (dst / "b.txt").read_text() == "b"
    assert not (home / "b.txt").exists()


@pytest.mark.skipif(os.name == "nt", reason="symlinks")
def test_move_multiple_onto_symlink_pointing_outside_is_rejected(sandbox):
    home, outside = sandbox
    (home / "m.txt").write_text("payload")
    dst = home / "dst"
    dst.mkdir()
    victim = outside / "victim.txt"
    victim.write_text("original")
    os.symlink(victim, dst / "m.txt")
    req = MoveMultipleRequest(source_paths=[str(home / "m.txt")], target_dir=str(dst))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(move_multiple_items(req, user=_user(home)))
    assert exc.value.status_code == 403
    assert victim.read_text() == "original"
    assert (home / "m.txt").exists()


# --- module gate ------------------------------------------------------------

def _router_gate():
    deps = [d.dependency for d in fm.router.dependencies]
    assert deps, "file_manager router must have a module dependency"
    return deps[0]


def test_router_requires_file_manager_module(monkeypatch):
    gate = _router_gate()
    monkeypatch.setattr(auth_mod, "_AUTH_DISABLED", False)
    limited = {"id": 3, "username": "bob", "role": "user", "permitted_modules": ["dashboard"]}
    monkeypatch.setattr(auth_mod, "_user_from_token", lambda _a: limited)
    with pytest.raises(HTTPException) as exc:
        gate(authorization="Bearer x")
    assert exc.value.status_code == 403


@pytest.mark.parametrize(
    "user",
    [
        {"id": 1, "username": "admin", "role": "superadmin"},
        {"id": 4, "username": "carol", "role": "user", "permitted_modules": ["file_manager"]},
        {"id": 5, "username": "dave", "role": "user", "permitted_modules": '["all"]'},
    ],
)
def test_router_allows_granted_users(monkeypatch, user):
    gate = _router_gate()
    monkeypatch.setattr(auth_mod, "_AUTH_DISABLED", False)
    monkeypatch.setattr(auth_mod, "_user_from_token", lambda _a: user)
    assert gate(authorization="Bearer x") is user
