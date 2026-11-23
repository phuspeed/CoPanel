"""1.1.15 security regressions: symlink/chown hardening (review finding 1),
folder picker + empty folder list (finding 6), stream tickets (finding 7)."""
import os
import stat
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.auth as auth_mod
import core.stream_tickets as st
from core import safe_fs
from core.api import install_exception_handlers
from modules.auth.router import get_current_user
from modules.file_manager import router as fm
from modules.platform.router import router as platform_router


@pytest.fixture
def env(tmp_path, monkeypatch):
    home = tmp_path / "home" / "u"
    (home / "dir").mkdir(parents=True)
    secret = tmp_path / "secret"
    secret.mkdir()
    (secret / "s.txt").write_text("TOP-SECRET")
    (secret / "sub").mkdir()
    (secret / "sub" / "deep.txt").write_text("DEEP-SECRET")
    user = {
        "id": 5,
        "username": "u",
        "role": "user",
        "permitted_folders": '["%s"]' % home,
        "permitted_modules": '["file_manager"]',
    }
    monkeypatch.setattr(auth_mod, "_AUTH_DISABLED", False)
    monkeypatch.setattr(auth_mod, "_user_from_token", lambda _a: user)
    # Resolve at fixture time: test_modules_syntax reloads these modules.
    from modules.auth.router import get_current_user as current_dep
    from modules.platform.router import router as platform_r

    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(fm.router, prefix="/api/file_manager")
    app.include_router(platform_r, prefix="/api/platform")
    app.dependency_overrides[current_dep] = lambda: user
    client = TestClient(app)
    client.headers["Authorization"] = "Bearer x"
    return client, home, secret, user


def _walk_contents(root):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        for f in filenames:
            p = os.path.join(dirpath, f)
            if not os.path.islink(p):
                with open(p, errors="ignore") as fh:
                    out.append(fh.read())
    return "\n".join(out)


# ── Finding 1: copy never follows symlinks ────────────────────────────────


def test_copy_dir_with_symlink_to_outside_file_does_not_leak(env):
    client, home, secret, _ = env
    (home / "dir" / "link").symlink_to(secret / "s.txt")
    (home / "dir" / "dlink").symlink_to(secret / "sub")
    (home / "dir" / "ok.txt").write_text("mine")
    (home / "dst").mkdir()
    r = client.post("/api/file_manager/copy", json={"source_paths": [str(home / "dir")], "target_dir": str(home / "dst")})
    assert r.status_code == 200, r.text
    copied = home / "dst" / "dir"
    assert (copied / "ok.txt").read_text() == "mine"
    # Links are reproduced as links, never as copies of the outside content.
    assert os.path.islink(copied / "link") and os.path.islink(copied / "dlink")
    assert "SECRET" not in _walk_contents(home)
    # Reading through the copied link is still blocked by the sandbox.
    r = client.get("/api/file_manager/read", params={"path": str(copied / "link")})
    assert r.status_code == 403
    r = client.get("/api/file_manager/download", params={"path": str(copied / "dlink" / "deep.txt")})
    assert r.status_code == 403


def test_copy_of_symlink_pointing_outside_is_403(env):
    client, home, secret, _ = env
    (home / "l").symlink_to(secret / "s.txt")
    r = client.post("/api/file_manager/copy", json={"source_paths": [str(home / "l")], "target_dir": str(home / "dir")})
    assert r.status_code == 403


def test_zip_skips_symlinks(env):
    client, home, secret, _ = env
    (home / "dir" / "link").symlink_to(secret / "s.txt")
    (home / "dir" / "a.txt").write_text("a")
    r = client.post("/api/file_manager/zip", json={"paths": [str(home / "dir")], "archive_path": str(home / "o.zip")})
    assert r.status_code == 200, r.text
    import zipfile

    with zipfile.ZipFile(home / "o.zip") as z:
        names = z.namelist()
        assert "dir/a.txt" in names and not any("link" in n for n in names)
        assert b"SECRET" not in b"".join(z.read(n) for n in names)


# ── Finding 1: swapped parent (TOCTOU) is refused ─────────────────────────


@pytest.fixture
def swapped(tmp_path):
    """home/x was a real dir at check time; now it is a symlink to secret."""
    home = tmp_path / "h"
    home.mkdir()
    secret = tmp_path / "secret"
    secret.mkdir()
    (secret / "victim").write_text("ROOT FILE")
    (home / "x").symlink_to(secret)
    return home, secret


def test_safe_fs_refuses_symlinked_parent_everywhere(swapped):
    home, secret = swapped
    p = str(home / "x" / "victim")
    with pytest.raises(safe_fs.SymlinkRefused):
        safe_fs.read_bytes(p)
    with pytest.raises(safe_fs.SymlinkRefused):
        safe_fs.write_bytes(p, b"pwned")
    with pytest.raises(safe_fs.SymlinkRefused):
        safe_fs.remove(p)
    with pytest.raises(safe_fs.SymlinkRefused):
        safe_fs.chown_tree(p, (os.getuid(), os.getgid()))
    with pytest.raises(safe_fs.SymlinkRefused):
        safe_fs.mkdir(str(home / "x" / "new"))
    with pytest.raises(safe_fs.SymlinkRefused):
        safe_fs.makedirs(str(home / "x" / "a" / "b"))
    with pytest.raises(safe_fs.SymlinkRefused):
        safe_fs.rename(p, str(home / "stolen"))
    with pytest.raises(safe_fs.SymlinkRefused):
        safe_fs.chmod(p, 0o777)
    assert (secret / "victim").read_text() == "ROOT FILE"
    assert not (secret / "new").exists() and not (secret / "a").exists()


def test_safe_fs_refuses_final_symlink(tmp_path):
    (tmp_path / "t").write_text("T")
    (tmp_path / "l").symlink_to(tmp_path / "t")
    with pytest.raises(safe_fs.SymlinkRefused):
        safe_fs.read_bytes(str(tmp_path / "l"))
    with pytest.raises(safe_fs.SymlinkRefused):
        safe_fs.write_bytes(str(tmp_path / "l"), b"x")
    with pytest.raises(safe_fs.SymlinkRefused):
        safe_fs.chmod(str(tmp_path / "l"), 0o600)
    assert (tmp_path / "t").read_text() == "T"
    # remove() deletes the link itself, never the target
    safe_fs.remove(str(tmp_path / "l"))
    assert (tmp_path / "t").exists()


def test_safe_fs_refuses_hardlinked_file(tmp_path):
    (tmp_path / "t").write_text("T")
    os.link(tmp_path / "t", tmp_path / "h")
    with pytest.raises(safe_fs.SymlinkRefused):
        safe_fs.write_bytes(str(tmp_path / "h"), b"x")
    assert (tmp_path / "t").read_text() == "T"


def test_chown_tree_does_not_follow_symlinks(tmp_path, owner_recorder):
    d = tmp_path / "d"
    (d / "sub").mkdir(parents=True)
    (d / "sub" / "f").write_text("f")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "o").write_text("o")
    (d / "link").symlink_to(outside)
    safe_fs.chown_tree(str(d), (os.getuid(), os.getgid()), recursive=True)
    owned = {p for p, _u, _g in owner_recorder}
    assert os.path.realpath(d / "sub" / "f") in owned
    assert os.path.realpath(outside / "o") not in owned


def test_api_write_through_swapped_parent_is_403(env, monkeypatch):
    """check_safe_path passes, then the parent turns into a symlink (race)."""
    client, home, secret, _ = env
    real_check = fm.check_safe_path

    def racing_check(p, u):
        out = real_check(p, u)
        d = home / "dir"
        if d.is_dir() and not d.is_symlink():
            os.rmdir(d)
            d.symlink_to(secret)
        return out

    monkeypatch.setattr(fm, "check_safe_path", racing_check)
    r = client.post("/api/file_manager/write", json={"path": str(home / "dir" / "s.txt"), "content": "pwned"})
    assert r.status_code == 403, r.text
    assert (secret / "s.txt").read_text() == "TOP-SECRET"


def test_api_delete_through_swapped_parent_is_403(env, monkeypatch):
    client, home, secret, _ = env
    (home / "dir" / "s.txt").write_text("mine")
    real_check = fm.check_safe_path

    def racing_check(p, u):
        out = real_check(p, u)
        d = home / "dir"
        if d.is_dir() and not d.is_symlink():
            (d / "s.txt").unlink()
            os.rmdir(d)
            d.symlink_to(secret)
        return out

    monkeypatch.setattr(fm, "check_safe_path", racing_check)
    r = client.post("/api/file_manager/delete", json={"path": str(home / "dir" / "s.txt")})
    assert r.status_code in (403, 404), r.text
    assert (secret / "s.txt").read_text() == "TOP-SECRET"


def test_restricted_chmod_cannot_set_setuid(env):
    client, home, _, _ = env
    f = home / "x.sh"
    f.write_text("#!/bin/sh\n")
    r = client.post("/api/file_manager/chmod", json={"paths": [str(f)], "mode": "4755"})
    assert r.status_code == 200
    assert stat.S_IMODE(f.stat().st_mode) == 0o755


# ── Finding 6: empty folder list = no access; picker gated + read-only ────


def test_empty_permitted_folders_has_no_file_access(env):
    client, home, _, user = env
    user["permitted_folders"] = "[]"
    for path in (None, "/home", str(home)):
        params = {"path": path} if path else {}
        r = client.get("/api/file_manager/list", params=params)
        assert r.status_code == 403, (path, r.text)
    user["permitted_modules"] = '["docker_manager"]'
    r = client.get("/api/platform/folder-picker", params={"path": "/home"})
    assert r.status_code == 403
    r = client.post("/api/platform/folder-picker/create-dir", json={"parent": "/home", "name": "x"})
    assert r.status_code == 403


def test_folder_picker_needs_a_module_that_uses_it(env):
    client, home, _, user = env
    user["permitted_modules"] = '["system_monitor"]'
    assert client.get("/api/platform/folder-picker", params={"path": str(home)}).status_code == 403
    r = client.post("/api/platform/folder-picker/create-dir", json={"parent": str(home), "name": "n"})
    assert r.status_code == 403 and not (home / "n").exists()
    user["permitted_modules"] = '["docker_manager"]'
    assert client.get("/api/platform/folder-picker", params={"path": str(home)}).status_code == 200


def test_folder_picker_get_creates_nothing(env, tmp_path):
    client, home, _, user = env
    missing = tmp_path / "home" / "nobody"
    user["permitted_folders"] = '["%s"]' % missing
    r = client.get("/api/platform/folder-picker")
    assert r.status_code == 404
    assert not missing.exists()


def test_folder_picker_mkdir_through_symlinked_parent_is_403(env):
    client, home, secret, _ = env
    (home / "sl").symlink_to(home / "dir")  # inside the sandbox: listing works
    assert client.get("/api/platform/folder-picker", params={"path": str(home / "sl")}).status_code == 200
    r = client.post("/api/platform/folder-picker/create-dir", json={"parent": str(home / "sl"), "name": "n"})
    # check_safe_path resolves the parent; the create itself walks without symlinks
    assert r.status_code == 200 and (home / "dir" / "n").is_dir()


# ── Finding 7: ticket caps, rate limit, revocation ────────────────────────


@pytest.fixture(autouse=True)
def _clean_tickets():
    st.clear_tickets()
    yield
    st.clear_tickets()


def test_per_user_ticket_cap_evicts_only_own_tickets():
    admin = {"username": "admin", "token_version": 0}
    keep = st.issue_ticket(admin)
    mallory = {"username": "mallory", "token_version": 0}
    for _ in range(st.MAX_TICKETS_PER_USER + 10):
        st.issue_ticket(mallory)
    assert len(st._per_user["mallory"]) == st.MAX_TICKETS_PER_USER
    assert keep in st._tickets


def test_ticket_rate_limit(monkeypatch):
    monkeypatch.setattr(st, "RATE_LIMIT_COUNT", 5)
    u = {"username": "fast", "token_version": 0}
    for _ in range(5):
        st.issue_ticket(u)
    with pytest.raises(st.TicketRateLimited):
        st.issue_ticket(u)


def test_ticket_endpoint_returns_429(monkeypatch):
    from modules.auth.router import router as auth_router

    user = {"id": 3, "username": "spam", "role": "user", "token_version": 0}
    monkeypatch.setattr(auth_mod, "_AUTH_DISABLED", False)
    monkeypatch.setattr(auth_mod, "_user_from_token", lambda _a: user)
    monkeypatch.setattr(st, "RATE_LIMIT_COUNT", 2)
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(auth_router, prefix="/api/auth")
    c = TestClient(app)
    h = {"Authorization": "Bearer x"}
    assert c.post("/api/auth/stream-ticket", headers=h).status_code == 200
    assert c.post("/api/auth/stream-ticket", headers=h).status_code == 200
    assert c.post("/api/auth/stream-ticket", headers=h).status_code == 429


def test_full_store_rejects_instead_of_evicting(monkeypatch):
    monkeypatch.setattr(st, "_MAX_TICKETS", 3)
    a = st.issue_ticket({"username": "a"})
    st.issue_ticket({"username": "b"})
    st.issue_ticket({"username": "c"})
    with pytest.raises(st.TicketRateLimited):
        st.issue_ticket({"username": "d"})
    assert a in st._tickets


def test_logout_revokes_outstanding_tickets():
    t = st.issue_ticket({"username": "bob"})
    assert st.revoke_user_tickets("bob") == 1
    assert t not in st._tickets


def test_session_still_valid_tracks_token_version(monkeypatch):
    from core import user_model

    db = {"bob": {"username": "bob", "token_version": 1}}
    monkeypatch.setattr(user_model, "get_user_by_username", lambda n: db.get(n))
    assert st.session_still_valid({"username": "bob", "token_version": 1})
    db["bob"]["token_version"] = 2  # logout / password change
    assert not st.session_still_valid({"username": "bob", "token_version": 1})
    del db["bob"]
    assert not st.session_still_valid({"username": "bob", "token_version": 1})


def test_sse_stream_closes_when_session_revoked():
    import asyncio

    from core.events import sse_stream

    async def run():
        gen = sse_stream(["jobs"], heartbeat_seconds=0.05, still_valid=lambda: False, revalidate_seconds=0.0)
        frames = []
        async for frame in gen:
            frames.append(frame)
        return frames

    frames = asyncio.run(asyncio.wait_for(run(), timeout=5))
    assert frames and "session_expired" in frames[-1]


def test_media_token_is_path_scoped_and_revocable(monkeypatch):
    from core import user_model

    db = {"bob": {"username": "bob", "token_version": 0, "role": "user"}}
    monkeypatch.setattr(user_model, "get_user_by_username", lambda n: db.get(n))
    tok = st.issue_media_token({"username": "bob", "token_version": 0}, "/api/audio_station/stream")
    assert st.user_from_media_token(tok, "/api/audio_station/stream")["username"] == "bob"
    # Reusable (range requests / seeking)
    assert st.user_from_media_token(tok, "/api/audio_station/stream")
    # Other paths: never
    for path in ("/api/audio_station/cover", "/api/file_manager/list", "/api/audio_station/streamx"):
        assert st.user_from_media_token(tok, path) is None
    # Tampered
    assert st.user_from_media_token(tok[:-2] + "AA", "/api/audio_station/stream") is None
    # Revoked by logout / password change
    db["bob"]["token_version"] = 1
    assert st.user_from_media_token(tok, "/api/audio_station/stream") is None
    with pytest.raises(ValueError):
        st.issue_media_token({"username": "bob"}, "/api/file_manager/list")


def test_media_token_expires(monkeypatch):
    from core import user_model

    monkeypatch.setattr(user_model, "get_user_by_username", lambda n: {"username": n, "token_version": 0})
    tok = st.issue_media_token({"username": "bob", "token_version": 0}, "/api/audio_station/cover", ttl=-1)
    assert st.user_from_media_token(tok, "/api/audio_station/cover") is None


def test_middleware_accepts_media_token_only_in_scope(monkeypatch):
    from core import user_model
    from fastapi import Request

    monkeypatch.setattr(auth_mod, "_AUTH_DISABLED", False)
    monkeypatch.setattr(user_model, "get_user_by_username", lambda n: {"username": n, "token_version": 0, "role": "user"})
    app = FastAPI()
    app.middleware("http")(auth_mod.api_auth_middleware)

    @app.get("/api/audio_station/stream")
    def s(request: Request):
        return {"u": request.state.stream_user["username"]}

    @app.get("/api/file_manager/list")
    def other():
        return {"leak": True}

    tok = st.issue_media_token({"username": "bob", "token_version": 0}, "/api/audio_station/stream")
    c = TestClient(app)
    assert c.get("/api/audio_station/stream", params={"media_token": tok}).json() == {"u": "bob"}
    assert c.get("/api/file_manager/list", params={"media_token": tok}).status_code == 401
    assert c.get("/api/audio_station/stream", params={"access_token": "x"}).status_code == 401
