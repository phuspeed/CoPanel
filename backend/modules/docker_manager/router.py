"""Docker Manager API router with Docker + Compose support."""

import asyncio
from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core.audit import record_audit
from core.auth import require_module, require_user
from core.jobs import jobs as job_manager

from .compose_manager import ComposeManager
from .templates import COMPOSE_TEMPLATES
from .logic import DockerManagerError, DockerService, should_allow_mock
from .schemas import (
    ComposeBuildRequest,
    ComposeLogsQuery,
    ComposePathRequest,
    ComposeUpRequest,
    ContainerActionRequest,
    ContainerExecRequest,
    ContainerRenameRequest,
    ProjectCreateRequest,
    ProjectComposeUpdateByPathRequest,
    ProjectEnvUpdateRequest,
    ProjectInspectRequest,
    ProjectValidateContentRequest,
    StackComposeUpdateRequest,
    StackInitRequest,
)

router = APIRouter(dependencies=[Depends(require_module("docker_manager"))])
docker_service = DockerService(allow_mock=should_allow_mock())
compose_manager = ComposeManager()


async def _run_sync(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Run blocking Docker/Compose work off the asyncio event loop."""
    return await asyncio.to_thread(fn, *args, **kwargs)


def _clip_log(text: Optional[str], limit: int = 4000) -> str:
    value = (text or "").strip()
    if len(value) <= limit:
        return value
    return value[-limit:]


async def _compose_deploy_job_handler(job, path: str) -> Dict[str, Any]:
    """Pull registry images, build local images when compose requires it, then up -d."""
    job.update(progress=5, message=f"Preparing deploy for {path}")
    need_build = await _run_sync(compose_manager.services_need_build, path)
    if need_build:
        job.log("Compose file defines local build — will run docker compose build if pull fails.")

    if job.cancel_requested():
        raise RuntimeError("Cancelled")

    job.update(progress=15, message="Pulling images…")
    pull = await _run_sync(compose_manager.pull, path)
    job.log(_clip_log(compose_manager._compose_output_text(pull)) or "pull finished")

    if job.cancel_requested():
        raise RuntimeError("Cancelled")

    built = False
    should_build = need_build or (
        pull.get("status") != "success" and compose_manager._pull_suggests_build(pull)
    )
    if should_build:
        job.update(progress=40, message="Building images…")
        build = await _run_sync(compose_manager.build, path, False)
        job.log(_clip_log(compose_manager._compose_output_text(build)) or "build finished")
        if build.get("status") != "success":
            raise RuntimeError(build.get("error") or "compose build failed")
        built = True
    elif pull.get("status") not in ("success", None):
        raise RuntimeError(pull.get("error") or "compose pull failed")

    if job.cancel_requested():
        raise RuntimeError("Cancelled")

    job.update(progress=75, message="Starting stack…")
    up = await _run_sync(compose_manager.up, path, True)
    job.log(_clip_log(compose_manager._compose_output_text(up)) or "up finished")
    if up.get("status") != "success":
        raise RuntimeError(up.get("error") or "compose up failed")

    suffix = " (built from source)" if built else ""
    job.update(progress=100, message=f"Stack deployed{suffix}")
    return {"path": path, "output": up.get("output"), "built": built}


async def _compose_down_job_handler(job, path: str) -> Dict[str, Any]:
    job.update(progress=10, message=f"Stopping stack {path}")
    result = await _run_sync(compose_manager.down, path)
    job.log(_clip_log(compose_manager._compose_output_text(result)))
    if result.get("status") != "success":
        raise RuntimeError(result.get("error") or "compose down failed")
    job.update(progress=100, message="Stack stopped")
    return {"path": path, "output": result.get("output")}


async def _compose_restart_job_handler(job, path: str) -> Dict[str, Any]:
    job.update(progress=10, message=f"Restarting stack {path}")
    result = await _run_sync(compose_manager.restart, path)
    job.log(_clip_log(compose_manager._compose_output_text(result)))
    if result.get("status") != "success":
        raise RuntimeError(result.get("error") or "compose restart failed")
    job.update(progress=100, message="Stack restarted")
    return {"path": path, "output": result.get("output")}


async def _compose_build_job_handler(job, path: str, no_cache: bool = False) -> Dict[str, Any]:
    job.update(progress=10, message=f"Building images for {path}")
    result = await _run_sync(compose_manager.build, path, no_cache)
    job.log(_clip_log(compose_manager._compose_output_text(result)))
    if result.get("status") != "success":
        raise RuntimeError(result.get("error") or "compose build failed")
    job.update(progress=100, message="Build complete")
    return {"path": path, "output": result.get("output"), "no_cache": no_cache}


async def _container_action_job_handler(job, container_id: str, action: str) -> Dict[str, Any]:
    labels = {"start": "Starting", "stop": "Stopping", "restart": "Restarting", "remove": "Removing"}
    job.update(progress=20, message=f"{labels.get(action, action.title())} {container_id}")
    if action == "remove":
        await _run_sync(docker_service.remove_container, container_id)
    else:
        await _run_sync(docker_service.container_action, container_id, action)
    job.update(progress=100, message=f"Container {action} complete")
    return {"container_id": container_id, "action": action}


def _raise_http(error: Exception) -> None:
    if isinstance(error, DockerManagerError):
        status_code = 400
        if error.code in {"docker_unavailable", "compose_unavailable"}:
            status_code = 503
        elif error.code in {"docker_exec_failed"}:
            status_code = 500
        raise HTTPException(
            status_code=status_code,
            detail={"code": error.code, "message": str(error), "details": error.details},
        ) from error
    raise HTTPException(status_code=500, detail={"code": "internal_error", "message": str(error)}) from error


def _submit_compose_job(
    *,
    kind: str,
    title: str,
    path: str,
    user: Dict[str, Any],
    handler,
    args: tuple = (),
    audit_action: str,
) -> Dict[str, Any]:
    job = job_manager.submit(
        kind=kind,
        title=title,
        module="docker_manager",
        actor=user.get("username"),
        payload={"path": path},
        handler=handler,
        args=args or (path,),
    )
    record_audit(
        audit_action,
        module="docker_manager",
        target=path,
        actor=user.get("username"),
        actor_id=user.get("id"),
        meta={"job_id": job.id},
    )
    return {"status": "success", "job_id": job.id}


@router.get("/list")
async def list_containers() -> Dict[str, Any]:
    try:
        containers, is_mock = await _run_sync(docker_service.list_containers)
        return {"status": "success", "containers": containers, "mock": is_mock}
    except Exception as exc:
        _raise_http(exc)


@router.get("/stats")
async def list_container_stats() -> Dict[str, Any]:
    """Batch CPU / memory / network stats for running containers."""
    try:
        stats = await _run_sync(docker_service.list_stats)
        return {"status": "success", "data": stats}
    except Exception as exc:
        _raise_http(exc)


@router.post("/start")
async def start_container(
    req: ContainerActionRequest,
    user: Dict[str, Any] = Depends(require_user),
    background: bool = Query(default=True),
) -> Dict[str, Any]:
    try:
        if background:
            job = job_manager.submit(
                kind="docker_manager.container_start",
                title=f"Start {req.container_id}",
                module="docker_manager",
                actor=user.get("username"),
                payload={"container_id": req.container_id, "action": "start"},
                handler=_container_action_job_handler,
                args=(req.container_id, "start"),
            )
            return {"status": "success", "job_id": job.id, "message": "Start job queued."}
        await _run_sync(docker_service.container_action, req.container_id, "start")
        return {"status": "success", "message": "Container started successfully."}
    except Exception as exc:
        _raise_http(exc)


@router.post("/stop")
async def stop_container(
    req: ContainerActionRequest,
    user: Dict[str, Any] = Depends(require_user),
    background: bool = Query(default=True),
) -> Dict[str, Any]:
    try:
        if background:
            job = job_manager.submit(
                kind="docker_manager.container_stop",
                title=f"Stop {req.container_id}",
                module="docker_manager",
                actor=user.get("username"),
                payload={"container_id": req.container_id, "action": "stop"},
                handler=_container_action_job_handler,
                args=(req.container_id, "stop"),
            )
            return {"status": "success", "job_id": job.id, "message": "Stop job queued."}
        await _run_sync(docker_service.container_action, req.container_id, "stop")
        return {"status": "success", "message": "Container stopped successfully."}
    except Exception as exc:
        _raise_http(exc)


@router.post("/restart")
async def restart_container(
    req: ContainerActionRequest,
    user: Dict[str, Any] = Depends(require_user),
    background: bool = Query(default=True),
) -> Dict[str, Any]:
    try:
        if background:
            job = job_manager.submit(
                kind="docker_manager.container_restart",
                title=f"Restart {req.container_id}",
                module="docker_manager",
                actor=user.get("username"),
                payload={"container_id": req.container_id, "action": "restart"},
                handler=_container_action_job_handler,
                args=(req.container_id, "restart"),
            )
            return {"status": "success", "job_id": job.id, "message": "Restart job queued."}
        await _run_sync(docker_service.container_action, req.container_id, "restart")
        return {"status": "success", "message": "Container restarted successfully."}
    except Exception as exc:
        _raise_http(exc)


@router.post("/remove")
async def remove_container(
    req: ContainerActionRequest,
    user: Dict[str, Any] = Depends(require_user),
    background: bool = Query(default=True),
) -> Dict[str, Any]:
    try:
        if background:
            job = job_manager.submit(
                kind="docker_manager.container_remove",
                title=f"Remove {req.container_id}",
                module="docker_manager",
                actor=user.get("username"),
                payload={"container_id": req.container_id, "action": "remove"},
                handler=_container_action_job_handler,
                args=(req.container_id, "remove"),
            )
            return {"status": "success", "job_id": job.id, "message": "Remove job queued."}
        await _run_sync(docker_service.remove_container, req.container_id)
        return {"status": "success", "message": "Container removed successfully."}
    except Exception as exc:
        _raise_http(exc)


@router.get("/logs")
async def get_container_logs(
    container_id: str,
    tail: int = Query(default=300, ge=1, le=10000),
    since: Optional[str] = None,
    timestamps: bool = True,
) -> Dict[str, Any]:
    try:
        logs = await _run_sync(
            docker_service.get_logs,
            container_id,
            tail=tail,
            since=since,
            timestamps=timestamps,
        )
        return {"status": "success", "logs": logs, "tail": tail, "container_id": container_id}
    except Exception as exc:
        _raise_http(exc)


@router.get("/containers/{container_id}/inspect")
async def inspect_container(container_id: str) -> Dict[str, Any]:
    try:
        data = await _run_sync(docker_service.inspect_container, container_id)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.get("/containers/{container_id}/stats")
async def container_stats(container_id: str) -> Dict[str, Any]:
    try:
        data = await _run_sync(docker_service.container_stats, container_id)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.post("/containers/exec")
async def exec_container(req: ContainerExecRequest) -> Dict[str, Any]:
    try:
        data = await _run_sync(docker_service.exec_command, req.container_id, req.command)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.post("/containers/rename")
async def rename_container(req: ContainerRenameRequest) -> Dict[str, Any]:
    try:
        await _run_sync(docker_service.rename_container, req.container_id, req.new_name)
        return {"status": "success", "message": "Container renamed successfully."}
    except Exception as exc:
        _raise_http(exc)


@router.post("/containers/prune")
async def prune_containers() -> Dict[str, Any]:
    try:
        message = await _run_sync(docker_service.prune_containers)
        return {"status": "success", "message": message}
    except Exception as exc:
        _raise_http(exc)


@router.get("/images")
async def list_images() -> Dict[str, Any]:
    try:
        data = await _run_sync(docker_service.list_images)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.get("/images/inspect")
async def inspect_image(image_ref: str) -> Dict[str, Any]:
    try:
        data = await _run_sync(docker_service.inspect_image, image_ref)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.post("/images/pull")
async def pull_image(image_ref: str) -> Dict[str, Any]:
    try:
        message = await _run_sync(docker_service.pull_image, image_ref)
        return {"status": "success", "message": message}
    except Exception as exc:
        _raise_http(exc)


@router.post("/images/remove")
async def remove_image(image_ref: str) -> Dict[str, Any]:
    try:
        message = await _run_sync(docker_service.remove_image, image_ref)
        return {"status": "success", "message": message}
    except Exception as exc:
        _raise_http(exc)


@router.post("/images/prune")
async def prune_images() -> Dict[str, Any]:
    try:
        message = await _run_sync(docker_service.prune_images)
        return {"status": "success", "message": message}
    except Exception as exc:
        _raise_http(exc)


@router.get("/networks")
async def list_networks() -> Dict[str, Any]:
    try:
        data = await _run_sync(docker_service.list_networks)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.post("/networks/create")
async def create_network(name: str, driver: str = "bridge") -> Dict[str, Any]:
    try:
        message = await _run_sync(docker_service.create_network, name, driver)
        return {"status": "success", "message": message}
    except Exception as exc:
        _raise_http(exc)


@router.post("/networks/remove")
async def remove_network(name: str) -> Dict[str, Any]:
    try:
        message = await _run_sync(docker_service.remove_network, name)
        return {"status": "success", "message": message}
    except Exception as exc:
        _raise_http(exc)


@router.post("/networks/connect")
async def connect_network(name: str, container_id: str) -> Dict[str, Any]:
    try:
        message = await _run_sync(docker_service.connect_network, name, container_id)
        return {"status": "success", "message": message}
    except Exception as exc:
        _raise_http(exc)


@router.post("/networks/disconnect")
async def disconnect_network(name: str, container_id: str) -> Dict[str, Any]:
    try:
        message = await _run_sync(docker_service.disconnect_network, name, container_id)
        return {"status": "success", "message": message}
    except Exception as exc:
        _raise_http(exc)


@router.get("/volumes")
async def list_volumes() -> Dict[str, Any]:
    try:
        data = await _run_sync(docker_service.list_volumes)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.post("/volumes/create")
async def create_volume(name: str) -> Dict[str, Any]:
    try:
        message = await _run_sync(docker_service.create_volume, name)
        return {"status": "success", "message": message}
    except Exception as exc:
        _raise_http(exc)


@router.post("/volumes/remove")
async def remove_volume(name: str) -> Dict[str, Any]:
    try:
        message = await _run_sync(docker_service.remove_volume, name)
        return {"status": "success", "message": message}
    except Exception as exc:
        _raise_http(exc)


@router.post("/volumes/prune")
async def prune_volumes() -> Dict[str, Any]:
    try:
        message = await _run_sync(docker_service.prune_volumes)
        return {"status": "success", "message": message}
    except Exception as exc:
        _raise_http(exc)


@router.get("/scan-compose")
async def scan_compose_files(custom_path: Optional[str] = None) -> Dict[str, Any]:
    try:
        compose_files = await _run_sync(compose_manager.scan_compose_files, custom_path)
        return {"status": "success", "compose_files": compose_files}
    except Exception as exc:
        _raise_http(exc)


@router.post("/up-compose")
async def build_compose_stack(req: ComposePathRequest) -> Dict[str, Any]:
    try:
        result = await _run_sync(compose_manager.up, req.path, True)
        if result["status"] != "success":
            return {"status": "error", "message": result["error"] or "Failed to bring up docker compose stack."}
        return {"status": "success", "message": "Docker Compose stack brought up successfully.", "output": result["output"]}
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/validate")
async def compose_validate(req: ComposePathRequest) -> Dict[str, Any]:
    try:
        return await _run_sync(compose_manager.validate, req.path)
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/up")
async def compose_up(req: ComposeUpRequest) -> Dict[str, Any]:
    try:
        return await _run_sync(compose_manager.up, req.path, req.detach)
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/down")
async def compose_down(req: ComposePathRequest, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    try:
        return _submit_compose_job(
            kind="docker_manager.compose_down",
            title=f"Compose stop {req.path}",
            path=req.path,
            user=user,
            handler=_compose_down_job_handler,
            audit_action="docker.compose_down",
        )
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/restart")
async def compose_restart(req: ComposePathRequest, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    try:
        return _submit_compose_job(
            kind="docker_manager.compose_restart",
            title=f"Compose restart {req.path}",
            path=req.path,
            user=user,
            handler=_compose_restart_job_handler,
            audit_action="docker.compose_restart",
        )
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/pull")
async def compose_pull(req: ComposePathRequest) -> Dict[str, Any]:
    try:
        return await _run_sync(compose_manager.pull, req.path)
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/build")
async def compose_build(req: ComposeBuildRequest, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    try:
        return _submit_compose_job(
            kind="docker_manager.compose_build",
            title=f"Compose build {req.path}",
            path=req.path,
            user=user,
            handler=_compose_build_job_handler,
            args=(req.path, req.no_cache),
            audit_action="docker.compose_build",
        )
    except Exception as exc:
        _raise_http(exc)


@router.get("/compose/ps")
async def compose_ps(path: str) -> Dict[str, Any]:
    try:
        return await _run_sync(compose_manager.ps, path)
    except Exception as exc:
        _raise_http(exc)


@router.get("/compose/logs")
async def compose_logs(
    path: str,
    tail: int = Query(default=300, ge=1, le=10000),
    since: Optional[str] = None,
    timestamps: bool = True,
    follow: bool = False,
) -> Dict[str, Any]:
    try:
        query = ComposeLogsQuery(path=path, tail=tail, since=since, timestamps=timestamps, follow=follow)
        return await _run_sync(
            compose_manager.logs,
            path=query.path,
            tail=query.tail,
            since=query.since,
            timestamps=query.timestamps,
            follow=query.follow,
        )
    except Exception as exc:
        _raise_http(exc)


@router.post("/stacks/init")
async def stack_init(req: StackInitRequest) -> Dict[str, Any]:
    try:
        data = await _run_sync(
            compose_manager.init_stack,
            req.stack_id,
            req.image,
            req.host_port,
            req.container_port,
        )
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.get("/stacks")
async def list_stacks() -> Dict[str, Any]:
    try:
        data = await _run_sync(compose_manager.list_managed_stacks)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.get("/stacks/{stack_id}/compose")
async def read_stack_compose(stack_id: str) -> Dict[str, Any]:
    try:
        data = await _run_sync(compose_manager.get_compose_content, stack_id)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.put("/stacks/{stack_id}/compose")
async def update_stack_compose(stack_id: str, req: StackComposeUpdateRequest) -> Dict[str, Any]:
    try:
        data = await _run_sync(compose_manager.update_compose_content, stack_id, req.compose_content)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.get("/projects/list")
async def project_list() -> Dict[str, Any]:
    try:
        data = await _run_sync(compose_manager.list_projects)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.get("/projects/templates")
async def project_templates() -> Dict[str, Any]:
    return {"status": "success", "data": COMPOSE_TEMPLATES}


@router.get("/projects/compose")
async def project_compose_read(path: str = Query(...)) -> Dict[str, Any]:
    try:
        data = await _run_sync(compose_manager.get_compose_at_path, path)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.put("/projects/compose")
async def project_compose_update(req: ProjectComposeUpdateByPathRequest) -> Dict[str, Any]:
    try:
        data = await _run_sync(compose_manager.update_compose_at_path, req.path, req.compose_content)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.get("/projects/env")
async def project_env_read(path: str = Query(...)) -> Dict[str, Any]:
    try:
        data = await _run_sync(compose_manager.get_env_at_path, path)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.put("/projects/env")
async def project_env_update(req: ProjectEnvUpdateRequest) -> Dict[str, Any]:
    try:
        data = await _run_sync(compose_manager.update_env_at_path, req.path, req.content)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.get("/projects/defaults")
async def project_defaults() -> Dict[str, Any]:
    return {
        "status": "success",
        "data": {
            "managed_root": str(compose_manager.managed_root),
        },
    }


@router.post("/projects/inspect")
async def project_inspect(req: ProjectInspectRequest) -> Dict[str, Any]:
    try:
        data = await _run_sync(compose_manager.inspect_folder, req.path)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.post("/projects/validate-content")
async def project_validate_content(req: ProjectValidateContentRequest) -> Dict[str, Any]:
    try:
        result = await _run_sync(compose_manager.validate_compose_content, req.compose_content)
        return {"status": "success" if result["status"] == "success" else "error", "data": result}
    except Exception as exc:
        _raise_http(exc)


@router.post("/projects/create")
async def project_create(req: ProjectCreateRequest, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    try:
        template_payload = req.template.model_dump() if req.template else None
        project = await _run_sync(
            compose_manager.create_project,
            project_name=req.project_name,
            folder_mode=req.folder_mode,
            source=req.source,
            folder_path=req.folder_path,
            compose_content=req.compose_content,
            template=template_payload,
            overwrite_compose=req.overwrite_compose,
        )
        job_id: Optional[str] = None
        if req.deploy:
            job = job_manager.submit(
                kind="docker_manager.compose_deploy",
                title=f"Deploy project {project['project_name']}",
                module="docker_manager",
                actor=user.get("username"),
                payload={"path": project["path"], "project_name": project["project_name"]},
                handler=_compose_deploy_job_handler,
                args=(project["path"],),
            )
            job_id = job.id
            record_audit(
                "docker.project_create",
                module="docker_manager",
                target=project["path"],
                actor=user.get("username"),
                actor_id=user.get("id"),
                meta={"job_id": job.id, "project_name": project["project_name"], "source": req.source},
            )
        return {"status": "success", "data": project, "job_id": job_id}
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/deploy")
async def compose_deploy_job(req: ComposeUpRequest, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    """Run compose deploy (pull, build local images if needed, up -d) as a background job."""
    try:
        return _submit_compose_job(
            kind="docker_manager.compose_deploy",
            title=f"Compose deploy {req.path}",
            path=req.path,
            user=user,
            handler=_compose_deploy_job_handler,
            audit_action="docker.compose_deploy",
        )
    except Exception as exc:
        _raise_http(exc)
