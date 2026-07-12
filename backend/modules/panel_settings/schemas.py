"""Panel settings API models."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class SshPortRequest(BaseModel):
    port: int = Field(..., ge=1, le=65535)
    confirm: bool = False


class RootPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=8)
    confirm_password: str = Field(..., min_length=8)


class NginxGateRequest(BaseModel):
    enabled: bool
    username: Optional[str] = None
    password: Optional[str] = None


class BrandingSettingsRequest(BaseModel):
    site_title: str = Field(..., min_length=1, max_length=80)
    site_subtitle: Optional[str] = Field(None, max_length=120)
    favicon_data_url: Optional[str] = None
    logo_data_url: Optional[str] = None


class TotpVerifyRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=8)


class TotpDisableRequest(BaseModel):
    password: str
    code: str = Field(..., min_length=6, max_length=8)


class NetworkConfigRequest(BaseModel):
    method: Literal["dhcp", "static"]
    address: Optional[str] = None
    prefix: Optional[int] = Field(None, ge=1, le=32)
    gateway: Optional[str] = None
    dns: Optional[List[str]] = None
    confirm: bool = False


class DateTimeTimezoneRequest(BaseModel):
    timezone: str = Field(..., min_length=1, max_length=64)


class DateTimeManualRequest(BaseModel):
    datetime: str = Field(..., min_length=10, max_length=40)
    confirm: bool = False


class DateTimeNtpRequest(BaseModel):
    enabled: bool
    use_google: bool = True
