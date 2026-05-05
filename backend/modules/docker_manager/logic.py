import json
import os
import shutil
import subprocess
from typing import Any, Dict, List, Optional, Tuple


try:
    import docker
except ImportError:
    docker = None


MOCK_CONTAINERS = [
    {
        "id": "c1a2b3c4d5e6",
        "name": "copanel_backend",
        "image": "fastapi:latest",
        "status": "running",
        "ports": "8000/tcp",
    },
    {
        "id": "f8e7d6c5b4a3",
        "name": "copanel_frontend",
        "image": "nginx:alpine",
        "status": "running",
        "ports": "80/tcp -> 8686",
    },
]


class DockerManagerError(Exception):
    def __init__(self, message: str, code: str = "docker_error", details: Optional[str] = None):
        super().__init__(message)
        self.code = code
        self.details = details


class DockerService:
    def __init__(self, allow_mock: bool = False, command_timeout: int = 30):
        self.allow_mock = allow_mock
        self.command_timeout = command_timeout

    def _client(self):
        if docker is None:
            return None
        try:
            return docker.from_env()
        except Exception:
            return None

    def _docker_bin(self) -> str:
        return shutil.which("docker") or "/usr/bin/docker"

    def _run(self, args: List[str], cwd: Optional[str] = None, timeout: Optional[int] = None) -> subprocess.CompletedProcess:
        try:
            return subprocess.run(
                args,
                cwd=cwd,
                capture_output=True,
                text=True,
                check=False,
                timeout=timeout or self.command_timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise DockerManagerError("Docker command timed out", code="docker_timeout", details=str(exc)) from exc
        except Exception as exc:
            raise DockerManagerError("Failed to execute Docker command", code="docker_exec_failed", details=str(exc)) from exc

    def _ensure_ok(self, result: subprocess.CompletedProcess, fallback: str) -> str:
        if result.returncode != 0:
            raise DockerManagerError(fallback, code="docker_command_failed", details=result.stderr.strip() or result.stdout.strip())
        return result.stdout

    def list_containers(self) -> Tuple[List[Dict[str, Any]], bool]:
        containers: List[Dict[str, Any]] = []
        client = self._client()
        if client is not None:
            try:
                for c in client.containers.list(all=True):
                    ports = []
                    for p, mapping in (c.ports or {}).items():
                        if mapping:
                            ports.append(f"{p} -> {mapping[0].get('HostPort', '')}")
                        else:
                            ports.append(p)
                    containers.append(
                        {
                            "id": c.short_id,
                            "name": c.name,
                            "image": c.image.tags[0] if c.image.tags else c.image.short_id,
                            "status": c.status,
                            "ports": ", ".join(ports) if ports else "-",
                        }
                    )
                return containers, False
            except Exception:
                pass

        result = self._run([self._docker_bin(), "ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"])
        if result.returncode == 0 and result.stdout.strip():
            for line in result.stdout.strip().splitlines():
                parts = line.split("\t")
                if len(parts) < 4:
                    continue
                state = parts[3].lower()
                status = "running"
                if "exited" in state:
                    status = "exited"
                elif "pause" in state:
                    status = "paused"
                elif "created" in state:
                    status = "created"
                containers.append(
                    {
                        "id": parts[0],
                        "name": parts[1],
                        "image": parts[2],
                        "status": status,
                        "ports": parts[4] if len(parts) > 4 and parts[4] else "-",
                    }
                )
            return containers, False
        if result.returncode == 0:
            # Docker is reachable, but there are currently no containers.
            # Do not treat this as daemon failure.
            return [], False

        if self.allow_mock:
            return MOCK_CONTAINERS, True
        raise DockerManagerError("Docker daemon is unavailable", code="docker_unavailable", details=result.stderr.strip())

    def container_action(self, container_id: str, action: str) -> None:
        action_map = {"start": "start", "stop": "stop", "restart": "restart"}
        if action not in action_map:
            raise DockerManagerError("Unsupported action", code="invalid_action")
        client = self._client()
        if client is not None:
            try:
                container = client.containers.get(container_id)
                getattr(container, action_map[action])()
                return
            except Exception:
                pass
        result = self._run([self._docker_bin(), action, container_id])
        self._ensure_ok(result, f"Failed to {action} container.")

    def remove_container(self, container_id: str) -> None:
        client = self._client()
        if client is not None:
            try:
                container = client.containers.get(container_id)
                container.remove(force=True)
                return
            except Exception:
                pass
        result = self._run([self._docker_bin(), "rm", "-f", container_id])
        self._ensure_ok(result, "Failed to remove container.")

    def get_logs(self, container_id: str, tail: int = 100, since: Optional[str] = None, timestamps: bool = False) -> str:
        client = self._client()
        if client is not None:
            try:
                container = client.containers.get(container_id)
                kwargs: Dict[str, Any] = {"tail": tail, "timestamps": timestamps}
                if since:
                    kwargs["since"] = since
                return container.logs(**kwargs).decode("utf-8", errors="ignore")
            except Exception:
                pass
        cmd = [self._docker_bin(), "logs", "--tail", str(tail)]
        if since:
            cmd.extend(["--since", since])
        if timestamps:
            cmd.append("--timestamps")
        cmd.append(container_id)
        result = self._run(cmd)
        if result.returncode != 0 and not result.stderr:
            raise DockerManagerError("Failed to read container logs", code="docker_logs_failed")
        return result.stdout or result.stderr or "No logs recorded.\n"

    def inspect_container(self, container_id: str) -> Dict[str, Any]:
        result = self._run([self._docker_bin(), "inspect", container_id])
        out = self._ensure_ok(result, "Failed to inspect container.")
        payload = json.loads(out)
        return payload[0] if payload else {}

    def container_stats(self, container_id: str) -> Dict[str, Any]:
        result = self._run([self._docker_bin(), "stats", "--no-stream", "--format", "{{json .}}", container_id])
        out = self._ensure_ok(result, "Failed to retrieve container stats.")
        return json.loads(out.strip()) if out.strip() else {}

    def exec_command(self, container_id: str, command: List[str]) -> Dict[str, Any]:
        if not command:
            raise DockerManagerError("Exec command cannot be empty", code="invalid_request")
        result = self._run([self._docker_bin(), "exec", container_id, *command], timeout=60)
        return {
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }

    def rename_container(self, container_id: str, new_name: str) -> None:
        result = self._run([self._docker_bin(), "rename", container_id, new_name])
        self._ensure_ok(result, "Failed to rename container.")

    def prune_containers(self) -> str:
        result = self._run([self._docker_bin(), "container", "prune", "-f"])
        return self._ensure_ok(result, "Failed to prune containers.")

    def _list_simple(self, args: List[str], split_key: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        result = self._run(args)
        out = self._ensure_ok(result, "Failed to list Docker resources.")
        rows = []
        for line in out.splitlines():
            cols = line.split("\t")
            if split_key:
                row = {}
                for idx, key in enumerate(split_key):
                    row[key] = cols[idx] if idx < len(cols) else ""
                rows.append(row)
            else:
                rows.append({"value": line})
        return rows

    def list_images(self) -> List[Dict[str, Any]]:
        return self._list_simple(
            [self._docker_bin(), "images", "--format", "{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}"],
            ["repository", "tag", "id", "size"],
        )

    def inspect_image(self, image_ref: str) -> Dict[str, Any]:
        result = self._run([self._docker_bin(), "image", "inspect", image_ref])
        out = self._ensure_ok(result, "Failed to inspect image.")
        payload = json.loads(out)
        return payload[0] if payload else {}

    def pull_image(self, image_ref: str) -> str:
        result = self._run([self._docker_bin(), "pull", image_ref], timeout=300)
        return self._ensure_ok(result, "Failed to pull image.")

    def remove_image(self, image_ref: str) -> str:
        result = self._run([self._docker_bin(), "rmi", image_ref])
        return self._ensure_ok(result, "Failed to remove image.")

    def prune_images(self) -> str:
        result = self._run([self._docker_bin(), "image", "prune", "-f"])
        return self._ensure_ok(result, "Failed to prune images.")

    def list_networks(self) -> List[Dict[str, Any]]:
        return self._list_simple(
            [self._docker_bin(), "network", "ls", "--format", "{{.ID}}\t{{.Name}}\t{{.Driver}}\t{{.Scope}}"],
            ["id", "name", "driver", "scope"],
        )

    def create_network(self, name: str, driver: str = "bridge") -> str:
        result = self._run([self._docker_bin(), "network", "create", "--driver", driver, name])
        return self._ensure_ok(result, "Failed to create network.")

    def remove_network(self, name: str) -> str:
        result = self._run([self._docker_bin(), "network", "rm", name])
        return self._ensure_ok(result, "Failed to remove network.")

    def connect_network(self, name: str, container_id: str) -> str:
        result = self._run([self._docker_bin(), "network", "connect", name, container_id])
        return self._ensure_ok(result, "Failed to connect container to network.")

    def disconnect_network(self, name: str, container_id: str) -> str:
        result = self._run([self._docker_bin(), "network", "disconnect", name, container_id])
        return self._ensure_ok(result, "Failed to disconnect container from network.")

    def list_volumes(self) -> List[Dict[str, Any]]:
        return self._list_simple(
            [self._docker_bin(), "volume", "ls", "--format", "{{.Name}}\t{{.Driver}}\t{{.Mountpoint}}"],
            ["name", "driver", "mountpoint"],
        )

    def create_volume(self, name: str) -> str:
        result = self._run([self._docker_bin(), "volume", "create", name])
        return self._ensure_ok(result, "Failed to create volume.")

    def remove_volume(self, name: str) -> str:
        result = self._run([self._docker_bin(), "volume", "rm", name])
        return self._ensure_ok(result, "Failed to remove volume.")

    def prune_volumes(self) -> str:
        result = self._run([self._docker_bin(), "volume", "prune", "-f"])
        return self._ensure_ok(result, "Failed to prune volumes.")


def should_allow_mock() -> bool:
    return os.environ.get("COPANEL_DOCKER_MOCK", "0") in {"1", "true", "TRUE"}
