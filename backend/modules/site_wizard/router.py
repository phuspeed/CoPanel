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

from .logic import WizardRequest, get_preflight_status, run_wizard
from .templates import TEMPLATES, resolve_wizard_defaults

router = APIRouter()


class WizardCreateRequest(BaseModel):
    domain: str = Field(..., min_length=3, max_length=253)
    document_root: Optional[str] = None
    template_id: Optional[str] = "static"
    php_version: Optional[str] = None
    php_modules: List[str] = []
    proxy_port: Optional[int] = None
    create_database: Optional[bool] = None
    database_name: Optional[str] = None
    database_user: Optional[str] = None
    database_password: Optional[str] = None
    issue_ssl: Optional[bool] = None
    ssl_email: Optional[str] = None


@router.get("/preflight")
def preflight(user: Dict[str, Any] = Depends(require_module("site_wizard"))) -> Dict[str, Any]:
    """Stack readiness for 1-click install UI."""
    return ok(get_preflight_status())


@router.post("/run")
def start_wizard(req: WizardCreateRequest, user: Dict[str, Any] = Depends(require_module("site_wizard"))) -> Dict[str, Any]:
    """Kick off a Site Wizard provisioning job."""
    resolved = resolve_wizard_defaults(
        req.template_id,
        domain=req.domain,
        document_root=req.document_root or "/var/www",
        php_version=req.php_version,
        php_modules=req.php_modules,
        proxy_port=req.proxy_port,
        create_database=req.create_database,
        issue_ssl=req.issue_ssl,
        ssl_email=req.ssl_email,
    )
    if resolved["issue_ssl"] and not resolved["ssl_email"]:
        raise ApiError("VALIDATION_ERROR", "ssl_email is required when issue_ssl is true.", http_status=422)
    if req.create_database and req.database_password and len(req.database_password) < 8:
        raise ApiError("VALIDATION_ERROR", "Database password must be at least 8 characters.", http_status=422)

    payload = WizardRequest(
        domain=req.domain.strip().lower(),
        document_root=resolved["document_root"],
        template_id=resolved["template_id"],
        php_version=resolved["php_version"],
        php_modules=resolved["php_modules"],
        proxy_port=resolved["proxy_port"],
        create_database=resolved["create_database"],
        database_name=req.database_name,
        database_user=req.database_user,
        database_password=req.database_password,
        issue_ssl=resolved["issue_ssl"],
        ssl_email=resolved["ssl_email"],
    )

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
        title=f"Provision {resolved['template_id']}: {req.domain}",
        module="site_wizard",
        actor=user.get("username"),
        payload={**req.dict(exclude={"database_password"}), **resolved},
        handler=_handler,
        args=(payload,),
    )

    record_audit(
        "site_wizard.start",
        module="site_wizard",
        target=req.domain,
        actor=user.get("username"),
        actor_id=user.get("id"),
        meta={"job_id": job.id, "template_id": resolved["template_id"]},
    )
    notifications.notify(
        f"Provisioning {resolved['template_id']} on {req.domain}",
        level="info",
        module="site_wizard",
        actor=user.get("username"),
        action_url=f"/site-wizard?job={job.id}",
    )
    return ok({"job_id": job.id})


@router.get("/templates")
def list_templates(user: Dict[str, Any] = Depends(require_module("site_wizard"))) -> Dict[str, Any]:
    """Return suggested templates for 1-click and custom wizard UI."""
    return ok(TEMPLATES)
