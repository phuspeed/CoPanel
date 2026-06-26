"""Pydantic models for Audio Player."""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class SaveSettingsRequest(BaseModel):
    library_roots: Optional[List[str]] = None
    scan_on_startup: Optional[bool] = None
    scan_interval_hours: Optional[int] = Field(None, ge=0, le=168)
    follow_symlinks: Optional[bool] = None
    max_scan_depth: Optional[int] = Field(None, ge=1, le=32)


class CreatePlaylistRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class RenamePlaylistRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class PlaylistTracksRequest(BaseModel):
    track_ids: List[str] = Field(..., min_length=1)
