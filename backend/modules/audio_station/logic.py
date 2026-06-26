"""
Audio Player — music library with folder browsing and metadata index.
"""
from __future__ import annotations

import json
import mimetypes
import os
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .metadata import (
    cover_hash_for_data,
    extract_cover_bytes,
    read_metadata,
    track_id_for_path,
)

IS_WINDOWS = os.name == "nt"
CONFIG_DIR = (
    Path("./test_nginx/audio_station")
    if IS_WINDOWS
    else Path("/opt/copanel/config/audio_station")
)
DB_PATH = CONFIG_DIR / "library.db"
COVERS_DIR = CONFIG_DIR / "covers"

SYSTEM_PLAYLIST_RECENT = "__recent__"
SYSTEM_PLAYLIST_RANDOM = "__random__"

AUDIO_EXTENSIONS = {".mp3", ".flac", ".ogg", ".m4a", ".wav", ".aac", ".opus", ".wma"}

DEFAULT_SETTINGS: Dict[str, Any] = {
    "library_roots": [str(Path("/home/music") if not IS_WINDOWS else Path("./test_nginx/music"))],
    "scan_on_startup": True,
    "scan_interval_hours": 6,
    "follow_symlinks": False,
    "max_scan_depth": 12,
}

_scan_lock = threading.Lock()
_scan_running = False


def _utc_placeholder() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _db() -> sqlite3.Connection:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    with _db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tracks (
                id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                rel_path TEXT NOT NULL,
                root_path TEXT NOT NULL,
                title TEXT,
                artist TEXT,
                album TEXT,
                album_artist TEXT,
                genre TEXT,
                composer TEXT,
                track_number INTEGER,
                disc_number INTEGER,
                duration_sec REAL,
                bitrate INTEGER,
                codec TEXT,
                file_size INTEGER,
                mtime REAL,
                cover_hash TEXT,
                scanned_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
            CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
            CREATE INDEX IF NOT EXISTS idx_tracks_mtime ON tracks(mtime DESC);
            CREATE TABLE IF NOT EXISTS scan_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                status TEXT NOT NULL DEFAULT 'idle',
                progress REAL DEFAULT 0,
                files_found INTEGER DEFAULT 0,
                files_indexed INTEGER DEFAULT 0,
                last_started TEXT,
                last_finished TEXT,
                error_message TEXT
            );
            INSERT OR IGNORE INTO scan_state (id, status) VALUES (1, 'idle');
            CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_id TEXT NOT NULL,
                track_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                added_at TEXT NOT NULL,
                PRIMARY KEY (playlist_id, position),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pid ON playlist_tracks(playlist_id);
            """
        )
        try:
            conn.execute("ALTER TABLE tracks ADD COLUMN cover_hash TEXT")
        except sqlite3.OperationalError:
            pass
        for key, val in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, json.dumps(val)),
            )


def _get_setting(key: str) -> Any:
    with _db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if not row:
        return DEFAULT_SETTINGS.get(key)
    try:
        return json.loads(row["value"])
    except json.JSONDecodeError:
        return row["value"]


def _set_setting(key: str, value: Any) -> None:
    with _db() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )


def _ensure_default_roots() -> None:
    roots = _get_setting("library_roots") or []
    if not isinstance(roots, list):
        roots = [str(roots)]
    changed = False
    normalized: List[str] = []
    for r in roots:
        p = Path(str(r)).expanduser()
        try:
            p.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        normalized.append(str(p.resolve() if p.exists() else p))
    if not normalized:
        default = Path(DEFAULT_SETTINGS["library_roots"][0])
        try:
            default.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        normalized = [str(default.resolve() if default.exists() else default)]
        changed = True
    if changed or normalized != roots:
        _set_setting("library_roots", normalized)


def get_settings() -> Dict[str, Any]:
    _init_db()
    _ensure_default_roots()
    return {k: _get_setting(k) for k in DEFAULT_SETTINGS}


def save_settings(data: Dict[str, Any]) -> Dict[str, Any]:
    _init_db()
    roots_changed = False
    for key in DEFAULT_SETTINGS:
        if key not in data or data[key] is None:
            continue
        if key == "library_roots":
            roots = data["library_roots"]
            if not isinstance(roots, list) or not roots:
                raise ValueError("library_roots must be a non-empty list")
            cleaned = []
            for r in roots:
                p = Path(str(r)).expanduser()
                try:
                    p.mkdir(parents=True, exist_ok=True)
                except OSError as exc:
                    raise ValueError(f"Cannot access library root {r}: {exc}") from exc
                cleaned.append(str(p.resolve()))
            old = _get_setting("library_roots")
            roots_changed = cleaned != old
            _set_setting("library_roots", cleaned)
        else:
            _set_setting(key, data[key])
    saved = get_settings()
    if roots_changed and saved.get("scan_on_startup"):
        trigger_scan()
    return saved


def get_library_roots() -> List[str]:
    settings = get_settings()
    roots = settings.get("library_roots") or []
    if not isinstance(roots, list):
        return [str(roots)]
    return [str(r) for r in roots]


def _real_path(path: str, follow_symlinks: bool) -> str:
    if follow_symlinks:
        return os.path.realpath(os.path.abspath(path))
    return os.path.abspath(path)


def resolve_library_path(requested: str, *, allow_root_default: bool = False) -> str:
    """Return safe absolute path inside configured library roots."""
    settings = get_settings()
    roots = get_library_roots()
    if not roots:
        raise ValueError("No music library folders configured")

    follow = bool(settings.get("follow_symlinks"))

    if not requested or not str(requested).strip():
        if allow_root_default:
            return _real_path(roots[0], follow)
        raise ValueError("Path is required")

    abs_path = _real_path(str(requested).strip(), follow)

    for root in roots:
        root_real = _real_path(root, follow)
        if abs_path == root_real or abs_path.startswith(root_real + os.sep):
            if not os.path.exists(abs_path):
                raise ValueError("Path does not exist")
            return abs_path

    raise ValueError("Path is outside configured music library folders")


def is_audio_file(name: str) -> bool:
    return Path(name).suffix.lower() in AUDIO_EXTENSIONS


def _mime_for_path(path: str) -> str:
    ext = Path(path).suffix.lower()
    mapping = {
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".wav": "audio/wav",
        ".opus": "audio/opus",
        ".wma": "audio/x-ms-wma",
    }
    if ext in mapping:
        return mapping[ext]
    guessed, _ = mimetypes.guess_type(path)
    return guessed or "application/octet-stream"


def browse_library(path: str = "") -> Dict[str, Any]:
    """List subfolders and audio files under a library path (folder mode)."""
    target = resolve_library_path(path, allow_root_default=True)
    if not os.path.isdir(target):
        raise ValueError("Path is not a directory")

    dirs: List[Dict[str, Any]] = []
    files: List[Dict[str, Any]] = []

    try:
        entries = sorted(os.listdir(target), key=lambda n: n.lower())
    except PermissionError as exc:
        raise ValueError(f"Permission denied: {target}") from exc

    for name in entries:
        if name.startswith("."):
            continue
        full = os.path.join(target, name)
        try:
            if os.path.isdir(full):
                dirs.append({"name": name, "path": full, "type": "dir"})
            elif os.path.isfile(full) and is_audio_file(name):
                st = os.stat(full)
                files.append(
                    {
                        "name": name,
                        "path": full,
                        "type": "file",
                        "size": st.st_size,
                        "mtime": st.st_mtime,
                    }
                )
        except OSError:
            continue

    breadcrumbs: List[Dict[str, str]] = []
    follow = bool(get_settings().get("follow_symlinks"))
    target_real = _real_path(target, follow)
    matched_root = get_library_roots()[0]
    for root in get_library_roots():
        root_real = _real_path(root, follow)
        if target_real == root_real or target_real.startswith(root_real + os.sep):
            matched_root = root_real
            rel = os.path.relpath(target_real, root_real)
            breadcrumbs.append({"name": os.path.basename(root_real) or root_real, "path": root_real})
            if rel and rel != ".":
                parts = rel.split(os.sep)
                acc = root_real
                for part in parts:
                    acc = os.path.join(acc, part)
                    breadcrumbs.append({"name": part, "path": acc})
            break

    parent: Optional[str] = None
    if target_real != matched_root:
        parent_path = os.path.dirname(target_real)
        try:
            resolve_library_path(parent_path)
            parent = parent_path
        except ValueError:
            parent = matched_root

    return {
        "current": target_real,
        "parent": parent,
        "roots": get_library_roots(),
        "dirs": dirs,
        "files": files,
        "breadcrumbs": breadcrumbs,
    }


def browse_folders_picker(path: str = "") -> Dict[str, Any]:
    """Folder picker for settings — starts at /home, not system root."""
    settings = get_settings()
    roots = get_library_roots()
    follow = bool(settings.get("follow_symlinks"))

    if path:
        try:
            base = Path(path).expanduser().resolve()
        except OSError:
            base = Path(roots[0])
    else:
        base = Path("/home" if not IS_WINDOWS else roots[0])
        if not base.exists():
            base = Path(roots[0])

    if not base.exists():
        try:
            base.mkdir(parents=True, exist_ok=True)
        except OSError:
            base = Path(roots[0])

    entries: List[Dict[str, str]] = []
    parent: Optional[str] = None
    try:
        for item in sorted(base.iterdir(), key=lambda p: p.name.lower()):
            if item.is_dir() and not item.name.startswith("."):
                entries.append({"name": item.name, "path": str(item), "type": "dir"})
    except PermissionError:
        pass

    if base.parent != base:
        parent = str(base.parent)

    return {
        "current": str(base),
        "parent": parent,
        "entries": entries,
        "volumes": _list_picker_volumes(roots),
        "library_roots": roots,
    }


def _list_picker_volumes(roots: List[str]) -> List[Dict[str, str]]:
    if IS_WINDOWS:
        return [{"label": "Music", "path": roots[0] if roots else "."}]
    out: List[Dict[str, str]] = []
    seen = set()
    for candidate in ["/home", "/mnt"]:
        if os.path.isdir(candidate) and candidate not in seen:
            out.append({"label": candidate, "path": candidate})
            seen.add(candidate)
    try:
        with open("/proc/mounts", "r", encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    mp = parts[1]
                    if mp.startswith("/mnt/") and mp not in seen:
                        out.append({"label": mp, "path": mp})
                        seen.add(mp)
    except OSError:
        pass
    for r in roots:
        if r not in seen:
            out.append({"label": r, "path": r})
            seen.add(r)
    return out or [{"label": "/home", "path": "/home"}]


def get_stream_info(path: str) -> Tuple[str, str]:
    """Validate path and return (absolute_path, media_type)."""
    target = resolve_library_path(path)
    if not os.path.isfile(target):
        raise ValueError("Not a file")
    if not is_audio_file(target):
        raise ValueError("Not an audio file")
    return target, _mime_for_path(target)


def get_library_stats() -> Dict[str, Any]:
    _init_db()
    with _db() as conn:
        track_count = conn.execute("SELECT COUNT(*) AS c FROM tracks").fetchone()["c"]
        album_count = conn.execute(
            "SELECT COUNT(DISTINCT album || '|' || COALESCE(album_artist,'')) FROM tracks WHERE album IS NOT NULL AND album != ''"
        ).fetchone()[0]
        artist_count = conn.execute(
            "SELECT COUNT(DISTINCT artist) FROM tracks WHERE artist IS NOT NULL AND artist != ''"
        ).fetchone()[0]
        scan = conn.execute("SELECT * FROM scan_state WHERE id = 1").fetchone()
    scan_row = dict(scan) if scan else {"status": "idle"}
    return {
        "tracks": track_count,
        "albums": album_count,
        "artists": artist_count,
        "scan": {
            "status": scan_row.get("status", "idle"),
            "progress": scan_row.get("progress", 0),
            "files_found": scan_row.get("files_found", 0),
            "files_indexed": scan_row.get("files_indexed", 0),
            "last_started": scan_row.get("last_started"),
            "last_finished": scan_row.get("last_finished"),
            "error_message": scan_row.get("error_message"),
        },
        "library_roots": get_library_roots(),
    }


def _row_to_track(row: sqlite3.Row) -> Dict[str, Any]:
    d = dict(row)
    cover_hash = d.get("cover_hash") or ""
    return {
        "id": d["id"],
        "path": d["path"],
        "title": d.get("title") or Path(d["path"]).stem,
        "artist": d.get("artist") or "",
        "album": d.get("album") or "",
        "album_artist": d.get("album_artist") or "",
        "genre": d.get("genre") or "",
        "duration_sec": d.get("duration_sec"),
        "track_number": d.get("track_number"),
        "file_size": d.get("file_size"),
        "cover_hash": cover_hash or None,
        "has_cover": bool(cover_hash),
    }


def _cover_ext_for_mime(mime: str) -> str:
    if "png" in mime:
        return ".png"
    if "gif" in mime:
        return ".gif"
    if "webp" in mime:
        return ".webp"
    return ".jpg"


def _cache_cover_for_file(abs_path: str) -> Optional[str]:
    """Extract embedded art and cache to COVERS_DIR. Returns cover_hash or None."""
    extracted = extract_cover_bytes(abs_path)
    if not extracted:
        return None
    data, mime = extracted
    if not data:
        return None
    cover_hash = cover_hash_for_data(data)
    COVERS_DIR.mkdir(parents=True, exist_ok=True)
    ext = _cover_ext_for_mime(mime)
    dest = COVERS_DIR / f"{cover_hash}{ext}"
    if not dest.is_file():
        try:
            dest.write_bytes(data)
        except OSError:
            return None
    return cover_hash


def _cover_file_for_hash(cover_hash: str) -> Optional[Tuple[str, str]]:
    if not cover_hash:
        return None
    for ext, mime in (
        (".jpg", "image/jpeg"),
        (".jpeg", "image/jpeg"),
        (".png", "image/png"),
        (".gif", "image/gif"),
        (".webp", "image/webp"),
    ):
        fp = COVERS_DIR / f"{cover_hash}{ext}"
        if fp.is_file():
            return str(fp), mime
    return None


def get_cover_info(
    *,
    path: str = "",
    track_id: str = "",
    cover_hash: str = "",
) -> Tuple[str, str]:
    """Resolve cover cache file. Returns (filepath, media_type)."""
    ch = cover_hash.strip()
    if not ch and track_id:
        _init_db()
        with _db() as conn:
            row = conn.execute(
                "SELECT cover_hash, path FROM tracks WHERE id = ?", (track_id,)
            ).fetchone()
        if row:
            ch = row["cover_hash"] or ""
            if not ch and row["path"]:
                path = row["path"]
    if not ch and path:
        try:
            safe = resolve_library_path(path)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        _init_db()
        with _db() as conn:
            row = conn.execute(
                "SELECT cover_hash FROM tracks WHERE path = ?", (safe,)
            ).fetchone()
        if row and row["cover_hash"]:
            ch = row["cover_hash"]
        else:
            ch = _cache_cover_for_file(safe) or ""
            if ch and row:
                with _db() as conn2:
                    conn2.execute(
                        "UPDATE tracks SET cover_hash = ? WHERE path = ?", (ch, safe)
                    )
                    conn2.commit()
    if not ch:
        raise ValueError("No cover art found")
    cached = _cover_file_for_hash(ch)
    if not cached:
        raise ValueError("Cover file missing from cache")
    return cached


def _album_key(album: str, album_artist: str) -> str:
    return track_id_for_path(f"{album}\0{album_artist or ''}")


def _iter_audio_files() -> List[Tuple[str, str]]:
    """Yield (absolute_path, root_path) for every audio file under library roots."""
    settings = get_settings()
    max_depth = int(settings.get("max_scan_depth") or 12)
    follow = bool(settings.get("follow_symlinks"))
    results: List[Tuple[str, str]] = []

    for root in get_library_roots():
        root_real = _real_path(root, follow)
        if not os.path.isdir(root_real):
            continue
        for dirpath, dirnames, filenames in os.walk(root_real):
            depth = dirpath[len(root_real) :].count(os.sep)
            if depth >= max_depth:
                dirnames.clear()
                continue
            if not follow:
                dirnames[:] = [
                    d for d in dirnames if not os.path.islink(os.path.join(dirpath, d))
                ]
            for fn in filenames:
                if is_audio_file(fn):
                    full = os.path.join(dirpath, fn)
                    results.append((full, root_real))
    return results


def _upsert_track(conn: sqlite3.Connection, abs_path: str, root_path: str) -> bool:
    """Index one file. Returns True if inserted/updated."""
    try:
        meta = read_metadata(abs_path)
    except OSError:
        return False

    rel = os.path.relpath(abs_path, root_path)
    tid = track_id_for_path(abs_path)
    cover_hash = _cache_cover_for_file(abs_path)
    conn.execute(
        """
        INSERT INTO tracks (
            id, path, rel_path, root_path, title, artist, album, album_artist,
            genre, composer, track_number, disc_number, duration_sec, bitrate,
            codec, file_size, mtime, cover_hash, scanned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            rel_path=excluded.rel_path,
            root_path=excluded.root_path,
            title=excluded.title,
            artist=excluded.artist,
            album=excluded.album,
            album_artist=excluded.album_artist,
            genre=excluded.genre,
            composer=excluded.composer,
            track_number=excluded.track_number,
            disc_number=excluded.disc_number,
            duration_sec=excluded.duration_sec,
            bitrate=excluded.bitrate,
            codec=excluded.codec,
            file_size=excluded.file_size,
            mtime=excluded.mtime,
            cover_hash=COALESCE(excluded.cover_hash, tracks.cover_hash),
            scanned_at=excluded.scanned_at
        """,
        (
            tid,
            abs_path,
            rel,
            root_path,
            meta.get("title"),
            meta.get("artist"),
            meta.get("album"),
            meta.get("album_artist"),
            meta.get("genre"),
            meta.get("composer"),
            meta.get("track_number"),
            meta.get("disc_number"),
            meta.get("duration_sec"),
            meta.get("bitrate"),
            meta.get("codec"),
            meta.get("file_size"),
            meta.get("mtime"),
            cover_hash,
            _utc_placeholder(),
        ),
    )
    return True


def _needs_reindex(conn: sqlite3.Connection, abs_path: str, mtime: float, size: int) -> bool:
    row = conn.execute(
        "SELECT mtime, file_size FROM tracks WHERE path = ?", (abs_path,)
    ).fetchone()
    if not row:
        return True
    return float(row["mtime"]) != float(mtime) or int(row["file_size"]) != int(size)


def list_tracks(
    *,
    q: str = "",
    sort: str = "title",
    offset: int = 0,
    limit: int = 500,
) -> Dict[str, Any]:
    _init_db()
    allowed_sort = {
        "title": "COALESCE(title, '') COLLATE NOCASE",
        "artist": "COALESCE(artist, '') COLLATE NOCASE",
        "album": "COALESCE(album, '') COLLATE NOCASE",
        "mtime": "mtime DESC",
    }
    order = allowed_sort.get(sort, allowed_sort["title"])
    clauses = ["1=1"]
    params: List[Any] = []
    if q.strip():
        like = f"%{q.strip()}%"
        clauses.append(
            "(title LIKE ? OR artist LIKE ? OR album LIKE ? OR genre LIKE ? OR path LIKE ?)"
        )
        params.extend([like, like, like, like, like])

    where = " AND ".join(clauses)
    with _db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM tracks WHERE {where}", params
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM tracks WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return {
        "items": [_row_to_track(r) for r in rows],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


def list_albums(*, q: str = "") -> Dict[str, Any]:
    _init_db()
    clauses = ["album IS NOT NULL", "album != ''"]
    params: List[Any] = []
    if q.strip():
        like = f"%{q.strip()}%"
        clauses.append("(album LIKE ? OR album_artist LIKE ? OR artist LIKE ?)")
        params.extend([like, like, like])
    where = " AND ".join(clauses)
    with _db() as conn:
        rows = conn.execute(
            f"""
            SELECT
                album,
                COALESCE(album_artist, artist, '') AS album_artist,
                COUNT(*) AS track_count,
                MIN(COALESCE(artist, '')) AS artist,
                (
                    SELECT cover_hash FROM tracks t2
                    WHERE t2.album = tracks.album
                      AND COALESCE(t2.album_artist, t2.artist, '')
                          = COALESCE(tracks.album_artist, tracks.artist, '')
                      AND t2.cover_hash IS NOT NULL AND t2.cover_hash != ''
                    LIMIT 1
                ) AS cover_hash
            FROM tracks
            WHERE {where}
            GROUP BY album, COALESCE(album_artist, artist, '')
            ORDER BY album COLLATE NOCASE
            """,
            params,
        ).fetchall()
    items = []
    for r in rows:
        album = r["album"] or ""
        aa = r["album_artist"] or ""
        ch = r["cover_hash"] or ""
        items.append(
            {
                "key": _album_key(album, aa),
                "album": album,
                "album_artist": aa,
                "artist": r["artist"] or aa,
                "track_count": r["track_count"],
                "cover_hash": ch or None,
                "has_cover": bool(ch),
            }
        )
    return {"items": items, "total": len(items)}


def list_album_tracks(album_key: str) -> Dict[str, Any]:
    _init_db()
    with _db() as conn:
        rows = conn.execute("SELECT * FROM tracks WHERE album IS NOT NULL AND album != ''").fetchall()
    matched = []
    for r in rows:
        if _album_key(r["album"] or "", r["album_artist"] or r["artist"] or "") == album_key:
            matched.append(r)
    matched.sort(
        key=lambda r: (
            r["disc_number"] or 0,
            r["track_number"] or 0,
            (r["title"] or "").lower(),
        )
    )
    if not matched:
        return {"items": [], "album": None}
    first = dict(matched[0])
    return {
        "album": {
            "key": album_key,
            "album": first.get("album"),
            "album_artist": first.get("album_artist") or first.get("artist"),
        },
        "items": [_row_to_track(r) for r in matched],
    }


def list_artists(*, q: str = "") -> Dict[str, Any]:
    _init_db()
    clauses = ["artist IS NOT NULL", "artist != ''"]
    params: List[Any] = []
    if q.strip():
        clauses.append("artist LIKE ?")
        params.append(f"%{q.strip()}%")
    where = " AND ".join(clauses)
    with _db() as conn:
        rows = conn.execute(
            f"""
            SELECT artist, COUNT(*) AS track_count
            FROM tracks
            WHERE {where}
            GROUP BY artist
            ORDER BY artist COLLATE NOCASE
            """,
            params,
        ).fetchall()
    items = [{"name": r["artist"], "track_count": r["track_count"]} for r in rows]
    return {"items": items, "total": len(items)}


def list_artist_tracks(artist: str) -> Dict[str, Any]:
    _init_db()
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM tracks WHERE artist = ? ORDER BY album COLLATE NOCASE, "
            "disc_number, track_number, title COLLATE NOCASE",
            (artist,),
        ).fetchall()
    return {"artist": artist, "items": [_row_to_track(r) for r in rows]}


def list_genres(*, q: str = "") -> Dict[str, Any]:
    _init_db()
    clauses = ["genre IS NOT NULL", "genre != ''"]
    params: List[Any] = []
    if q.strip():
        clauses.append("genre LIKE ?")
        params.append(f"%{q.strip()}%")
    where = " AND ".join(clauses)
    with _db() as conn:
        rows = conn.execute(
            f"""
            SELECT genre, COUNT(*) AS track_count
            FROM tracks
            WHERE {where}
            GROUP BY genre
            ORDER BY genre COLLATE NOCASE
            """,
            params,
        ).fetchall()
    items = [{"name": r["genre"], "track_count": r["track_count"]} for r in rows]
    return {"items": items, "total": len(items)}


def list_genre_tracks(genre: str) -> Dict[str, Any]:
    _init_db()
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM tracks WHERE genre = ? ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_number",
            (genre,),
        ).fetchall()
    return {"genre": genre, "items": [_row_to_track(r) for r in rows]}


def list_top_genres(limit: int = 12) -> List[Dict[str, Any]]:
    _init_db()
    with _db() as conn:
        rows = conn.execute(
            """
            SELECT genre, COUNT(*) AS track_count
            FROM tracks
            WHERE genre IS NOT NULL AND genre != ''
            GROUP BY genre
            ORDER BY track_count DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [{"name": r["genre"], "track_count": r["track_count"]} for r in rows]


    return [{"name": r["genre"], "track_count": r["track_count"]} for r in rows]


def list_recent_tracks(*, limit: int = 100) -> Dict[str, Any]:
    _init_db()
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM tracks ORDER BY mtime DESC LIMIT ?",
            (limit,),
        ).fetchall()
    items = [_row_to_track(r) for r in rows]
    return {"items": items, "total": len(items)}


def list_random_tracks(*, limit: int = 100) -> Dict[str, Any]:
    _init_db()
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM tracks ORDER BY RANDOM() LIMIT ?",
            (limit,),
        ).fetchall()
    items = [_row_to_track(r) for r in rows]
    return {"items": items, "total": len(items)}


def _system_playlists() -> List[Dict[str, Any]]:
    _init_db()
    with _db() as conn:
        total = conn.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
    cap = min(100, total)
    return [
        {
            "id": SYSTEM_PLAYLIST_RECENT,
            "name": "Recently Added",
            "kind": "system",
            "track_count": cap,
        },
        {
            "id": SYSTEM_PLAYLIST_RANDOM,
            "name": "Random 100",
            "kind": "system",
            "track_count": cap,
        },
    ]


def list_playlists() -> Dict[str, Any]:
    _init_db()
    with _db() as conn:
        rows = conn.execute(
            """
            SELECT p.id, p.name, p.kind, p.created_at, p.updated_at,
                   (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
            FROM playlists p
            WHERE p.kind = 'user'
            ORDER BY p.name COLLATE NOCASE
            """
        ).fetchall()
    user_items = [
        {
            "id": r["id"],
            "name": r["name"],
            "kind": r["kind"],
            "track_count": r["track_count"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }
        for r in rows
    ]
    items = _system_playlists() + user_items
    return {"items": items, "total": len(items)}


def create_playlist(name: str) -> Dict[str, Any]:
    _init_db()
    pid = str(uuid.uuid4())
    now = _utc_placeholder()
    with _db() as conn:
        conn.execute(
            "INSERT INTO playlists (id, name, kind, created_at, updated_at) VALUES (?, ?, 'user', ?, ?)",
            (pid, name.strip(), now, now),
        )
    return {
        "id": pid,
        "name": name.strip(),
        "kind": "user",
        "track_count": 0,
        "created_at": now,
        "updated_at": now,
    }


def rename_playlist(playlist_id: str, name: str) -> Optional[Dict[str, Any]]:
    if playlist_id in (SYSTEM_PLAYLIST_RECENT, SYSTEM_PLAYLIST_RANDOM):
        raise ValueError("Cannot rename system playlist")
    _init_db()
    now = _utc_placeholder()
    with _db() as conn:
        cur = conn.execute(
            "UPDATE playlists SET name = ?, updated_at = ? WHERE id = ? AND kind = 'user'",
            (name.strip(), now, playlist_id),
        )
        if cur.rowcount == 0:
            return None
        row = conn.execute(
            """
            SELECT p.id, p.name, p.kind, p.created_at, p.updated_at,
                   (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
            FROM playlists p WHERE p.id = ?
            """,
            (playlist_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "kind": row["kind"],
        "track_count": row["track_count"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def delete_playlist(playlist_id: str) -> bool:
    if playlist_id in (SYSTEM_PLAYLIST_RECENT, SYSTEM_PLAYLIST_RANDOM):
        raise ValueError("Cannot delete system playlist")
    _init_db()
    with _db() as conn:
        cur = conn.execute(
            "DELETE FROM playlists WHERE id = ? AND kind = 'user'", (playlist_id,)
        )
        return cur.rowcount > 0


def get_playlist_tracks(playlist_id: str) -> Dict[str, Any]:
    if playlist_id == SYSTEM_PLAYLIST_RECENT:
        return {"playlist": _system_playlists()[0], **list_recent_tracks()}
    if playlist_id == SYSTEM_PLAYLIST_RANDOM:
        return {"playlist": _system_playlists()[1], **list_random_tracks()}
    _init_db()
    with _db() as conn:
        pl = conn.execute(
            "SELECT id, name, kind, created_at, updated_at FROM playlists WHERE id = ?",
            (playlist_id,),
        ).fetchone()
        if not pl:
            return {"playlist": None, "items": []}
        rows = conn.execute(
            """
            SELECT t.* FROM playlist_tracks pt
            JOIN tracks t ON t.id = pt.track_id
            WHERE pt.playlist_id = ?
            ORDER BY pt.position
            """,
            (playlist_id,),
        ).fetchall()
    playlist = {
        "id": pl["id"],
        "name": pl["name"],
        "kind": pl["kind"],
        "track_count": len(rows),
        "created_at": pl["created_at"],
        "updated_at": pl["updated_at"],
    }
    return {"playlist": playlist, "items": [_row_to_track(r) for r in rows]}


def add_tracks_to_playlist(playlist_id: str, track_ids: List[str]) -> Dict[str, Any]:
    if playlist_id in (SYSTEM_PLAYLIST_RECENT, SYSTEM_PLAYLIST_RANDOM):
        raise ValueError("Cannot modify system playlist")
    _init_db()
    now = _utc_placeholder()
    with _db() as conn:
        if not conn.execute(
            "SELECT 1 FROM playlists WHERE id = ? AND kind = 'user'", (playlist_id,)
        ).fetchone():
            raise ValueError("Playlist not found")
        pos_row = conn.execute(
            "SELECT COALESCE(MAX(position), -1) AS mx FROM playlist_tracks WHERE playlist_id = ?",
            (playlist_id,),
        ).fetchone()
        pos = int(pos_row["mx"]) + 1
        added = 0
        for tid in track_ids:
            if not conn.execute("SELECT 1 FROM tracks WHERE id = ?", (tid,)).fetchone():
                continue
            if conn.execute(
                "SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?",
                (playlist_id, tid),
            ).fetchone():
                continue
            conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)",
                (playlist_id, tid, pos, now),
            )
            pos += 1
            added += 1
        conn.execute(
            "UPDATE playlists SET updated_at = ? WHERE id = ?", (now, playlist_id)
        )
    return get_playlist_tracks(playlist_id) | {"added": added}


def remove_playlist_track(playlist_id: str, position: int) -> bool:
    if playlist_id in (SYSTEM_PLAYLIST_RECENT, SYSTEM_PLAYLIST_RANDOM):
        raise ValueError("Cannot modify system playlist")
    _init_db()
    with _db() as conn:
        cur = conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = ?",
            (playlist_id, position),
        )
        if cur.rowcount == 0:
            return False
        rows = conn.execute(
            "SELECT track_id, position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position",
            (playlist_id,),
        ).fetchall()
        conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
        for i, row in enumerate(rows):
            conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)",
                (playlist_id, row["track_id"], i, _utc_placeholder()),
            )
        conn.execute(
            "UPDATE playlists SET updated_at = ? WHERE id = ?",
            (_utc_placeholder(), playlist_id),
        )
        return True


def get_scan_status() -> Dict[str, Any]:
    return get_library_stats()["scan"]


def trigger_scan() -> Dict[str, Any]:
    """Start background library scan — walk roots, read tags, upsert SQLite."""
    global _scan_running
    with _scan_lock:
        if _scan_running:
            return get_scan_status()
        _scan_running = True

    def _run() -> None:
        global _scan_running
        try:
            _init_db()
            with _db() as conn:
                conn.execute(
                    "UPDATE scan_state SET status='running', progress=0, files_found=0, "
                    "files_indexed=0, last_started=?, error_message=NULL WHERE id=1",
                    (_utc_placeholder(),),
                )

            files = _iter_audio_files()
            found = len(files)
            indexed = 0
            seen_paths = set()

            with _db() as conn:
                for i, (abs_path, root_path) in enumerate(files):
                    seen_paths.add(abs_path)
                    try:
                        st = os.stat(abs_path)
                    except OSError:
                        continue
                    if _needs_reindex(conn, abs_path, st.st_mtime, st.st_size):
                        if _upsert_track(conn, abs_path, root_path):
                            indexed += 1
                    conn.commit()

                    if found and (i + 1) % 25 == 0:
                        progress = round((i + 1) / found * 100, 1)
                        conn.execute(
                            "UPDATE scan_state SET progress=?, files_found=?, files_indexed=? WHERE id=1",
                            (progress, found, indexed),
                        )
                        conn.commit()

                # Remove tracks whose files no longer exist under library roots
                existing = conn.execute("SELECT path FROM tracks").fetchall()
                for row in existing:
                    p = row["path"]
                    if p not in seen_paths or not os.path.isfile(p):
                        conn.execute("DELETE FROM tracks WHERE path = ?", (p,))

                conn.execute(
                    "UPDATE scan_state SET status='idle', progress=100, files_found=?, "
                    "files_indexed=?, last_finished=?, error_message=NULL WHERE id=1",
                    (found, indexed, _utc_placeholder()),
                )
                conn.commit()
        except Exception as exc:
            with _db() as conn:
                conn.execute(
                    "UPDATE scan_state SET status='error', error_message=?, last_finished=? WHERE id=1",
                    (str(exc), _utc_placeholder()),
                )
        finally:
            with _scan_lock:
                _scan_running = False

    threading.Thread(target=_run, daemon=True).start()
    return get_scan_status()


def ensure_startup() -> None:
    _init_db()
    _ensure_default_roots()
    settings = get_settings()
    if settings.get("scan_on_startup"):
        trigger_scan()
