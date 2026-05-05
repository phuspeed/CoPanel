"""
Site Wizard router.

Submits a wizard run as a background job so progress streams through the
unified Task Center (``core.jobs``) and the frontend wizard UI.
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core.api import ApiError, ok
from core.audit import record_audit
from core.auth import require_module
from core.jobs import jobs
from core import notifications

from .logic import WizardRequest, run_wizard

router = APIRouter()


class WizardCreateRequest(BaseModel):
    domain: str = Field(..., min_length=3, max_length=253)
    document_root: str
    php_version: Optional[str] = None
    php_modules: List[str] = []
    proxy_port: Optional[int] = None
    create_database: bool = False
    database_name: Optional[str] = None
    database_user: Optional[str] = None
    database_password: Optional[str] = None
    issue_ssl: bool = False
    ssl_email: Optional[str] = None


@router.post("/run")
def start_wizard(req: WizardCreateRequest, user: Dict[str, Any] = Depends(require_module("site_wizard"))) -> Dict[str, Any]:
    """Kick off a Site Wizard provisioning job."""
    if req.issue_ssl and not req.ssl_email:
        raise ApiError("VALIDATION_ERROR", "ssl_email is required when issue_ssl is true.", http_status=422)
    if req.create_database and req.database_password and len(req.database_password) < 8:
        raise ApiError("VALIDATION_ERROR", "Database password must be at least 8 characters.", http_status=422)

    payload = WizardRequest(**req.dict())

    async def _handler(job, request: WizardRequest):
        try:
            return await run_wizard(job, request)
        except Exception as exc:
            notifications.notify(
                f"Site provisioning failed for {request.domain}",
                level="error",
                module="site_wizard",
                actor=user.get("username"),
                body=str(exc),
            )
            raise

    job = jobs.submit(
        kind="site_wizard.run",
        title=f"Provision site {req.domain}",
        module="site_wizard",
        actor=user.get("username"),
        payload=req.dict(exclude={"database_password"}),
        handler=_handler,
        args=(payload,),
    )

    record_audit(
        "site_wizard.start",
        module="site_wizard",
        target=req.domain,
        actor=user.get("username"),
        actor_id=user.get("id"),
        meta={"job_id": job.id},
    )
    notifications.notify(
        f"Provisioning site {req.domain}",
        level="info",
        module="site_wizard",
        actor=user.get("username"),
        action_url=f"/site-wizard?job={job.id}",
    )
    return ok({"job_id": job.id})


@router.get("/templates")
def list_templates(user: Dict[str, Any] = Depends(require_module("site_wizard"))) -> Dict[str, Any]:
    """Return suggested templates a user can pick from in the wizard UI."""
    templates = [
        {
            "id": "static",
            "name": "Static site",
            "description": "Plain HTML/CSS/JS hosted by Nginx.",
            "php_version": None,
            "create_database": False,
            "issue_ssl": True,
        },
        {
            "id": "wordpress",
            "name": "WordPress",
            "description": "PHP-FPM site with a fresh MySQL database.",
            "php_version": "8.2",
            "php_modules": ["mysqli", "curl", "mbstring", "gd", "zip", "xml", "intl"],
            "create_database": True,
            "issue_ssl": True,
        },
        {
            "id": "laravel",
            "name": "Laravel app",
            "description": "PHP-FPM with composer-friendly defaults.",
            "php_version": "8.3",
            "php_modules": ["mysqli", "curl", "mbstring", "bcmath", "intl", "zip", "xml"],
            "create_database": True,
            "issue_ssl": True,
        },
        {
            "id": "node_proxy",
            "name": "Node / Reverse proxy",
            "description": "Front your Node/Bun/Go app on a port via Nginx.",
            "proxy_port": 3000,
            "create_database": False,
            "issue_ssl": True,
        },
    ]
    return ok(templates)
