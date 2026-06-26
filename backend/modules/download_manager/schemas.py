"""Pydantic models for Download Manager."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


SourceType = Literal[
    "direct",
    "google_drive",
    "google_drive_folder",
    "file_hosting",
    "torrent",
]

TaskStatus = Literal[
    "queued",
    "connecting",
    "downloading",
    "paused",
    "completed",
    "error",
    "stopped",
]

HostingType = Literal["curl", "api"]


class ApiResolveConfig(BaseModel):
    """User-defined API resolver for file hosting sites."""

    resolve_url: str = Field(..., min_length=1)
    method: Literal["GET", "POST"] = "POST"
    headers: Dict[str, str] = Field(default_factory=dict)
    body_template: str = ""
    download_url_field: str = "direct_link"
    filename_field: str = ""


class SaveSettingsRequest(BaseModel):
    temp_folder: Optional[str] = None
    destination_folder: Optional[str] = None
    max_concurrent: Optional[int] = Field(None, ge=1, le=20)
    max_download_speed_kbps: Optional[int] = Field(None, ge=0)
    max_upload_speed_kbps: Optional[int] = Field(None, ge=0)
    watched_folder: Optional[str] = None
    watched_auto_delete: Optional[bool] = None
    google_api_key: Optional[str] = None
    google_service_account_json: Optional[str] = None
    aria2_rpc_host: Optional[str] = None
    aria2_rpc_port: Optional[int] = Field(None, ge=1, le=65535)
    aria2_rpc_secret: Optional[str] = None


class GoogleOAuthStartRequest(BaseModel):
    client_id: str = Field(..., min_length=1)
    client_secret: str = Field(..., min_length=1)
    redirect_uri: str = Field(..., min_length=1)
    account_name: str = "default"


class CreateTaskRequest(BaseModel):
    url: str = Field(..., min_length=1)
    destination: Optional[str] = None
    file_hosting_id: Optional[str] = None
    account_id: Optional[str] = None
    filename: Optional[str] = None


class CreateHostingProfileRequest(BaseModel):
    name: str = Field(..., min_length=1)
    type: HostingType = "curl"
    url_patterns: List[str] = Field(default_factory=list)
    enabled: bool = True
    curl_template: str = ""
    api_config: Optional[ApiResolveConfig] = None


class UpdateHostingProfileRequest(BaseModel):
    name: Optional[str] = None
    type: Optional[HostingType] = None
    url_patterns: Optional[List[str]] = None
    enabled: Optional[bool] = None
    curl_template: Optional[str] = None
    api_config: Optional[ApiResolveConfig] = None


class CreateHostingAccountRequest(BaseModel):
    label: str = Field(..., min_length=1)
    username: str = ""
    password: str = ""
    api_key: str = ""
    cookie: str = ""
    extra: Dict[str, Any] = Field(default_factory=dict)
    is_default: bool = False


class UpdateHostingAccountRequest(BaseModel):
    label: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    api_key: Optional[str] = None
    cookie: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None
    is_default: Optional[bool] = None


class DetectUrlRequest(BaseModel):
    url: str = Field(..., min_length=1)


class BrowseFolderRequest(BaseModel):
    path: str = ""
