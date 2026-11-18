"""File Manager typed path bar: ``/list?must_exist=1`` behaviour."""
import asyncio
import os

import pytest
from fastapi import HTTPException

from modules.file_manager.router import list_directory

ADMIN = {"id": 1, "username": "admin", "role": "superadmin"}


def _user(folder):
    return {"id": 2, "username": "alice", "role": "user", "permitted_folders": [str(folder)]}


def _list(path, user, must_exist=False):
    return asyncio.run(list_directory(path=path, must_exist=must_exist, user=user))


def test_existing_dir_lists(tmp_path):
    (tmp_path / "a.txt").write_text("x")
    (tmp_path / "sub").mkdir()
    out = _list(str(tmp_path), ADMIN, must_exist=True)
    assert out["path"] == str(tmp_path)
    assert [f["name"] for f in out["files"]] == ["sub", "a.txt"]


def test_trailing_slash_and_dotdot_normalized(tmp_path):
    (tmp_path / "sub").mkdir()
    out = _list(str(tmp_path / "sub") + "/../sub/", ADMIN, must_exist=True)
    assert out["path"] == str(tmp_path / "sub")


def test_missing_path_404_when_must_exist(tmp_path):
    with pytest.raises(HTTPException) as exc:
        _list(str(tmp_path / "nope"), ADMIN, must_exist=True)
    assert exc.value.status_code == 404


def test_missing_path_legacy_empty_listing(tmp_path):
    out = _list(str(tmp_path / "nope"), ADMIN)
    assert out["files"] == []


def test_file_is_not_a_directory(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("x")
    with pytest.raises(HTTPException) as exc:
        _list(str(f), ADMIN, must_exist=True)
    assert exc.value.status_code == 400


def test_normal_user_cannot_escape_sandbox(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    (tmp_path / "secret").mkdir()
    user = _user(home)
    for p in (str(tmp_path / "secret"), str(home) + "/../secret", "/etc"):
        with pytest.raises(HTTPException) as exc:
            _list(p, user, must_exist=True)
        assert exc.value.status_code == 403
    # Inside the sandbox still works
    assert _list(str(home), user, must_exist=True)["path"] == str(home)


@pytest.mark.skipif(os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0), reason="root bypasses perms")
def test_unreadable_dir_is_403(tmp_path):
    locked = tmp_path / "locked"
    locked.mkdir()
    locked.chmod(0)
    try:
        with pytest.raises(HTTPException) as exc:
            _list(str(locked), ADMIN, must_exist=True)
        assert exc.value.status_code == 403
    finally:
        locked.chmod(0o755)
