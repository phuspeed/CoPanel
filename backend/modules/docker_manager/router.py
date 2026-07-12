"""Docker Manager API router with Docker + Compose support."""

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core.audit import record_audit
from core.auth import optional_user
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

router = APIRouter()
docker_service = DockerService(allow_mock=should_allow_mock())
compose_manager = ComposeManager()


async def _compose_deploy_job_handler(job, path: str) -> Dict[str, Any]:
    """Pull registry images, build local images when compose requires it, then up -d."""
    job.update(progress=5, message=f"Preparing deploy for {path}")
    if compose_manager.services_need_build(path):
        job.log("Compose file defines local build — will run docker compose build if pull fails.")
    job.update(progress=15, message="Pull / build / up")
    result = compose_manager.deploy_stack(path, detach=True)
    job.log(result.get("output") or result.get("error") or "")
    if result.get("status") != "success":
        raise RuntimeError(result.get("error") or "compose deploy failed")
    suffix = " (built from source)" if result.get("built") else ""
    job.update(progress=100, message=f"Stack deployed{suffix}")
    return {"path": path, "output": result.get("output"), "built": result.get("built")}


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


@router.get("/list")
async def list_containers() -> Dict[str, Any]:
    try:
        containers, is_mock = docker_service.list_containers()
        return {"status": "success", "containers": containers, "mock": is_mock}
    except Exception as exc:
        _raise_http(exc)


@router.post("/start")
async def start_container(req: ContainerActionRequest) -> Dict[str, Any]:
    try:
        docker_service.container_action(req.container_id, "start")
        return {"status": "success", "message": "Container started successfully."}
    except Exception as exc:
        _raise_http(exc)


@router.post("/stop")
async def stop_container(req: ContainerActionRequest) -> Dict[str, Any]:
    try:
        docker_service.container_action(req.container_id, "stop")
        return {"status": "success", "message": "Container stopped successfully."}
    except Exception as exc:
        _raise_http(exc)


@router.post("/restart")
async def restart_container(req: ContainerActionRequest) -> Dict[str, Any]:
    try:
        docker_service.container_action(req.container_id, "restart")
        return {"status": "success", "message": "Container restarted successfully."}
    except Exception as exc:
        _raise_http(exc)


@router.post("/remove")
async def remove_container(req: ContainerActionRequest) -> Dict[str, Any]:
    try:
        docker_service.remove_container(req.container_id)
        return {"status": "success", "message": "Container removed successfully."}
    except Exception as exc:
        _raise_http(exc)


@router.get("/logs")
async def get_container_logs(
    container_id: str,
    tail: int = Query(default=100, ge=1, le=5000),
    since: Optional[str] = None,
    timestamps: bool = False,
) -> Dict[str, Any]:
    try:
        logs = docker_service.get_logs(container_id, tail=tail, since=since, timestamps=timestamps)
        return {"status": "success", "logs": logs}
    except Exception as exc:
        _raise_http(exc)


@router.get("/containers/{container_id}/inspect")
async def inspect_container(container_id: str) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": docker_service.inspect_container(container_id)}
    except Exception as exc:
        _raise_http(exc)


@router.get("/containers/{container_id}/stats")
async def container_stats(container_id: str) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": docker_service.container_stats(container_id)}
    except Exception as exc:
        _raise_http(exc)


@router.post("/containers/exec")
async def exec_container(req: ContainerExecRequest) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": docker_service.exec_command(req.container_id, req.command)}
    except Exception as exc:
        _raise_http(exc)


@router.post("/containers/rename")
async def rename_container(req: ContainerRenameRequest) -> Dict[str, Any]:
    try:
        docker_service.rename_container(req.container_id, req.new_name)
        return {"status": "success", "message": "Container renamed successfully."}
    except Exception as exc:
        _raise_http(exc)


@router.post("/containers/prune")
async def prune_containers() -> Dict[str, Any]:
    try:
        return {"status": "success", "message": docker_service.prune_containers()}
    except Exception as exc:
        _raise_http(exc)


@router.get("/images")
async def list_images() -> Dict[str, Any]:
    try:
        return {"status": "success", "data": docker_service.list_images()}
    except Exception as exc:
        _raise_http(exc)


@router.get("/images/inspect")
async def inspect_image(image_ref: str) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": docker_service.inspect_image(image_ref)}
    except Exception as exc:
        _raise_http(exc)


@router.post("/images/pull")
async def pull_image(image_ref: str) -> Dict[str, Any]:
    try:
        return {"status": "success", "message": docker_service.pull_image(image_ref)}
    except Exception as exc:
        _raise_http(exc)


@router.post("/images/remove")
async def remove_image(image_ref: str) -> Dict[str, Any]:
    try:
        return {"status": "success", "message": docker_service.remove_image(image_ref)}
    except Exception as exc:
        _raise_http(exc)


@router.post("/images/prune")
async def prune_images() -> Dict[str, Any]:
    try:
        return {"status": "success", "message": docker_service.prune_images()}
    except Exception as exc:
        _raise_http(exc)


@router.get("/networks")
async def list_networks() -> Dict[str, Any]:
    try:
        return {"status": "success", "data": docker_service.list_networks()}
    except Exception as exc:
        _raise_http(exc)


@router.post("/networks/create")
async def create_network(name: str, driver: str = "bridge") -> Dict[str, Any]:
    try:
        return {"status": "success", "message": docker_service.create_network(name, driver)}
    except Exception as exc:
        _raise_http(exc)


@router.post("/networks/remove")
async def remove_network(name: str) -> Dict[str, Any]:
    try:
        return {"status": "success", "message": docker_service.remove_network(name)}
    except Exception as exc:
        _raise_http(exc)


@router.post("/networks/connect")
async def connect_network(name: str, container_id: str) -> Dict[str, Any]:
    try:
        return {"status": "success", "message": docker_service.connect_network(name, container_id)}
    except Exception as exc:
        _raise_http(exc)


@router.post("/networks/disconnect")
async def disconnect_network(name: str, container_id: str) -> Dict[str, Any]:
    try:
        return {"status": "success", "message": docker_service.disconnect_network(name, container_id)}
    except Exception as exc:
        _raise_http(exc)


@router.get("/volumes")
async def list_volumes() -> Dict[str, Any]:
    try:
        return {"status": "success", "data": docker_service.list_volumes()}
    except Exception as exc:
        _raise_http(exc)


@router.post("/volumes/create")
async def create_volume(name: str) -> Dict[str, Any]:
    try:
        return {"status": "success", "message": docker_service.create_volume(name)}
    except Exception as exc:
        _raise_http(exc)


@router.post("/volumes/remove")
async def remove_volume(name: str) -> Dict[str, Any]:
    try:
        return {"status": "success", "message": docker_service.remove_volume(name)}
    except Exception as exc:
        _raise_http(exc)


@router.post("/volumes/prune")
async def prune_volumes() -> Dict[str, Any]:
    try:
        return {"status": "success", "message": docker_service.prune_volumes()}
    except Exception as exc:
        _raise_http(exc)


@router.get("/scan-compose")
async def scan_compose_files(custom_path: Optional[str] = None) -> Dict[str, Any]:
    try:
        compose_files = compose_manager.scan_compose_files(custom_path=custom_path)
        return {"status": "success", "compose_files": compose_files}
    except Exception as exc:
        _raise_http(exc)


@router.post("/up-compose")
async def build_compose_stack(req: ComposePathRequest) -> Dict[str, Any]:
    try:
        result = compose_manager.up(req.path, detach=True)
        if result["status"] != "success":
            return {"status": "error", "message": result["error"] or "Failed to bring up docker compose stack."}
        return {"status": "success", "message": "Docker Compose stack brought up successfully.", "output": result["output"]}
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/validate")
async def compose_validate(req: ComposePathRequest) -> Dict[str, Any]:
    try:
        return compose_manager.validate(req.path)
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/up")
async def compose_up(req: ComposeUpRequest) -> Dict[str, Any]:
    try:
        return compose_manager.up(req.path, detach=req.detach)
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/down")
async def compose_down(req: ComposePathRequest) -> Dict[str, Any]:
    try:
        return compose_manager.down(req.path)
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/restart")
async def compose_restart(req: ComposePathRequest) -> Dict[str, Any]:
    try:
        return compose_manager.restart(req.path)
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/pull")
async def compose_pull(req: ComposePathRequest) -> Dict[str, Any]:
    try:
        return compose_manager.pull(req.path)
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/build")
async def compose_build(req: ComposeBuildRequest) -> Dict[str, Any]:
    try:
        return compose_manager.build(req.path, no_cache=req.no_cache)
    except Exception as exc:
        _raise_http(exc)


@router.get("/compose/ps")
async def compose_ps(path: str) -> Dict[str, Any]:
    try:
        return compose_manager.ps(path)
    except Exception as exc:
        _raise_http(exc)


@router.get("/compose/logs")
async def compose_logs(path: str, tail: int = 100, since: Optional[str] = None, timestamps: bool = False, follow: bool = False) -> Dict[str, Any]:
    try:
        query = ComposeLogsQuery(path=path, tail=tail, since=since, timestamps=timestamps, follow=follow)
        return compose_manager.logs(
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
        data = compose_manager.init_stack(req.stack_id, req.image, req.host_port, req.container_port)
        return {"status": "success", "data": data}
    except Exception as exc:
        _raise_http(exc)


@router.get("/stacks")
async def list_stacks() -> Dict[str, Any]:
    try:
        return {"status": "success", "data": compose_manager.list_managed_stacks()}
    except Exception as exc:
        _raise_http(exc)


@router.get("/stacks/{stack_id}/compose")
async def read_stack_compose(stack_id: str) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": compose_manager.get_compose_content(stack_id)}
    except Exception as exc:
        _raise_http(exc)


@router.put("/stacks/{stack_id}/compose")
async def update_stack_compose(stack_id: str, req: StackComposeUpdateRequest) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": compose_manager.update_compose_content(stack_id, req.compose_content)}
    except Exception as exc:
        _raise_http(exc)


@router.get("/projects/list")
async def project_list() -> Dict[str, Any]:
    try:
        return {"status": "success", "data": compose_manager.list_projects()}
    except Exception as exc:
        _raise_http(exc)


@router.get("/projects/templates")
async def project_templates() -> Dict[str, Any]:
    return {"status": "success", "data": COMPOSE_TEMPLATES}


@router.get("/projects/compose")
async def project_compose_read(path: str = Query(...)) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": compose_manager.get_compose_at_path(path)}
    except Exception as exc:
        _raise_http(exc)


@router.put("/projects/compose")
async def project_compose_update(req: ProjectComposeUpdateByPathRequest) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": compose_manager.update_compose_at_path(req.path, req.compose_content)}
    except Exception as exc:
        _raise_http(exc)


@router.get("/projects/env")
async def project_env_read(path: str = Query(...)) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": compose_manager.get_env_at_path(path)}
    except Exception as exc:
        _raise_http(exc)


@router.put("/projects/env")
async def project_env_update(req: ProjectEnvUpdateRequest) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": compose_manager.update_env_at_path(req.path, req.content)}
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
        return {"status": "success", "data": compose_manager.inspect_folder(req.path)}
    except Exception as exc:
        _raise_http(exc)


@router.post("/projects/validate-content")
async def project_validate_content(req: ProjectValidateContentRequest) -> Dict[str, Any]:
    try:
        result = compose_manager.validate_compose_content(req.compose_content)
        return {"status": "success" if result["status"] == "success" else "error", "data": result}
    except Exception as exc:
        _raise_http(exc)


@router.post("/projects/create")
async def project_create(req: ProjectCreateRequest, user: Optional[Dict[str, Any]] = Depends(optional_user)) -> Dict[str, Any]:
    try:
        template_payload = req.template.model_dump() if req.template else None
        project = compose_manager.create_project(
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
                actor=(user or {}).get("username"),
                payload={"path": project["path"], "project_name": project["project_name"]},
                handler=_compose_deploy_job_handler,
                args=(project["path"],),
            )
            job_id = job.id
            record_audit(
                "docker.project_create",
                module="docker_manager",
                target=project["path"],
                actor=(user or {}).get("username"),
                actor_id=(user or {}).get("id"),
                meta={"job_id": job.id, "project_name": project["project_name"], "source": req.source},
            )
        return {"status": "success", "data": project, "job_id": job_id}
    except Exception as exc:
        _raise_http(exc)


@router.post("/compose/deploy")
async def compose_deploy_job(req: ComposeUpRequest, user: Optional[Dict[str, Any]] = Depends(optional_user)) -> Dict[str, Any]:
    """Run compose deploy (pull, build local images if needed, up -d) as a background job."""

    job = job_manager.submit(
        kind="docker_manager.compose_deploy",
        title=f"Compose deploy {req.path}",
        module="docker_manager",
        actor=(user or {}).get("username"),
        payload={"path": req.path},
        handler=_compose_deploy_job_handler,
        args=(req.path,),
    )
    record_audit(
        "docker.compose_deploy",
        module="docker_manager",
        target=req.path,
        actor=(user or {}).get("username"),
        actor_id=(user or {}).get("id"),
        meta={"job_id": job.id},
    )
    return {"status": "success", "job_id": job.id}
