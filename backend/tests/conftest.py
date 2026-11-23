"""Test bootstrap: ensure ``backend/`` is on sys.path and isolate the SQLite
database so tests do not touch ``/opt/copanel`` or ``config/copanel.db``.
"""
import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

_TMP_CONFIG = Path(tempfile.mkdtemp(prefix="copanel-tests-"))
os.environ.setdefault("COPANEL_DISABLE_AUTH", "1")
os.environ["COPANEL_TEST_CONFIG_DIR"] = str(_TMP_CONFIG)


import pytest as _pytest


@_pytest.fixture
def owner_recorder(monkeypatch):
    """Record every path ``core.safe_fs`` gives an owner to (fchown / fchownat)."""
    from core import safe_fs

    owned = []
    real_fchown, real_chown = os.fchown, os.chown

    def rec_fchown(fd, uid, gid):
        owned.append((os.path.realpath(os.readlink(f"/proc/self/fd/{fd}")), uid, gid))
        return real_fchown(fd, uid, gid)

    def rec_chown(path, uid, gid, *, dir_fd=None, follow_symlinks=True):
        assert follow_symlinks is False, "safe_fs must never chown through a symlink"
        base = os.readlink(f"/proc/self/fd/{dir_fd}") if dir_fd is not None else ""
        owned.append((os.path.realpath(os.path.join(base, path)), uid, gid))
        return real_chown(path, uid, gid, dir_fd=dir_fd, follow_symlinks=follow_symlinks)

    monkeypatch.setattr(safe_fs.os, "fchown", rec_fchown)
    monkeypatch.setattr(safe_fs.os, "chown", rec_chown)
    return owned
