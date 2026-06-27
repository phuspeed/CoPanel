"""Panel settings API models."""
from __future__ import annotations

from typing import Optional

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


class TotpVerifyRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=8)


class TotpDisableRequest(BaseModel):
    password: str
    code: str = Field(..., min_length=6, max_length=8)
