import os
import re
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from .logic import DockerManagerError


class ComposeManager:
    def __init__(self, managed_root: Optional[str] = None, scan_depth: int = 5, command_timeout: int = 90):
        self.scan_depth = scan_depth
        self.command_timeout = command_timeout
        self.managed_root = Path(managed_root or os.environ.get("COPANEL_MANAGED_STACKS_ROOT", "/opt/copanel/stacks"))
        self.ignore_dirs = {".git", "node_modules", "venv", ".npm", ".cache", "__pycache__"}
        self._locks: Dict[str, threading.Lock] = {}

    def _safe_stack_id(self, stack_id: str) -> str:
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", stack_id):
            raise DockerManagerError("Invalid stack id", code="invalid_stack_id")
        return stack_id

    def _resolve_compose_file(self, folder: Path) -> Optional[Path]:
        for name in ("docker-compose.yml", "docker-compose.yaml", "docker-composer.yml"):
            candidate = folder / name
            if candidate.exists() and candidate.is_file():
                return candidate
        return None

    def _resolve_within(self, path: Path, root: Path) -> Path:
        root_resolved = root.resolve()
        path_resolved = path.resolve()
        if root_resolved not in path_resolved.parents and path_resolved != root_resolved:
            raise DockerManagerError("Path is outside allowed root", code="path_forbidden")
        return path_resolved

    def _compose_cmd_base(self) -> List[str]:
        docker_bin = shutil.which("docker")
        if docker_bin:
            test = subprocess.run([docker_bin, "compose", "version"], capture_output=True, text=True, check=False)
            if test.returncode == 0:
                return [docker_bin, "compose"]
        docker_compose = shutil.which("docker-compose")
        if docker_compose:
            return [docker_compose]
        raise DockerManagerError("docker compose command not found", code="compose_unavailable")

    def _run_compose(self, path: str, args: List[str], timeout: Optional[int] = None) -> Dict[str, Any]:
        stack_path = Path(path)
        if not stack_path.exists() or not stack_path.is_dir():
            raise DockerManagerError(f"The path '{path}' does not exist.", code="path_not_found")
        cmd = self._compose_cmd_base() + args
        try:
            result = subprocess.run(
                cmd,
                cwd=str(stack_path),
                capture_output=True,
                text=True,
                check=False,
                timeout=timeout or self.command_timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise DockerManagerError("Compose command timed out", code="compose_timeout", details=str(exc)) from exc
        return {
            "status": "success" if result.returncode == 0 else "error",
            "output": result.stdout,
            "error": result.stderr,
            "code": result.returncode,
            "command": " ".join(cmd),
        }

    def scan_compose_files(self, custom_path: Optional[str] = None) -> List[Dict[str, str]]:
        scan_paths: List[Path] = []
        if custom_path:
            scan_paths = [Path(custom_path)]
        elif os.name == "nt":
            scan_paths = [Path("./test_docker"), Path("./test_nginx"), Path("./")]
        else:
            scan_paths = [Path("/home"), Path("/var/www"), Path("/opt/copanel"), Path("/root")]

        compose_files: List[Dict[str, str]] = []
        for base_path in scan_paths:
            if not base_path.exists() or not base_path.is_dir():
                continue
            try:
                for root, dirs, files in os.walk(str(base_path)):
                    depth = root.replace(str(base_path), "").count(os.sep)
                    if depth > self.scan_depth:
                        dirs[:] = []
                        continue
                    dirs[:] = [d for d in dirs if d not in self.ignore_dirs]
                    for file in files:
                        if file in {"docker-compose.yml", "docker-compose.yaml", "docker-composer.yml"}:
                            full_path = os.path.join(root, file)
                            compose_files.append(
                                {
                                    "path": root,
                                    "filename": file,
                                    "full_path": full_path,
                                    "source": "discovered",
                                }
                            )
            except Exception:
                continue
        return compose_files

    def validate(self, path: str) -> Dict[str, Any]:
        return self._run_compose(path, ["config"])

    def up(self, path: str, detach: bool = True) -> Dict[str, Any]:
        args = ["up"]
        if detach:
            args.append("-d")
        return self._run_compose(path, args, timeout=300)

    def down(self, path: str) -> Dict[str, Any]:
        return self._run_compose(path, ["down"], timeout=180)

    def restart(self, path: str) -> Dict[str, Any]:
        return self._run_compose(path, ["restart"], timeout=180)

    def pull(self, path: str) -> Dict[str, Any]:
        return self._run_compose(path, ["pull"], timeout=300)

    def build(self, path: str, no_cache: bool = False) -> Dict[str, Any]:
        args = ["build"]
        if no_cache:
            args.append("--no-cache")
        return self._run_compose(path, args, timeout=600)

    def ps(self, path: str) -> Dict[str, Any]:
        return self._run_compose(path, ["ps"])

    def logs(self, path: str, tail: int = 100, since: Optional[str] = None, timestamps: bool = False, follow: bool = False) -> Dict[str, Any]:
        args = ["logs", "--tail", str(tail)]
        if since:
            args.extend(["--since", since])
        if timestamps:
            args.append("--timestamps")
        if follow:
            args.append("--follow")
        return self._run_compose(path, args, timeout=300 if follow else 120)

    def list_managed_stacks(self) -> List[Dict[str, Any]]:
        self.managed_root.mkdir(parents=True, exist_ok=True)
        stacks: List[Dict[str, Any]] = []
        for child in self.managed_root.iterdir():
            if not child.is_dir():
                continue
            compose_file = self._resolve_compose_file(child)
            if compose_file:
                stacks.append(
                    {
                        "id": child.name,
                        "path": str(child),
                        "compose_file": str(compose_file),
                        "source": "managed",
                    }
                )
        return stacks

    def init_stack(self, stack_id: str, image: str, host_port: int, container_port: int) -> Dict[str, Any]:
        self.managed_root.mkdir(parents=True, exist_ok=True)
        sid = self._safe_stack_id(stack_id)
        stack_dir = self._resolve_within(self.managed_root / sid, self.managed_root)
        stack_dir.mkdir(parents=True, exist_ok=True)
        compose_content = (
            "services:\n"
            f"  {sid}:\n"
            f"    image: {image}\n"
            "    restart: unless-stopped\n"
            "    ports:\n"
            f"      - \"{host_port}:{container_port}\"\n"
        )
        (stack_dir / "docker-compose.yml").write_text(compose_content, encoding="utf-8")
        (stack_dir / ".env.example").write_text("# Add your env vars here\n", encoding="utf-8")
        (stack_dir / "README.md").write_text(f"# Stack {sid}\n\nManaged by CoPanel.\n", encoding="utf-8")
        return {"stack_id": sid, "path": str(stack_dir), "source": "managed"}

    def get_compose_content(self, stack_id: str) -> Dict[str, Any]:
        sid = self._safe_stack_id(stack_id)
        stack_dir = self._resolve_within(self.managed_root / sid, self.managed_root)
        compose_file = self._resolve_compose_file(stack_dir)
        if not compose_file:
            raise DockerManagerError("Compose file not found", code="compose_missing")
        return {
            "stack_id": sid,
            "path": str(stack_dir),
            "compose_file": str(compose_file),
            "content": compose_file.read_text(encoding="utf-8"),
        }

    def update_compose_content(self, stack_id: str, compose_content: str) -> Dict[str, Any]:
        sid = self._safe_stack_id(stack_id)
        stack_dir = self._resolve_within(self.managed_root / sid, self.managed_root)
        compose_file = stack_dir / "docker-compose.yml"
        lock = self._locks.setdefault(sid, threading.Lock())
        with lock:
            backup = compose_file.read_text(encoding="utf-8") if compose_file.exists() else ""
            compose_file.write_text(compose_content, encoding="utf-8")
            validation = self.validate(str(stack_dir))
            if validation["status"] != "success":
                if backup:
                    compose_file.write_text(backup, encoding="utf-8")
                raise DockerManagerError("Compose validation failed", code="compose_invalid", details=validation.get("error") or validation.get("output"))
        return {"stack_id": sid, "compose_file": str(compose_file), "validated": True}
