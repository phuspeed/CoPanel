"""Audio Station API."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import FileResponse

from core.api import ApiError, ok
from core.audit import record_audit
from core.auth import require_module
from core.security import verify_token

from . import logic
from .schemas import (
    CreatePlaylistRequest,
    PlaylistTracksRequest,
    RenamePlaylistRequest,
    SaveSettingsRequest,
)

router = APIRouter()


def _auth_user(
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """Accept Bearer header or ?token= for HTML5 audio Range requests."""
    from core import user_model

    raw = None
    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            raw = parts[1]
    if not raw and token:
        raw = token
    if not raw:
        raise ApiError("UNAUTHORIZED", "Authentication required", http_status=401)
    payload = verify_token(raw)
    if not payload or "sub" not in payload:
        raise ApiError("UNAUTHORIZED", "Invalid token", http_status=401)
    user = user_model.get_user_by_username(payload["sub"])
    if not user:
        raise ApiError("UNAUTHORIZED", "User not found", http_status=401)
    return user


@router.on_event("startup")
async def on_startup() -> None:
    logic.ensure_startup()


@router.get("/settings")
def get_settings(
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.get_settings())


@router.put("/settings")
def save_settings(
    req: SaveSettingsRequest,
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    try:
        saved = logic.save_settings(req.model_dump(exclude_none=True))
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    record_audit("audio.settings", module="audio_station", actor=user.get("username"))
    return ok(saved)


@router.get("/folders/browse")
def browse_folders_picker(
    path: str = Query(""),
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.browse_folders_picker(path))


@router.get("/browse")
def browse_library(
    path: str = Query(""),
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    try:
        return ok(logic.browse_library(path))
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)


@router.get("/library/stats")
def library_stats(
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.get_library_stats())


@router.get("/library/tracks")
def library_tracks(
    q: str = Query(""),
    sort: str = Query("title"),
    offset: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.list_tracks(q=q, sort=sort, offset=offset, limit=limit))


@router.get("/library/albums")
def library_albums(
    q: str = Query(""),
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.list_albums(q=q))


@router.get("/library/albums/{album_key}/tracks")
def album_tracks(
    album_key: str,
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.list_album_tracks(album_key))


@router.get("/library/artists")
def library_artists(
    q: str = Query(""),
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.list_artists(q=q))


@router.get("/library/artists/{name}/tracks")
def artist_tracks(
    name: str,
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.list_artist_tracks(name))


@router.get("/library/genres")
def library_genres(
    q: str = Query(""),
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.list_genres(q=q))


@router.get("/library/genres/{name}/tracks")
def genre_tracks(
    name: str,
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.list_genre_tracks(name))


@router.get("/library/top-genres")
def top_genres(
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.list_top_genres())


@router.get("/library/recent")
def library_recent(
    limit: int = Query(100, ge=1, le=500),
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.list_recent_tracks(limit=limit))


@router.get("/library/random")
def library_random(
    limit: int = Query(100, ge=1, le=500),
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.list_random_tracks(limit=limit))


@router.get("/playlists")
def playlists(
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.list_playlists())


@router.post("/playlists")
def create_playlist(
    req: CreatePlaylistRequest,
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    pl = logic.create_playlist(req.name)
    record_audit("audio.playlist.create", module="audio_station", target=pl["id"], actor=user.get("username"))
    return ok(pl)


@router.put("/playlists/{playlist_id}")
def rename_playlist(
    playlist_id: str,
    req: RenamePlaylistRequest,
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    try:
        pl = logic.rename_playlist(playlist_id, req.name)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    if not pl:
        raise ApiError("NOT_FOUND", "Playlist not found", http_status=404)
    return ok(pl)


@router.delete("/playlists/{playlist_id}")
def delete_playlist(
    playlist_id: str,
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    try:
        deleted = logic.delete_playlist(playlist_id)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    if not deleted:
        raise ApiError("NOT_FOUND", "Playlist not found", http_status=404)
    record_audit("audio.playlist.delete", module="audio_station", target=playlist_id, actor=user.get("username"))
    return ok({"deleted": True})


@router.get("/playlists/{playlist_id}/tracks")
def playlist_tracks(
    playlist_id: str,
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    data = logic.get_playlist_tracks(playlist_id)
    if data.get("playlist") is None:
        raise ApiError("NOT_FOUND", "Playlist not found", http_status=404)
    return ok(data)


@router.post("/playlists/{playlist_id}/tracks")
def add_playlist_tracks(
    playlist_id: str,
    req: PlaylistTracksRequest,
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    try:
        data = logic.add_tracks_to_playlist(playlist_id, req.track_ids)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    return ok(data)


@router.delete("/playlists/{playlist_id}/tracks/{position}")
def remove_playlist_track(
    playlist_id: str,
    position: int,
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    try:
        removed = logic.remove_playlist_track(playlist_id, position)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    if not removed:
        raise ApiError("NOT_FOUND", "Track not found in playlist", http_status=404)
    return ok({"removed": True})


@router.post("/library/scan")
def start_scan(
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    status = logic.trigger_scan()
    record_audit("audio.scan", module="audio_station", actor=user.get("username"))
    return ok(status)


@router.get("/library/scan/status")
def scan_status(
    user: Dict[str, Any] = Depends(require_module("audio_station")),
) -> Dict[str, Any]:
    return ok(logic.get_scan_status())


@router.get("/cover")
async def cover_art(
    path: str = Query(""),
    id: str = Query(""),
    hash: str = Query(""),
    user: Dict[str, Any] = Depends(_auth_user),
) -> FileResponse:
    try:
        target, media_type = logic.get_cover_info(path=path, track_id=id, cover_hash=hash)
    except ValueError as exc:
        raise ApiError("NOT_FOUND", str(exc), http_status=404)
    return FileResponse(path=target, media_type=media_type)


@router.get("/stream")
async def stream_audio(
    path: str = Query(..., min_length=1),
    user: Dict[str, Any] = Depends(_auth_user),
) -> FileResponse:
    try:
        target, media_type = logic.get_stream_info(path)
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    return FileResponse(
        path=target,
        media_type=media_type,
        filename=os.path.basename(target),
    )
