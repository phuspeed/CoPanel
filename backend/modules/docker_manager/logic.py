import json
import os
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
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
        "project": "copanel",
    },
    {
        "id": "f8e7d6c5b4a3",
        "name": "copanel_frontend",
        "image": "nginx:alpine",
        "status": "running",
        "ports": "80/tcp -> 8686",
        "project": "copanel",
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
                            "project": (c.labels or {}).get("com.docker.compose.project", ""),
                        }
                    )
                return containers, False
            except Exception:
                pass

        result = self._run(
            [
                self._docker_bin(),
                "ps",
                "-a",
                "--format",
                '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Label "com.docker.compose.project"}}',
            ]
        )
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
                        "project": parts[5] if len(parts) > 5 else "",
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

    RESTART_POLICIES = {"no", "on-failure", "always", "unless-stopped"}

    def update_restart_policy(
        self,
        container_id: str,
        policy: str,
        maximum_retry_count: int = 0,
    ) -> Dict[str, Any]:
        """Update container restart policy via ``docker update --restart``."""
        name = (policy or "").strip().lower()
        if name not in self.RESTART_POLICIES:
            raise DockerManagerError(
                f"Invalid restart policy '{policy}'. Allowed: {', '.join(sorted(self.RESTART_POLICIES))}",
                code="invalid_restart_policy",
            )
        if name == "on-failure" and maximum_retry_count > 0:
            restart_arg = f"on-failure:{int(maximum_retry_count)}"
        else:
            restart_arg = name

        client = self._client()
        if client is not None:
            try:
                container = client.containers.get(container_id)
                kwargs: Dict[str, Any] = {"Name": name}
                if name == "on-failure" and maximum_retry_count > 0:
                    kwargs["MaximumRetryCount"] = int(maximum_retry_count)
                container.update(restart_policy=kwargs)
                return {"container_id": container_id, "restart_policy": name, "maximum_retry_count": maximum_retry_count}
            except Exception:
                pass

        result = self._run([self._docker_bin(), "update", "--restart", restart_arg, container_id])
        self._ensure_ok(result, "Failed to update restart policy.")
        return {"container_id": container_id, "restart_policy": name, "maximum_retry_count": maximum_retry_count}

    @staticmethod
    def _normalize_stats_row(raw: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize `docker stats --format json` into stable UI fields."""
        cpu = raw.get("CPUPerc") or raw.get("cpu_percent") or "0%"
        mem_usage = raw.get("MemUsage") or raw.get("mem_usage") or "-"
        mem_perc = raw.get("MemPerc") or raw.get("mem_percent") or "0%"
        net_io = raw.get("NetIO") or raw.get("net_io") or "-"
        block_io = raw.get("BlockIO") or raw.get("block_io") or "-"
        pids = raw.get("PIDs") or raw.get("pids") or "0"
        name = raw.get("Name") or raw.get("name") or ""
        cid = raw.get("Container") or raw.get("ID") or raw.get("id") or ""
        return {
            "id": cid,
            "name": name,
            "cpu": cpu,
            "cpu_percent": cpu,
            "mem_usage": mem_usage,
            "mem_percent": mem_perc,
            "net_io": net_io,
            "block_io": block_io,
            "pids": pids,
            "raw": raw,
        }

    def container_stats(self, container_id: str) -> Dict[str, Any]:
        result = self._run(
            [self._docker_bin(), "stats", "--no-stream", "--format", "{{json .}}", container_id],
            timeout=20,
        )
        out = self._ensure_ok(result, "Failed to retrieve container stats.")
        raw = json.loads(out.strip()) if out.strip() else {}
        return self._normalize_stats_row(raw) if raw else {}

    def list_stats(self) -> List[Dict[str, Any]]:
        """Return live CPU/RAM/network stats for all running containers (one docker call)."""
        result = self._run(
            [self._docker_bin(), "stats", "--no-stream", "--format", "{{json .}}"],
            timeout=25,
        )
        if result.returncode != 0:
            if self.allow_mock:
                return [
                    {
                        "id": c["id"],
                        "name": c["name"],
                        "cpu": "1.2%",
                        "cpu_percent": "1.2%",
                        "mem_usage": "64MiB / 512MiB",
                        "mem_percent": "12.5%",
                        "net_io": "1.2kB / 800B",
                        "block_io": "0B / 0B",
                        "pids": "12",
                    }
                    for c in MOCK_CONTAINERS
                    if c.get("status") == "running"
                ]
            raise DockerManagerError(
                "Failed to retrieve container stats",
                code="docker_stats_failed",
                details=result.stderr.strip() or result.stdout.strip(),
            )
        rows: List[Dict[str, Any]] = []
        for line in (result.stdout or "").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            rows.append(self._normalize_stats_row(raw))
        return rows

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

    @staticmethod
    def _parse_image_ref(image_ref: str) -> Dict[str, str]:
        """Split ``registry/repo:tag`` into parts. Defaults to Docker Hub + latest."""
        ref = (image_ref or "").strip()
        if not ref or ref.startswith("<none>") or "@sha256:" in ref:
            raise DockerManagerError("Invalid image reference", code="invalid_image_ref")
        tag = "latest"
        if ":" in ref.rsplit("/", 1)[-1]:
            ref, tag = ref.rsplit(":", 1)
        registry = "docker.io"
        repository = ref
        if "/" in ref:
            first, rest = ref.split("/", 1)
            if "." in first or ":" in first or first == "localhost":
                registry = first
                repository = rest
            else:
                repository = ref
        else:
            repository = f"library/{ref}"
        if registry in {"docker.io", "index.docker.io", "registry-1.docker.io"} and "/" not in repository:
            repository = f"library/{repository}"
        return {"registry": registry, "repository": repository, "tag": tag, "name": f"{repository}:{tag}"}

    def local_image_digest(self, image_ref: str) -> Optional[str]:
        try:
            info = self.inspect_image(image_ref)
        except DockerManagerError:
            return None
        digests = info.get("RepoDigests") or []
        for entry in digests:
            if isinstance(entry, str) and "@" in entry:
                return entry.split("@", 1)[1]
        # Fallback: image Id (not comparable to registry digest, but useful as marker)
        image_id = info.get("Id") or ""
        return image_id if isinstance(image_id, str) and image_id else None

    def _remote_digest_docker_hub(self, repository: str, tag: str, timeout: int = 20) -> str:
        """Resolve remote content digest via Docker Hub registry API."""
        scope = f"repository:{repository}:pull"
        token_url = (
            "https://auth.docker.io/token"
            f"?service=registry.docker.io&scope={urllib.parse.quote(scope)}"
        )
        try:
            with urllib.request.urlopen(token_url, timeout=timeout) as resp:
                token_payload = json.loads(resp.read().decode("utf-8"))
            token = token_payload.get("token") or token_payload.get("access_token")
            if not token:
                raise DockerManagerError("Docker Hub auth token missing", code="registry_auth_failed")
        except urllib.error.HTTPError as exc:
            raise DockerManagerError("Docker Hub authentication failed", code="registry_auth_failed", details=str(exc)) from exc
        except Exception as exc:
            raise DockerManagerError("Failed to reach Docker Hub auth", code="registry_unreachable", details=str(exc)) from exc

        manifest_url = f"https://registry-1.docker.io/v2/{repository}/manifests/{urllib.parse.quote(tag)}"
        accept = (
            "application/vnd.oci.image.index.v1+json,"
            "application/vnd.docker.distribution.manifest.list.v2+json,"
            "application/vnd.oci.image.manifest.v1+json,"
            "application/vnd.docker.distribution.manifest.v2+json"
        )
        req = urllib.request.Request(
            manifest_url,
            method="GET",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": accept,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                digest = resp.headers.get("Docker-Content-Digest") or resp.headers.get("docker-content-digest")
                if not digest:
                    # Some proxies strip headers — hash body is not equivalent; fail clearly.
                    raise DockerManagerError("Remote digest header missing", code="registry_digest_missing")
                return digest.strip()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise DockerManagerError(f"Image not found on Docker Hub: {repository}:{tag}", code="registry_not_found") from exc
            raise DockerManagerError("Failed to fetch remote manifest", code="registry_manifest_failed", details=str(exc)) from exc
        except DockerManagerError:
            raise
        except Exception as exc:
            raise DockerManagerError("Registry request failed", code="registry_unreachable", details=str(exc)) from exc

    def _remote_digest_manifest_inspect(self, image_ref: str) -> Optional[str]:
        """Fallback: ``docker manifest inspect`` (works for some registries when logged in)."""
        result = self._run([self._docker_bin(), "manifest", "inspect", image_ref], timeout=45)
        if result.returncode != 0:
            return None
        try:
            payload = json.loads(result.stdout or "{}")
        except json.JSONDecodeError:
            return None
        # Single manifest
        if isinstance(payload.get("config"), dict) and payload.get("mediaType"):
            # digest not always present in body; try Descriptor
            pass
        # Manifest list
        if isinstance(payload.get("manifests"), list) and payload["manifests"]:
            # Prefer first linux/amd64 entry digest when present
            for item in payload["manifests"]:
                if not isinstance(item, dict):
                    continue
                platform = item.get("platform") or {}
                if platform.get("os") == "linux" and platform.get("architecture") in {"amd64", "arm64", "arm"}:
                    digest = item.get("digest")
                    if digest:
                        return digest
            digest = payload["manifests"][0].get("digest")
            if digest:
                return digest
        digest = payload.get("digest")
        return digest if isinstance(digest, str) else None

    def remote_image_digest(self, image_ref: str) -> str:
        parts = self._parse_image_ref(image_ref)
        registry = parts["registry"]
        if registry in {"docker.io", "index.docker.io", "registry-1.docker.io"}:
            return self._remote_digest_docker_hub(parts["repository"], parts["tag"])
        fallback = self._remote_digest_manifest_inspect(f"{parts['repository']}:{parts['tag']}" if registry == "docker.io" else image_ref)
        if fallback:
            return fallback
        # Try full ref with registry
        full = image_ref if image_ref.count("/") >= 1 else f"{parts['repository']}:{parts['tag']}"
        if not image_ref.startswith(registry) and registry != "docker.io":
            full = f"{registry}/{parts['repository']}:{parts['tag']}"
        fallback = self._remote_digest_manifest_inspect(full)
        if fallback:
            return fallback
        raise DockerManagerError(
            f"Cannot check updates for registry '{registry}'. Only Docker Hub is fully supported.",
            code="registry_unsupported",
        )

    def check_image_update(self, image_ref: str) -> Dict[str, Any]:
        """Compare local vs remote digest for one image reference."""
        parts = self._parse_image_ref(image_ref)
        normalized = (
            f"{parts['repository']}:{parts['tag']}"
            if parts["registry"] in {"docker.io", "index.docker.io", "registry-1.docker.io"}
            else f"{parts['registry']}/{parts['repository']}:{parts['tag']}"
        )
        # Prefer caller ref for local inspect (may be short name like nginx:alpine)
        local_ref = image_ref
        local = self.local_image_digest(local_ref)
        if local is None and local_ref != normalized:
            local = self.local_image_digest(normalized)
        try:
            remote = self.remote_image_digest(normalized if parts["registry"].startswith("docker") else image_ref)
        except DockerManagerError as exc:
            return {
                "image_ref": image_ref,
                "normalized": normalized,
                "local_digest": local,
                "remote_digest": None,
                "update_available": False,
                "status": "error",
                "error": str(exc),
                "code": exc.code,
            }
        update_available = False
        status = "unknown"
        if local and remote:
            # RepoDigests are sha256:... ; compare normalized
            local_norm = local if local.startswith("sha256:") else local
            remote_norm = remote if remote.startswith("sha256:") else remote
            if local_norm.startswith("sha256:") and remote_norm.startswith("sha256:"):
                update_available = local_norm != remote_norm
                status = "update_available" if update_available else "up_to_date"
            else:
                status = "unknown"
        elif remote and not local:
            update_available = True
            status = "update_available"
        return {
            "image_ref": image_ref,
            "normalized": normalized,
            "local_digest": local,
            "remote_digest": remote,
            "update_available": update_available,
            "status": status,
            "error": None,
            "code": None,
        }

    def check_image_updates(self, image_refs: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        refs = image_refs
        if not refs:
            refs = []
            for img in self.list_images():
                repo = img.get("repository") or ""
                tag = img.get("tag") or ""
                if not repo or repo == "<none>" or not tag or tag == "<none>":
                    continue
                refs.append(f"{repo}:{tag}")
        results: List[Dict[str, Any]] = []
        for ref in refs:
            try:
                results.append(self.check_image_update(ref))
            except DockerManagerError as exc:
                results.append(
                    {
                        "image_ref": ref,
                        "normalized": ref,
                        "local_digest": None,
                        "remote_digest": None,
                        "update_available": False,
                        "status": "error",
                        "error": str(exc),
                        "code": exc.code,
                    }
                )
        return results

    def pull_image(self, image_ref: str) -> str:
        result = self._run([self._docker_bin(), "pull", image_ref], timeout=600)
        return self._ensure_ok(result, "Failed to pull image.")

    def update_image_to_latest(self, image_ref: str) -> Dict[str, Any]:
        """Pull image from registry (update local tag to remote latest of that tag)."""
        before = self.local_image_digest(image_ref)
        output = self.pull_image(image_ref)
        after = self.local_image_digest(image_ref)
        changed = bool(before and after and before != after) or (not before and after)
        return {
            "image_ref": image_ref,
            "changed": changed or ("Downloaded newer image" in output) or ("Pull complete" in output),
            "local_digest_before": before,
            "local_digest_after": after,
            "output": output,
        }

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
