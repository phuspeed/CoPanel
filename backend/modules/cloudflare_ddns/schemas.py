"""Pydantic models for Cloudflare DDNS module."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class SaveConfigRequest(BaseModel):
    api_token: Optional[str] = None
    account_id: Optional[str] = None


class CreateRecordRequest(BaseModel):
    type: str
    name: str
    content: str
    ttl: int = 1
    proxied: bool = False
    priority: Optional[int] = None


class UpdateRecordRequest(BaseModel):
    type: Optional[str] = None
    name: Optional[str] = None
    content: Optional[str] = None
    ttl: Optional[int] = None
    proxied: Optional[bool] = None
    priority: Optional[int] = None


class CreateDdnsRequest(BaseModel):
    name: str = Field(..., min_length=1)
    zone_id: str
    zone_name: str = ""
    record_name: str
    record_type: Literal["A", "AAAA"] = "A"
    proxied: bool = False
    ttl: int = 1
    ip_source: Literal["public", "interface", "custom_url"] = "public"
    interface_name: str = ""
    custom_ip_url: str = ""
    interval_minutes: int = Field(5, ge=1, le=1440)
    enabled: bool = True


class UpdateDdnsRequest(BaseModel):
    name: Optional[str] = None
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    record_name: Optional[str] = None
    record_type: Optional[Literal["A", "AAAA"]] = None
    proxied: Optional[bool] = None
    ttl: Optional[int] = None
    ip_source: Optional[Literal["public", "interface", "custom_url"]] = None
    interface_name: Optional[str] = None
    custom_ip_url: Optional[str] = None
    interval_minutes: Optional[int] = Field(None, ge=1, le=1440)
    enabled: Optional[bool] = None


class CreateTunnelRequest(BaseModel):
    name: str = Field(..., min_length=1)


class TunnelIngressRule(BaseModel):
    hostname: str = ""
    service: str
    path: str = ""


class SaveTunnelConfigRequest(BaseModel):
    tunnel_id: str
    tunnel_name: str = ""
    ingress: List[TunnelIngressRule] = Field(default_factory=list)


class InstallTunnelRequest(BaseModel):
  tunnel_id: str
  tunnel_name: str = ""
