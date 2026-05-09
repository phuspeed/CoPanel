"""
Terminal Management Router
FastAPI WebSocket endpoint for a fully interactive Linux terminal via a pty shell.
REST endpoints for saved command snippets (JSON per user).
"""
import os
import asyncio
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from core.api import ApiError, ok
from core.auth import require_module

from . import logic

router = APIRouter()


class SnippetItem(BaseModel):
    id: str = Field(default="", max_length=128)
    title: str = Field(..., min_length=1, max_length=200)
    command: str = Field(..., min_length=1, max_length=8000)


class SaveSnippetsRequest(BaseModel):
    snippets: List[SnippetItem] = Field(default_factory=list)


@router.get("/snippets")
def get_snippets(user: Dict[str, Any] = Depends(require_module("terminal"))) -> Dict[str, Any]:
    return ok(logic.list_snippets(int(user["id"])))


@router.put("/snippets")
def put_snippets(
    req: SaveSnippetsRequest,
    user: Dict[str, Any] = Depends(require_module("terminal")),
) -> Dict[str, Any]:
    try:
        payload = logic.save_snippets(
            int(user["id"]),
            [s.model_dump() for s in req.snippets],
        )
    except ValueError as exc:
        raise ApiError("VALIDATION_ERROR", str(exc), http_status=400)
    return ok(payload)

IS_WINDOWS = os.name == 'nt'

@router.get("/status")
def get_status() -> Dict[str, Any]:
    """Returns terminal capability status."""
    return {
        "status": "success",
        "is_windows": IS_WINDOWS,
        "is_linux": not IS_WINDOWS
    }

@router.websocket("/ws")
async def terminal_websocket(websocket: WebSocket):
    await websocket.accept()

    if IS_WINDOWS:
        # Development fallback mode
        await websocket.send_text("Terminal mock fallback mode on Windows.\r\nType 'exit' to disconnect.\r\n> ")
        try:
            while True:
                data = await websocket.receive_text()
                if data.strip() == "exit":
                    await websocket.send_text("Exiting mock session.\r\n")
                    break
                await websocket.send_text(f"Echo from Windows mock: {data}\r\n> ")
        except WebSocketDisconnect:
            pass
        return

    # Real Linux PTY Implementation
    import pty
    import fcntl
    import subprocess

    master_fd, slave_fd = pty.openpty()
    
    # Use bash as the default shell
    p = subprocess.Popen(
        ["/bin/bash"],
        preexec_fn=os.setsid,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        universal_newlines=True,
        bufsize=0
    )
    
    os.close(slave_fd)

    # Configure non-blocking read on master_fd
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    async def read_pty():
        try:
            while True:
                await asyncio.sleep(0.01)
                try:
                    data = os.read(master_fd, 4096)
                    if data:
                        await websocket.send_text(data.decode("utf-8", errors="ignore"))
                except BlockingIOError:
                    continue
                except Exception:
                    break
        except Exception:
            pass

    async def write_pty():
        try:
            while True:
                data = await websocket.receive_text()
                os.write(master_fd, data.encode("utf-8"))
        except WebSocketDisconnect:
            pass

    task_read = asyncio.create_task(read_pty())
    task_write = asyncio.create_task(write_pty())

    try:
        await asyncio.gather(task_read, task_write)
    except Exception:
        pass
    finally:
        task_read.cancel()
        task_write.cancel()
        try:
            p.terminate()
            os.close(master_fd)
        except Exception:
            pass
