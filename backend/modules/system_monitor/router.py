"""
System Monitor Module Router
Provides FastAPI endpoints for system monitoring
"""
from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from .logic import SystemMonitor

router = APIRouter()

@router.get("/stats")
async def get_all_stats() -> Dict[str, Any]:
    """Get all system statistics."""
    try:
        stats = SystemMonitor.get_all_stats()
        return {"status": "success", "data": stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/cpu")
async def get_cpu() -> Dict[str, Any]:
    """Get CPU statistics."""
    try:
        cpu = SystemMonitor.get_cpu_usage()
        if "error" in cpu:
            raise HTTPException(status_code=500, detail=cpu["error"])
        return {"status": "success", "data": cpu}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/memory")
async def get_memory() -> Dict[str, Any]:
    """Get memory statistics."""
    try:
        memory = SystemMonitor.get_memory_usage()
        if "error" in memory:
            raise HTTPException(status_code=500, detail=memory["error"])
        return {"status": "success", "data": memory}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/disk")
async def get_disk() -> Dict[str, Any]:
    """Get disk statistics."""
    try:
        disk = SystemMonitor.get_disk_usage()
        if "error" in disk:
            raise HTTPException(status_code=500, detail=disk["error"])
        return {"status": "success", "data": disk}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/network")
async def get_network() -> Dict[str, Any]:
    """Get network statistics."""
    try:
        network = SystemMonitor.get_network_stats()
        if "error" in network:
            raise HTTPException(status_code=500, detail=network["error"])
        return {"status": "success", "data": network}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/system")
async def get_system() -> Dict[str, Any]:
    """Get system information."""
    try:
        system = SystemMonitor.get_system_info()
        if "error" in system:
            raise HTTPException(status_code=500, detail=system["error"])
        return {"status": "success", "data": system}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
