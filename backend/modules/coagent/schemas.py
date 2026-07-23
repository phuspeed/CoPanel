"""Pydantic schemas for CoAgent API."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(..., min_length=1, max_length=12000)


class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., min_length=1, max_length=40)


class ExecuteActionRequest(BaseModel):
    action_id: str = Field(..., min_length=8, max_length=128)


class CancelActionRequest(BaseModel):
    action_id: str = Field(..., min_length=8, max_length=128)


class ConfigUpdateRequest(BaseModel):
    base_url: Optional[str] = Field(None, max_length=500)
    api_key: Optional[str] = Field(None, max_length=500)
    model: Optional[str] = Field(None, max_length=200)
    enabled: Optional[bool] = None
    max_tool_rounds: Optional[int] = Field(None, ge=1, le=12)
