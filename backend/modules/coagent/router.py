"""CoAgent FastAPI router — mounted at /api/coagent."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends

from core.api import ApiError, ok
from core.audit import record_audit
from core.auth import require_admin, require_module

from . import pending_actions
from .agent import AgentError, execute_pending_action, run_chat
from .config_store import load_config, public_config, save_config
from .schemas import (
    CancelActionRequest,
    ChatRequest,
    ConfigUpdateRequest,
    ExecuteActionRequest,
)
from .tools import list_tools_public

router = APIRouter()


def _agent_http(exc: AgentError) -> None:
    status = 400
    if exc.code in ("COAGENT_NOT_CONFIGURED", "COAGENT_DISABLED", "OPENAI_SDK_MISSING"):
        status = 400
    elif exc.code == "LLM_ERROR":
        status = 502
    elif exc.code == "ACTION_NOT_FOUND":
        status = 404
    raise ApiError(exc.code, exc.message, http_status=status)


@router.post("/chat")
async def chat(
    body: ChatRequest,
    user: Dict[str, Any] = Depends(require_module("coagent")),
) -> Dict[str, Any]:
    try:
        result = run_chat(
            [m.model_dump() for m in body.messages],
            username=user.get("username"),
        )
        return ok(result)
    except AgentError as exc:
        _agent_http(exc)
    except Exception as exc:
        raise ApiError("COAGENT_CHAT_FAILED", str(exc), http_status=500) from exc


@router.post("/execute-action")
async def execute_action(
    body: ExecuteActionRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = execute_pending_action(body.action_id)
        record_audit(
            "coagent.execute_action",
            module="coagent",
            actor=user.get("username"),
            target=result.get("tool"),
            meta={
                "action_id": body.action_id,
                "tool": result.get("tool"),
                "args": result.get("args"),
                "ok": bool((result.get("result") or {}).get("ok")),
            },
        )
        return ok(result)
    except AgentError as exc:
        _agent_http(exc)
    except Exception as exc:
        raise ApiError("COAGENT_EXECUTE_FAILED", str(exc), http_status=500) from exc


@router.post("/cancel-action")
async def cancel_action(
    body: CancelActionRequest,
    user: Dict[str, Any] = Depends(require_module("coagent")),
) -> Dict[str, Any]:
    removed = pending_actions.cancel_pending(body.action_id)
    if not removed:
        raise ApiError(
            "ACTION_NOT_FOUND",
            "Action không tồn tại hoặc đã hết hạn.",
            http_status=404,
        )
    record_audit(
        "coagent.cancel_action",
        module="coagent",
        actor=user.get("username"),
        meta={"action_id": body.action_id},
    )
    return ok({"cancelled": True, "action_id": body.action_id})


@router.get("/config")
async def get_config(
    _user: Dict[str, Any] = Depends(require_module("coagent")),
) -> Dict[str, Any]:
    return ok(public_config(load_config()))


@router.post("/config")
async def update_config(
    body: ConfigUpdateRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    updates = body.model_dump(exclude_unset=True)
    cfg = save_config(updates)
    record_audit(
        "coagent.update_config",
        module="coagent",
        actor=user.get("username"),
        meta={
            "base_url": cfg.get("base_url"),
            "model": cfg.get("model"),
            "enabled": cfg.get("enabled"),
            "api_key_changed": "api_key" in updates and bool(updates.get("api_key")),
        },
    )
    return ok(public_config(cfg), message="CoAgent settings saved.")


@router.get("/tools")
async def get_tools(
    _user: Dict[str, Any] = Depends(require_module("coagent")),
) -> Dict[str, Any]:
    return ok(list_tools_public())
