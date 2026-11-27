"""Repair a stale panel UI left behind when an upgrade skipped the frontend.

The footer version comes from ``GET /health`` (backend ``VERSION``). Panel
Update rsync/git-clean excludes ``frontend/dist/``, then ``setup_frontend``
extracts ``frontend/prebuilt/dist.tar.gz``. If that extract is skipped or
fails, the API can be 1.1.20+ while the browser still runs the pre-1.1.11
EventSource client that puts the login JWT in
``/api/platform/events?access_token=...``. The backend correctly rejects
that query parameter, and the old EventSource loop spams 401s.

On startup, if the live main bundle still has that legacy URL (or is
missing the stream-ticket client) and the committed prebuilt archive is
present, extract it and keep ``dist/extensions`` so AppStore modules stay.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import tarfile
import tempfile
from pathlib import Path
from typing import Optional, Union

logger = logging.getLogger(__name__)

PathLike = Union[str, Path]

_MAIN_JS_RE = re.compile(r"""src=["'](/assets/index-[^"']+\.js)["']""")
# Minified and source-shaped markers for the 1.1.11+ ticket client.
_TICKET_CLIENT_MARKERS = (
    "/api/auth/stream-ticket",
)
_TICKET_URL_COMPACT = 'topics:"jobs,notifications",ticket:'
# Pre-1.1.11 EventHub: login JWT goes in the EventSource query string.
_LEGACY_URL_COMPACT = 'topics:"jobs,notifications",access_token:'


def copanel_home() -> Path:
    return Path(os.environ.get("COPANEL_HOME", "/opt/copanel"))


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", text)


def _main_bundle_text(dist: Path) -> str:
    index = dist / "index.html"
    if not index.is_file():
        return ""
    try:
        html = index.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    match = _MAIN_JS_RE.search(html)
    candidates = []
    if match:
        candidates.append(dist / match.group(1).lstrip("/"))
    assets = dist / "assets"
    if assets.is_dir():
        candidates.extend(sorted(assets.glob("index-*.js"), key=lambda p: p.stat().st_size, reverse=True))
    seen = set()
    chunks: list[str] = []
    for path in candidates:
        resolved = path if path.is_absolute() else dist / path
        try:
            key = str(resolved.resolve())
        except OSError:
            continue
        if key in seen or not resolved.is_file():
            continue
        seen.add(key)
        try:
            chunks.append(resolved.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            continue
        # The events client lives in the large main bundle; one read is enough
        # when index.html pointed at it.
        if match and resolved.name == Path(match.group(1)).name:
            break
    return "\n".join(chunks)


def dist_uses_stream_tickets(dist: PathLike) -> bool:
    """True when the live UI mints ``?ticket=`` for ``/api/platform/events``."""
    text = _main_bundle_text(Path(dist))
    if not text:
        return False
    compact = _compact(text)
    if _LEGACY_URL_COMPACT in compact:
        return False
    return all(m in text for m in _TICKET_CLIENT_MARKERS) and _TICKET_URL_COMPACT in compact


def dist_uses_legacy_access_token(dist: PathLike) -> bool:
    """True when the live UI still puts the login JWT in ``?access_token=``."""
    text = _main_bundle_text(Path(dist))
    if not text:
        return False
    return _LEGACY_URL_COMPACT in _compact(text)


def _safe_members(tar: tarfile.TarFile, dest: Path):
    dest = dest.resolve()
    for member in tar.getmembers():
        name = member.name
        if name.startswith("/") or name.startswith("\\"):
            raise ValueError(f"unsafe absolute path in archive: {name}")
        # Windows-style or parent traversal
        parts = re.split(r"[\\/]+", name)
        if any(part == ".." for part in parts):
            raise ValueError(f"unsafe path in archive: {name}")
        target = (dest / name).resolve()
        if target != dest and not str(target).startswith(str(dest) + os.sep):
            raise ValueError(f"unsafe path in archive: {name}")
        if member.issym() or member.islnk():
            raise ValueError(f"refusing link in archive: {name}")
        yield member


def extract_prebuilt_frontend(frontend: Path, archive: Path) -> bool:
    """Replace ``frontend/dist`` from ``archive``, preserving ``dist/extensions``."""
    frontend = Path(frontend)
    archive = Path(archive)
    dist = frontend / "dist"
    if not archive.is_file():
        return False
    ext_backup = None
    extensions = dist / "extensions"
    try:
        if extensions.is_dir():
            ext_backup = Path(tempfile.mkdtemp(prefix="copanel-dist-ext-"))
            shutil.copytree(extensions, ext_backup, dirs_exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix="copanel-dist-extract-"))
        try:
            with tarfile.open(archive, "r:gz") as tar:
                members = list(_safe_members(tar, staging))
                # Python 3.12+ supports filter=; older runtimes ignore it.
                try:
                    tar.extractall(staging, members=members, filter="data")
                except TypeError:
                    tar.extractall(staging, members=members)
            extracted = staging / "dist"
            if not (extracted / "index.html").is_file():
                # Flat tarball: index.html at archive root.
                if (staging / "index.html").is_file():
                    extracted = staging
                else:
                    logger.error("Prebuilt frontend archive did not contain index.html")
                    return False
            if dist.exists():
                shutil.rmtree(dist)
            shutil.copytree(extracted, dist)
        finally:
            shutil.rmtree(staging, ignore_errors=True)
        if ext_backup is not None:
            dest_ext = dist / "extensions"
            dest_ext.mkdir(parents=True, exist_ok=True)
            shutil.copytree(ext_backup, dest_ext, dirs_exist_ok=True)
        if not (dist / "index.html").is_file():
            logger.error("Extracted frontend dist is missing index.html")
            return False
        logger.info("Installed prebuilt frontend from %s", archive)
        return True
    except (OSError, tarfile.TarError, ValueError) as exc:
        logger.error("Failed to extract prebuilt frontend: %s", exc)
        return False
    finally:
        if ext_backup is not None:
            shutil.rmtree(ext_backup, ignore_errors=True)


def maybe_heal_stale_frontend_dist(home: Optional[PathLike] = None) -> bool:
    """Extract the prebuilt UI when the live dist still sends ``?access_token=``.

    Returns True when the dist was replaced.
    """
    root = Path(home) if home is not None else copanel_home()
    frontend = root / "frontend"
    dist = frontend / "dist"
    archive = frontend / "prebuilt" / "dist.tar.gz"
    if not archive.is_file():
        return False
    if dist_uses_stream_tickets(dist):
        return False
    reason = (
        "legacy ?access_token= EventSource client"
        if dist_uses_legacy_access_token(dist)
        else "missing stream-ticket EventSource client"
    )
    logger.warning(
        "Live frontend dist is stale (%s); extracting %s",
        reason,
        archive,
    )
    return extract_prebuilt_frontend(frontend, archive)
