"""File Manager 1.0.17: upload conflict policy, folder upload (relative_path),
and on_conflict for copy / move-multiple.

Defensive: relative paths can never leave the destination folder or the
user's permitted folders, and unknown policies are rejected.
"""
import asyncio
import io
import os

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

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


def _who(home, who):
    return _user(home) if who == "user" else ADMIN


def _upload(dest_dir, filename, user, data=b"new", on_conflict=None, relative_path=None):
    up = UploadFile(file=io.BytesIO(data), filename=filename)
    return asyncio.run(
        upload_file(path=str(dest_dir), file=up, on_conflict=on_conflict, relative_path=relative_path, user=user)
    )


def _files(root):
    return sorted(
        os.path.relpath(os.path.join(d, f), root)
        for d, _, files in os.walk(root)
        for f in files
    )


@pytest.fixture
def sandbox(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    return home, outside


# --- upload on_conflict -----------------------------------------------------

@pytest.mark.parametrize("who", ["user", "admin"])
def test_upload_default_still_overwrites(sandbox, who):
    home, _ = sandbox
    (home / "a.txt").write_text("old")
    out = _upload(home, "a.txt", _who(home, who))
    assert out["status"] == "success"
    assert (home / "a.txt").read_bytes() == b"new"


@pytest.mark.parametrize("who", ["user", "admin"])
def test_upload_skip_keeps_existing(sandbox, who):
    home, _ = sandbox
    (home / "a.txt").write_text("old")
    out = _upload(home, "a.txt", _who(home, who), on_conflict="skip")
    assert out["status"] == "skipped"
    assert (home / "a.txt").read_text() == "old"


@pytest.mark.parametrize("who", ["user", "admin"])
def test_upload_rename_picks_free_name(sandbox, who):
    home, _ = sandbox
    (home / "a.txt").write_text("old")
    (home / "a (1).txt").write_text("old1")
    out = _upload(home, "a.txt", _who(home, who), on_conflict="rename")
    assert out["status"] == "success"
    assert (home / "a.txt").read_text() == "old"
    assert (home / "a (2).txt").read_bytes() == b"new"
    assert out["path"].endswith("a (2).txt")


def test_upload_rename_dotfile(sandbox):
    home, _ = sandbox
    (home / ".env").write_text("old")
    _upload(home, ".env", ADMIN, on_conflict="rename")
    assert (home / ".env (1)").read_bytes() == b"new"


@pytest.mark.parametrize("who", ["user", "admin"])
def test_upload_error_policy_returns_409(sandbox, who):
    home, _ = sandbox
    (home / "a.txt").write_text("old")
    with pytest.raises(HTTPException) as exc:
        _upload(home, "a.txt", _who(home, who), on_conflict="error")
    assert exc.value.status_code == 409
    assert (home / "a.txt").read_text() == "old"


def test_upload_overwrite_never_replaces_a_directory(sandbox):
    home, _ = sandbox
    (home / "d").mkdir()
    with pytest.raises(HTTPException) as exc:
        _upload(home, "d", ADMIN, on_conflict="overwrite")
    assert exc.value.status_code == 400
    assert (home / "d").is_dir()


def test_upload_unknown_policy_rejected(sandbox):
    home, _ = sandbox
    with pytest.raises(HTTPException) as exc:
        _upload(home, "a.txt", ADMIN, on_conflict="clobber")
    assert exc.value.status_code == 400
    assert _files(home) == []


# --- folder upload (relative_path) -------------------------------------------

@pytest.mark.parametrize("who", ["user", "admin"])
def test_relative_path_creates_subfolders(sandbox, who):
    home, outside = sandbox
    out = _upload(home, "a.css", _who(home, who), relative_path="site/css/a.css")
    assert out["status"] == "success"
    assert (home / "site" / "css" / "a.css").read_bytes() == b"new"
    assert _files(outside) == []


def test_relative_path_reuses_existing_folder(sandbox):
    home, _ = sandbox
    (home / "site").mkdir()
    (home / "site" / "keep.txt").write_text("k")
    _upload(home, "x", ADMIN, relative_path="site/index.html")
    assert _files(home) == ["site/index.html", "site/keep.txt"]


@pytest.mark.parametrize("who", ["user", "admin"])
@pytest.mark.parametrize(
    "rel",
    [
        "../outside/evil.txt",
        "site/../../outside/evil.txt",
        "a/./b.txt",
        "/abs/evil.txt",
        "a//b.txt",
        "a/b/",
        "..",
        "a\\..\\..\\outside\\evil.txt",
        "a/b\x00.txt",
    ],
)
def test_relative_path_traversal_rejected(sandbox, who, rel):
    home, outside = sandbox
    with pytest.raises(HTTPException) as exc:
        _upload(home, "evil.txt", _who(home, who), relative_path=rel)
    assert exc.value.status_code == 400
    assert _files(outside) == []
    assert _files(home) == []
    assert os.listdir(home) == []


@pytest.mark.skipif(os.name == "nt", reason="symlinks")
def test_relative_path_through_symlinked_folder_outside_rejected(sandbox):
    home, outside = sandbox
    os.symlink(outside, home / "link")
    with pytest.raises(HTTPException) as exc:
        _upload(home, "x", _user(home), relative_path="link/evil.txt")
    assert exc.value.status_code in (400, 403)
    assert _files(outside) == []


@pytest.mark.skipif(os.name == "nt", reason="symlinks")
def test_relative_path_through_symlink_rejected_for_admin_too(sandbox):
    home, outside = sandbox
    os.symlink(outside, home / "link")
    with pytest.raises(HTTPException) as exc:
        _upload(home, "x", ADMIN, relative_path="link/evil.txt")
    assert exc.value.status_code == 400
    assert _files(outside) == []


def test_relative_path_component_that_is_a_file_rejected(sandbox):
    home, _ = sandbox
    (home / "site").write_text("file")
    with pytest.raises(HTTPException) as exc:
        _upload(home, "x", ADMIN, relative_path="site/a.txt")
    assert exc.value.status_code == 400


def test_restricted_user_cannot_upload_outside_permitted(sandbox):
    home, outside = sandbox
    with pytest.raises(HTTPException) as exc:
        _upload(outside, "x", _user(home), relative_path="a/b.txt")
    assert exc.value.status_code == 403
    assert _files(outside) == []


# --- copy / move on_conflict -------------------------------------------------

def _copy(sources, target, user, on_conflict=None):
    req = CopyRequest(source_paths=[str(s) for s in sources], target_dir=str(target), on_conflict=on_conflict)
    return asyncio.run(copy_items(req, user=user))


def _move(sources, target, user, on_conflict=None):
    req = MoveMultipleRequest(source_paths=[str(s) for s in sources], target_dir=str(target), on_conflict=on_conflict)
    return asyncio.run(move_multiple_items(req, user=user))


@pytest.fixture
def two_dirs(sandbox):
    home, outside = sandbox
    src = home / "src"
    dst = home / "dst"
    src.mkdir()
    dst.mkdir()
    (src / "f.txt").write_text("src")
    (dst / "f.txt").write_text("dst")
    return home, src, dst


@pytest.mark.parametrize("who", ["user", "admin"])
def test_copy_legacy_default(two_dirs, who):
    home, src, dst = two_dirs
    _copy([src / "f.txt"], dst, _who(home, who))
    assert (dst / "copy_of_f.txt").read_text() == "src"


@pytest.mark.parametrize("who", ["user", "admin"])
@pytest.mark.parametrize(
    "policy,expect",
    [
        ("skip", {"f.txt": "dst"}),
        ("overwrite", {"f.txt": "src"}),
        ("rename", {"f.txt": "dst", "f (1).txt": "src"}),
    ],
)
def test_copy_policies(two_dirs, who, policy, expect):
    home, src, dst = two_dirs
    _copy([src / "f.txt"], dst, _who(home, who), policy)
    assert {p.name: p.read_text() for p in dst.iterdir()} == expect
    assert (src / "f.txt").read_text() == "src"


def test_copy_error_policy(two_dirs):
    home, src, dst = two_dirs
    with pytest.raises(HTTPException) as exc:
        _copy([src / "f.txt"], dst, ADMIN, "error")
    assert exc.value.status_code == 409


def test_copy_into_same_folder_renames(two_dirs):
    home, src, dst = two_dirs
    _copy([src / "f.txt"], src, ADMIN, "overwrite")
    assert (src / "f.txt").read_text() == "src"
    assert (src / "f (1).txt").read_text() == "src"


@pytest.mark.parametrize("who", ["user", "admin"])
def test_copy_folder_into_itself_rejected(two_dirs, who):
    home, src, dst = two_dirs
    (src / "sub").mkdir()
    with pytest.raises(HTTPException) as exc:
        _copy([src], src / "sub", _who(home, who), "rename")
    assert exc.value.status_code == 400


@pytest.mark.parametrize("who", ["user", "admin"])
@pytest.mark.parametrize(
    "policy,expect",
    [
        (None, {"f.txt": "src"}),
        ("overwrite", {"f.txt": "src"}),
        ("skip", {"f.txt": "dst"}),
        ("rename", {"f.txt": "dst", "f (1).txt": "src"}),
    ],
)
def test_move_policies(two_dirs, who, policy, expect):
    home, src, dst = two_dirs
    _move([src / "f.txt"], dst, _who(home, who), policy)
    assert {p.name: p.read_text() for p in dst.iterdir()} == expect
    if policy == "skip":
        assert (src / "f.txt").exists()
    else:
        assert not (src / "f.txt").exists()


def test_move_error_policy_keeps_both(two_dirs):
    home, src, dst = two_dirs
    with pytest.raises(HTTPException) as exc:
        _move([src / "f.txt"], dst, ADMIN, "error")
    assert exc.value.status_code == 409
    assert (src / "f.txt").read_text() == "src"
    assert (dst / "f.txt").read_text() == "dst"


@pytest.mark.parametrize("who", ["user", "admin"])
def test_move_onto_same_folder_is_noop(two_dirs, who):
    home, src, dst = two_dirs
    out = _move([src / "f.txt"], src, _who(home, who), "overwrite")
    assert (src / "f.txt").read_text() == "src"
    assert out["moved"] == []


@pytest.mark.parametrize("who", ["user", "admin"])
def test_move_folder_into_own_child_rejected(two_dirs, who):
    home, src, dst = two_dirs
    (src / "sub").mkdir()
    with pytest.raises(HTTPException) as exc:
        _move([src], src / "sub", _who(home, who))
    assert exc.value.status_code == 400
    assert (src / "f.txt").exists()


def test_move_restricted_outside_target_rejected(two_dirs, tmp_path):
    home, src, dst = two_dirs
    with pytest.raises(HTTPException) as exc:
        _move([src / "f.txt"], tmp_path / "outside", _user(home), "rename")
    assert exc.value.status_code == 403
    assert (src / "f.txt").exists()


def test_unknown_policy_rejected_for_move(two_dirs):
    home, src, dst = two_dirs
    with pytest.raises(HTTPException) as exc:
        _move([src / "f.txt"], dst, ADMIN, "nuke")
    assert exc.value.status_code == 400
    assert (dst / "f.txt").read_text() == "dst"
