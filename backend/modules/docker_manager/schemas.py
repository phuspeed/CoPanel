from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ContainerActionRequest(BaseModel):
    container_id: str


class ContainerRenameRequest(BaseModel):
    container_id: str
    new_name: str


class ContainerExecRequest(BaseModel):
    container_id: str
    command: List[str] = Field(default_factory=list)


class ComposePathRequest(BaseModel):
    path: str


class ComposeLogsQuery(BaseModel):
    path: str
    tail: int = 100
    since: Optional[str] = None
    timestamps: bool = False
    follow: bool = False


class ComposeUpRequest(BaseModel):
    path: str
    detach: bool = True


class ComposeBuildRequest(BaseModel):
    path: str
    no_cache: bool = False


class StackInitRequest(BaseModel):
    stack_id: str
    image: str = "nginx:alpine"
    host_port: int = 8080
    container_port: int = 80


class StackComposeUpdateRequest(BaseModel):
    compose_content: str


class DockerResponse(BaseModel):
    status: str
    message: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
