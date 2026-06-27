"""Pydantic models for WebDAV / SMB module."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class SaveConfigRequest(BaseModel):
    bind_address: Optional[str] = None
    webdav_port: Optional[int] = Field(None, ge=1, le=65535)
    smb_port: Optional[int] = Field(None, ge=1, le=65535)
    share_path: Optional[str] = None
    share_name: Optional[str] = None
    webdav_enabled: Optional[bool] = None
    smb_enabled: Optional[bool] = None


class ServiceActionRequest(BaseModel):
    action: str = Field(..., pattern="^(start|stop|restart|apply)$")
