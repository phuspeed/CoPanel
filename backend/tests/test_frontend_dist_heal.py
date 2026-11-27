"""Startup repair: replace a stale (pre-ticket) frontend dist from the prebuilt archive."""

from __future__ import annotations

import io
import tarfile
from pathlib import Path

import pytest

from core import frontend_dist as fd


def _write_index(dist: Path, script_name: str, js: str) -> None:
    assets = dist / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    (dist / "index.html").write_text(
        f'<!DOCTYPE html><script type="module" src="/assets/{script_name}"></script>',
        encoding="utf-8",
    )
    (assets / script_name).write_text(js, encoding="utf-8")


def _ticket_js() -> str:
    return (
        'async function ey(){const e=await ht("/api/auth/stream-ticket",{method:"POST"});'
        'return t?`/api/platform/events?${new URLSearchParams({topics:"jobs,notifications",ticket:t}).toString()}`:null}'
    )


def _legacy_js() -> str:
    return (
        "buildUrl(){const token=getAuthToken();return token?"
        '`/api/platform/events?${new URLSearchParams({topics:"jobs,notifications",access_token:token}).toString()}`:null}'
    )


def _tarball_with_ticket_dist(path: Path) -> Path:
    staging = path / "src"
    dist = staging / "dist"
    _write_index(dist, "index-NEW.js", _ticket_js())
    (dist / "importmap.json").write_text("{}", encoding="utf-8")
    archive = path / "dist.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(dist, arcname="dist")
    return archive


def test_detects_legacy_access_token_client(tmp_path: Path):
    dist = tmp_path / "dist"
    _write_index(dist, "index-OLD.js", _legacy_js())
    assert fd.dist_uses_legacy_access_token(dist) is True
    assert fd.dist_uses_stream_tickets(dist) is False


def test_detects_ticket_client(tmp_path: Path):
    dist = tmp_path / "dist"
    _write_index(dist, "index-NEW.js", _ticket_js())
    assert fd.dist_uses_legacy_access_token(dist) is False
    assert fd.dist_uses_stream_tickets(dist) is True


def test_heal_replaces_legacy_dist_and_keeps_extensions(tmp_path: Path):
    home = tmp_path / "opt" / "copanel"
    frontend = home / "frontend"
    dist = frontend / "dist"
    _write_index(dist, "index-OLD.js", _legacy_js())
    ext = dist / "extensions" / "file_manager"
    ext.mkdir(parents=True)
    (ext / "module.js").write_text("extension-keep", encoding="utf-8")
    archive = _tarball_with_ticket_dist(frontend / "prebuilt")
    assert archive.is_file()

    assert fd.maybe_heal_stale_frontend_dist(home) is True
    assert fd.dist_uses_stream_tickets(frontend / "dist") is True
    assert not fd.dist_uses_legacy_access_token(frontend / "dist")
    assert (frontend / "dist" / "extensions" / "file_manager" / "module.js").read_text(
        encoding="utf-8"
    ) == "extension-keep"
    # Old hashed bundle should be gone.
    assert not (frontend / "dist" / "assets" / "index-OLD.js").exists()
    assert (frontend / "dist" / "assets" / "index-NEW.js").is_file()


def test_heal_is_noop_when_dist_already_current(tmp_path: Path):
    home = tmp_path / "opt" / "copanel"
    frontend = home / "frontend"
    _write_index(frontend / "dist", "index-NEW.js", _ticket_js())
    _tarball_with_ticket_dist(frontend / "prebuilt")
    marker = frontend / "dist" / "assets" / "index-NEW.js"
    before = marker.read_text(encoding="utf-8")
    assert fd.maybe_heal_stale_frontend_dist(home) is False
    assert marker.read_text(encoding="utf-8") == before


def test_heal_is_noop_without_prebuilt_archive(tmp_path: Path):
    home = tmp_path / "opt" / "copanel"
    _write_index(home / "frontend" / "dist", "index-OLD.js", _legacy_js())
    assert fd.maybe_heal_stale_frontend_dist(home) is False
    assert fd.dist_uses_legacy_access_token(home / "frontend" / "dist") is True


def test_extract_rejects_path_traversal(tmp_path: Path):
    frontend = tmp_path / "frontend"
    frontend.mkdir()
    archive = tmp_path / "evil.tar.gz"
    buf = io.BytesIO()
    # Build a crafted tar with a parent path. tarfile will add it if we set the name.
    with tarfile.open(archive, "w:gz") as tar:
        info = tarfile.TarInfo(name="../evil.js")
        data = b"nope"
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    assert fd.extract_prebuilt_frontend(frontend, archive) is False
    assert not (tmp_path / "evil.js").exists()
