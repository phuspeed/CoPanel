"""
System Monitor Module Router
Provides FastAPI endpoints for system monitoring, processes, and PM2 management.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.audit import record_audit
from core.auth import require_admin, require_module

from .logic import SystemMonitor

router = APIRouter()


class ProcessSignalBody(BaseModel):
    signal: str = Field(..., pattern="^(term|kill)$")


@router.get("/stats")
async def get_all_stats(_user: Dict[str, Any] = Depends(require_module("system_monitor"))) -> Dict[str, Any]:
    """Get all system statistics."""
    try:
        stats = SystemMonitor.get_all_stats()
        return {"status": "success", "data": stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cpu")
async def get_cpu(_user: Dict[str, Any] = Depends(require_module("system_monitor"))) -> Dict[str, Any]:
    """Get CPU statistics."""
    try:
        cpu = SystemMonitor.get_cpu_usage()
        if "error" in cpu:
            raise HTTPException(status_code=500, detail=cpu["error"])
        return {"status": "success", "data": cpu}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/memory")
async def get_memory(_user: Dict[str, Any] = Depends(require_module("system_monitor"))) -> Dict[str, Any]:
    """Get memory statistics."""
    try:
        memory = SystemMonitor.get_memory_usage()
        if "error" in memory:
            raise HTTPException(status_code=500, detail=memory["error"])
        return {"status": "success", "data": memory}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/disk")
async def get_disk(_user: Dict[str, Any] = Depends(require_module("system_monitor"))) -> Dict[str, Any]:
    """Get disk statistics."""
    try:
        disk = SystemMonitor.get_disk_usage()
        if "error" in disk:
            raise HTTPException(status_code=500, detail=disk["error"])
        return {"status": "success", "data": disk}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/network")
async def get_network(_user: Dict[str, Any] = Depends(require_module("system_monitor"))) -> Dict[str, Any]:
    """Get network statistics."""
    try:
        network = SystemMonitor.get_network_stats()
        if "error" in network:
            raise HTTPException(status_code=500, detail=network["error"])
        return {"status": "success", "data": network}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/system")
async def get_system(_user: Dict[str, Any] = Depends(require_module("system_monitor"))) -> Dict[str, Any]:
    """Get system information."""
    try:
        system = SystemMonitor.get_system_info()
        if "error" in system:
            raise HTTPException(status_code=500, detail=system["error"])
        return {"status": "success", "data": system}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/processes")
async def get_top_processes(_user: Dict[str, Any] = Depends(require_module("system_monitor"))) -> Dict[str, Any]:
    """Get top CPU/Memory processes."""
    try:
        procs = SystemMonitor.get_top_processes()
        return {"status": "success", "data": procs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/process/{pid}")
async def get_process_detail(
    pid: int,
    _user: Dict[str, Any] = Depends(require_module("system_monitor")),
) -> Dict[str, Any]:
    """Detailed snapshot for one process (drill-down)."""
    detail = SystemMonitor.get_process_detail(pid)
    if detail is None:
        raise HTTPException(status_code=404, detail="Process not found or access denied.")
    return {"status": "success", "data": detail}


@router.post("/process/{pid}/signal")
async def signal_process(
    pid: int,
    body: ProcessSignalBody,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    """
    Send SIGTERM (term) or SIGKILL (kill) to a process. Superadmin only.
    """
    ok, code = SystemMonitor.send_process_signal(pid, body.signal)
    if not ok:
        if code == "protected_pid":
            raise HTTPException(status_code=400, detail="This PID is protected (panel or init).")
        if code == "no_such_process":
            raise HTTPException(status_code=404, detail="Process no longer exists.")
        if code == "permission_denied":
            raise HTTPException(status_code=403, detail="Permission denied for this process.")
        raise HTTPException(status_code=400, detail=f"Could not send signal: {code}")

    sig_label = "SIGTERM" if body.signal == "term" else "SIGKILL"
    record_audit(
        "process.signal",
        module="system_monitor",
        target=f"pid:{pid}",
        actor=user.get("username"),
        actor_id=user.get("id"),
        meta={"signal": body.signal, "label": sig_label},
    )
    return {
        "status": "success",
        "message": f"Sent {sig_label} to PID {pid}",
    }


@router.get("/pm2")
async def get_pm2_processes(_user: Dict[str, Any] = Depends(require_module("system_monitor"))) -> Dict[str, Any]:
    """Get PM2 processes details."""
    try:
        pm2_procs = SystemMonitor.get_pm2_processes()
        return {"status": "success", "data": pm2_procs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pm2/{action}/{name_or_id}")
async def action_pm2_process(
    action: str,
    name_or_id: str,
    _user: Dict[str, Any] = Depends(require_module("system_monitor")),
) -> Dict[str, Any]:
    """Action for a PM2 process (restart, stop, delete, start)."""
    try:
        ok = SystemMonitor.manage_pm2(action, name_or_id)
        if not ok:
            raise HTTPException(status_code=400, detail="Failed to run action or PM2 is not installed.")
        return {"status": "success", "message": f"Successfully performed {action} on {name_or_id}"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
