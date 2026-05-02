"""
Docker Manager Module Router
Handles listing, starting, stopping, restarting, removing containers, and fetching logs.
"""
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import subprocess
import shutil
import os

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
    containers = []

    # 1. Try using Python Docker SDK first
    client = get_docker_client()
    if client is not None:
        try:
            for c in client.containers.list(all=True):
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
            
            if containers:
                return {
                    "status": "success",
                    "containers": containers,
                    "mock": False
                }
        except Exception:
            pass

    # 2. Fallback to direct shell command for 100% reliability!
    docker_path = shutil.which("docker") or "/usr/bin/docker"
    try:
        res = subprocess.run([docker_path, "ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"], capture_output=True, text=True, check=False)
        if res.returncode == 0 and res.stdout.strip():
            lines = res.stdout.strip().split("\n")
            for line in lines:
                parts = line.split("\t")
                if len(parts) >= 4:
                    cid = parts[0]
                    name = parts[1]
                    image = parts[2]
                    status = parts[3].lower()

                    # simple status parsing
                    simple_status = "running"
                    if "exited" in status or "exit" in status:
                        simple_status = "exited"
                    elif "pause" in status:
                        simple_status = "paused"
                    elif "created" in status:
                        simple_status = "created"

                    ports_mapping = parts[4] if len(parts) > 4 and parts[4] else "—"

                    containers.append({
                        "id": cid,
                        "name": name,
                        "image": image,
                        "status": simple_status,
                        "ports": ports_mapping
                    })
            if containers:
                return {
                    "status": "success",
                    "containers": containers,
                    "mock": False
                }
    except Exception:
        pass

    # Last resort: Return interactive mock data for Dev Compatibility
    return {
        "status": "success",
        "containers": MOCK_CONTAINERS,
        "mock": True
    }


@router.post("/start")
async def start_container(req: ContainerActionRequest) -> Dict[str, Any]:
    """Start a container."""
    client = get_docker_client()
    if client is not None:
        try:
            container = client.containers.get(req.container_id)
            container.start()
            return {"status": "success", "message": "Container started successfully."}
        except Exception:
            pass

    docker_path = shutil.which("docker") or "/usr/bin/docker"
    try:
        res = subprocess.run([docker_path, "start", req.container_id], capture_output=True, text=True, check=False)
        if res.returncode == 0:
            return {"status": "success", "message": "Container started successfully."}
        raise HTTPException(status_code=400, detail=res.stderr or "Failed to start container.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop")
async def stop_container(req: ContainerActionRequest) -> Dict[str, Any]:
    """Stop a container."""
    client = get_docker_client()
    if client is not None:
        try:
            container = client.containers.get(req.container_id)
            container.stop()
            return {"status": "success", "message": "Container stopped successfully."}
        except Exception:
            pass

    docker_path = shutil.which("docker") or "/usr/bin/docker"
    try:
        res = subprocess.run([docker_path, "stop", req.container_id], capture_output=True, text=True, check=False)
        if res.returncode == 0:
            return {"status": "success", "message": "Container stopped successfully."}
        raise HTTPException(status_code=400, detail=res.stderr or "Failed to stop container.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/restart")
async def restart_container(req: ContainerActionRequest) -> Dict[str, Any]:
    """Restart a container."""
    client = get_docker_client()
    if client is not None:
        try:
            container = client.containers.get(req.container_id)
            container.restart()
            return {"status": "success", "message": "Container restarted successfully."}
        except Exception:
            pass

    docker_path = shutil.which("docker") or "/usr/bin/docker"
    try:
        res = subprocess.run([docker_path, "restart", req.container_id], capture_output=True, text=True, check=False)
        if res.returncode == 0:
            return {"status": "success", "message": "Container restarted successfully."}
        raise HTTPException(status_code=400, detail=res.stderr or "Failed to restart container.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/remove")
async def remove_container(req: ContainerActionRequest) -> Dict[str, Any]:
    """Remove a container."""
    client = get_docker_client()
    if client is not None:
        try:
            container = client.containers.get(req.container_id)
            container.remove(force=True)
            return {"status": "success", "message": "Container removed successfully."}
        except Exception:
            pass

    docker_path = shutil.which("docker") or "/usr/bin/docker"
    try:
        res = subprocess.run([docker_path, "rm", "-f", req.container_id], capture_output=True, text=True, check=False)
        if res.returncode == 0:
            return {"status": "success", "message": "Container removed successfully."}
        raise HTTPException(status_code=400, detail=res.stderr or "Failed to remove container.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/logs")
async def get_container_logs(container_id: str) -> Dict[str, Any]:
    """Fetch recent container logs (tail 100)."""
    client = get_docker_client()
    if client is not None:
        try:
            container = client.containers.get(container_id)
            logs = container.logs(tail=100).decode("utf-8", errors="ignore")
            return {
                "status": "success",
                "logs": logs
            }
        except Exception:
            pass

    docker_path = shutil.which("docker") or "/usr/bin/docker"
    try:
        res = subprocess.run([docker_path, "logs", "--tail", "100", container_id], capture_output=True, text=True, check=False)
        # Some containers have stderr logs only, which is fine!
        logs_out = res.stdout or res.stderr
        return {
            "status": "success",
            "logs": logs_out or "No logs recorded.\n"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/scan-compose")
async def scan_compose_files() -> Dict[str, Any]:
    """Scan directories for any docker-compose.yml files to suggest deployment."""
    IS_WINDOWS = os.name == 'nt'
    scan_paths = []
    if IS_WINDOWS:
        scan_paths = [Path("./test_docker"), Path("./test_nginx"), Path("./")]
    else:
        scan_paths = [Path("/home"), Path("/var/www"), Path("/opt/copanel")]

    compose_files = []
    # Search up to 3 directory levels deep to avoid scanning the entire filesystem
    for base_path in scan_paths:
        from pathlib import Path
        if base_path.exists() and base_path.is_dir():
            try:
                for root, dirs, files in os.walk(str(base_path)):
                    # Limit depth
                    depth = root.replace(str(base_path), "").count(os.sep)
                    if depth > 3:
                        dirs[:] = []  # Do not go deeper
                        continue

                    for file in files:
                        if file in ["docker-compose.yml", "docker-compose.yaml", "docker-composer.yml"]:
                            compose_files.append({
                                "path": root,
                                "filename": file,
                                "full_path": os.path.join(root, file)
                            })
            except Exception:
                continue

    return {
        "status": "success",
        "compose_files": compose_files
    }


class ComposeActionRequest(BaseModel):
    path: str


@router.post("/up-compose")
async def build_compose_stack(req: ComposeActionRequest) -> Dict[str, Any]:
    """Build and start the compose stack in the directory."""
    if not os.path.isdir(req.path):
        raise HTTPException(status_code=400, detail=f"The path '{req.path}' does not exist.")

    try:
        # Check command availability and expand PATH
        env = os.environ.copy()
        extra_paths = ["/usr/bin", "/usr/local/bin", "/snap/bin"]
        path_str = env.get("PATH", "")
        for p in extra_paths:
            if p not in path_str:
                path_str = f"{p}:{path_str}" if path_str else p
        env["PATH"] = path_str

        cmd = "docker compose"
        # Check absolute paths explicitly
        for possible_docker in ["/usr/bin/docker", "/usr/local/bin/docker", "/snap/bin/docker"]:
            if os.path.exists(possible_docker) and os.access(possible_docker, os.X_OK):
                cmd = f"{possible_docker} compose"
                break
        else:
            if shutil.which("docker", path=path_str):
                cmd = "docker compose"

        # Check for docker-compose standalone
        for possible_dc in ["/usr/bin/docker-compose", "/usr/local/bin/docker-compose", "/snap/bin/docker-compose"]:
            if os.path.exists(possible_dc) and os.access(possible_dc, os.X_OK):
                cmd = possible_dc
                break
            elif shutil.which("docker-compose", path=path_str):
                cmd = "docker-compose"

        # Execute docker-compose up -d
        res = subprocess.run(
            f"{cmd} up -d",
            shell=True,
            cwd=req.path,
            capture_output=True,
            text=True,
            env=env
        )

        if res.returncode != 0:
            return {
                "status": "error",
                "message": res.stderr or "Failed to bring up docker compose stack."
            }

        return {
            "status": "success",
            "message": "Docker Compose stack brought up successfully.",
            "output": res.stdout
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
