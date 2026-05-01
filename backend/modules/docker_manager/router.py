"""
Docker Manager Module Router
Handles listing, starting, stopping, restarting, removing containers, and fetching logs.
"""
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Try to import docker module
try:
    import docker
except ImportError:
    docker = None

router = APIRouter()

# Interactive mock state for Dev Compatibility
MOCK_CONTAINERS = [
    {
        "id": "c1a2b3c4d5e6",
        "name": "copanel_backend",
        "image": "fastapi:latest",
        "status": "running",
        "ports": "8000/tcp",
        "logs": "INFO:     Started server process [1]\nINFO:     Waiting for application startup.\nINFO:     Application startup complete.\n"
    },
    {
        "id": "f8e7d6c5b4a3",
        "name": "copanel_frontend",
        "image": "nginx:alpine",
        "status": "running",
        "ports": "80/tcp -> 8686",
        "logs": "172.17.0.1 - - [01/May/2026:12:00:00 +0000] \"GET / HTTP/1.1\" 200 612 \"-\"\n"
    },
    {
        "id": "a9b8c7d6e5f4",
        "name": "redis_cache",
        "image": "redis:6.2-alpine",
        "status": "exited",
        "ports": "6379/tcp",
        "logs": "1:C 01 May 2026 12:00:00.123 # oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo\n"
    }
]

def get_docker_client():
    """Retrieve Docker client or None if daemon not running."""
    if docker is None:
        return None
    try:
        return docker.from_env()
    except Exception:
        return None


# Schemas
class ContainerActionRequest(BaseModel):
    container_id: str


@router.get("/list")
async def list_containers() -> Dict[str, Any]:
    """List containers with their ID, Name, Image, Status, Ports."""
    global MOCK_CONTAINERS
    client = get_docker_client()
    
    if client is None:
        # Return interactive mock data for Dev Compatibility
        return {
            "status": "success",
            "containers": MOCK_CONTAINERS,
            "mock": True
        }

    try:
        containers = []
        for c in client.containers.list(all=True):
            # Parse ports info
            ports = []
            for p, mapping in c.ports.items():
                if mapping:
                    ports.append(f"{p} -> {mapping[0]['HostPort']}")
                else:
                    ports.append(p)

            containers.append({
                "id": c.short_id,
                "name": c.name,
                "image": c.image.tags[0] if c.image.tags else c.image.short_id,
                "status": c.status,
                "ports": ", ".join(ports) if ports else "—"
            })

        return {
            "status": "success",
            "containers": containers,
            "mock": False
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start")
async def start_container(req: ContainerActionRequest) -> Dict[str, Any]:
    """Start a container."""
    client = get_docker_client()
    if client is None:
        for c in MOCK_CONTAINERS:
            if c["id"] == req.container_id:
                c["status"] = "running"
                return {"status": "success", "message": "Container started successfully (Mock Mode)."}
        raise HTTPException(status_code=404, detail="Container not found in Mock Mode.")

    try:
        container = client.containers.get(req.container_id)
        container.start()
        return {"status": "success", "message": "Container started successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop")
async def stop_container(req: ContainerActionRequest) -> Dict[str, Any]:
    """Stop a container."""
    client = get_docker_client()
    if client is None:
        for c in MOCK_CONTAINERS:
            if c["id"] == req.container_id:
                c["status"] = "exited"
                return {"status": "success", "message": "Container stopped successfully (Mock Mode)."}
        raise HTTPException(status_code=404, detail="Container not found in Mock Mode.")

    try:
        container = client.containers.get(req.container_id)
        container.stop()
        return {"status": "success", "message": "Container stopped successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/restart")
async def restart_container(req: ContainerActionRequest) -> Dict[str, Any]:
    """Restart a container."""
    client = get_docker_client()
    if client is None:
        for c in MOCK_CONTAINERS:
            if c["id"] == req.container_id:
                c["status"] = "running"
                return {"status": "success", "message": "Container restarted successfully (Mock Mode)."}
        raise HTTPException(status_code=404, detail="Container not found in Mock Mode.")

    try:
        container = client.containers.get(req.container_id)
        container.restart()
        return {"status": "success", "message": "Container restarted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/remove")
async def remove_container(req: ContainerActionRequest) -> Dict[str, Any]:
    """Remove a container."""
    global MOCK_CONTAINERS
    client = get_docker_client()
    if client is None:
        original_count = len(MOCK_CONTAINERS)
        MOCK_CONTAINERS = [c for c in MOCK_CONTAINERS if c["id"] != req.container_id]
        if len(MOCK_CONTAINERS) == original_count:
            raise HTTPException(status_code=404, detail="Container not found in Mock Mode.")
        return {"status": "success", "message": "Container removed successfully (Mock Mode)."}

    try:
        container = client.containers.get(req.container_id)
        container.remove(force=True)
        return {"status": "success", "message": "Container removed successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/logs")
async def get_container_logs(container_id: str) -> Dict[str, Any]:
    """Fetch recent container logs (tail 100)."""
    client = get_docker_client()
    if client is None:
        for c in MOCK_CONTAINERS:
            if c["id"] == container_id:
                return {
                    "status": "success",
                    "logs": c.get("logs", "No logs recorded in Mock Mode.\n")
                }
        raise HTTPException(status_code=404, detail="Container not found in Mock Mode.")

    try:
        container = client.containers.get(container_id)
        logs = container.logs(tail=100).decode("utf-8", errors="ignore")
        return {
            "status": "success",
            "logs": logs
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
