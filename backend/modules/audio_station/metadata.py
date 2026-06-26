"""Read audio file metadata via mutagen with filename fallback."""
from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

try:
    from mutagen import File as MutagenFile
except ImportError:  # pragma: no cover
    MutagenFile = None  # type: ignore


def track_id_for_path(path: str) -> str:
    return hashlib.sha256(path.encode("utf-8")).hexdigest()[:32]


def cover_hash_for_data(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:32]


def extract_cover_bytes(path: str) -> Optional[Tuple[bytes, str]]:
    """Return (image_bytes, mime_type) from embedded album art, if any."""
    if MutagenFile is None or not os.path.isfile(path):
        return None
    try:
        audio = MutagenFile(path)
    except Exception:
        return None
    if audio is None:
        return None

    if hasattr(audio, "pictures") and audio.pictures:
        pic = audio.pictures[0]
        data = getattr(pic, "data", None)
        if data:
            mime = getattr(pic, "mime", None) or "image/jpeg"
            return data, mime

    tags = getattr(audio, "tags", None)
    if tags:
        for key, val in tags.items():
            key_s = str(key)
            if key_s.startswith("APIC") or "cov" in key_s.lower():
                data = getattr(val, "data", None)
                if data:
                    mime = getattr(val, "mime", None) or "image/jpeg"
                    return data, mime
    return None


def _first_tag(tags: Any, *keys: str) -> Optional[str]:
    if tags is None:
        return None
    for key in keys:
        val = None
        if hasattr(tags, "get"):
            val = tags.get(key)
        elif isinstance(tags, dict):
            val = tags.get(key)
        if val is None:
            continue
        if isinstance(val, (list, tuple)):
            val = val[0] if val else None
        if val is not None:
            s = str(val).strip()
            if s:
                return s
    return None


def _parse_int(val: Optional[str]) -> Optional[int]:
    if not val:
        return None
    m = re.match(r"(\d+)", str(val).strip())
    return int(m.group(1)) if m else None


def _title_from_filename(path: str) -> str:
    stem = Path(path).stem
    if " - " in stem:
        return stem.split(" - ", 1)[1].strip() or stem
    return stem


def _artist_from_filename(path: str) -> Optional[str]:
    stem = Path(path).stem
    if " - " in stem:
        return stem.split(" - ", 1)[0].strip() or None
    return None


def read_metadata(path: str) -> Dict[str, Any]:
    """Extract tags from an audio file. Falls back to filename heuristics."""
    p = Path(path)
    st = os.stat(path)
    base: Dict[str, Any] = {
        "title": _title_from_filename(path),
        "artist": _artist_from_filename(path),
        "album": p.parent.name if p.parent.name not in ("", ".", "..") else None,
        "album_artist": None,
        "genre": None,
        "composer": None,
        "track_number": None,
        "disc_number": None,
        "duration_sec": None,
        "bitrate": None,
        "codec": p.suffix.lower().lstrip("."),
        "file_size": st.st_size,
        "mtime": st.st_mtime,
    }

    if MutagenFile is None:
        return base

    try:
        audio = MutagenFile(path, easy=True)
    except Exception:
        return base

    if audio is None:
        return base

    tags = getattr(audio, "tags", None) or audio
    base["title"] = _first_tag(tags, "title", "TIT2") or base["title"]
    base["artist"] = _first_tag(tags, "artist", "TPE1") or base["artist"]
    base["album"] = _first_tag(tags, "album", "TALB") or base["album"]
    base["album_artist"] = _first_tag(tags, "albumartist", "album_artist", "TPE2")
    base["genre"] = _first_tag(tags, "genre", "TCON")
    base["composer"] = _first_tag(tags, "composer", "TCOM")
    base["track_number"] = _parse_int(_first_tag(tags, "tracknumber", "track", "TRCK"))
    base["disc_number"] = _parse_int(_first_tag(tags, "discnumber", "disc", "TPOS"))

    length = getattr(audio.info, "length", None) if hasattr(audio, "info") else None
    if length is not None:
        try:
            base["duration_sec"] = float(length)
        except (TypeError, ValueError):
            pass

    bitrate = getattr(audio.info, "bitrate", None) if hasattr(audio, "info") else None
    if bitrate is not None:
        try:
            base["bitrate"] = int(bitrate)
        except (TypeError, ValueError):
            pass

    return base
