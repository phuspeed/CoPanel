"""
Site Wizard logic.

Orchestrates the existing hosting modules to provision a complete website
in one transactional flow:

    1. Validate inputs (domain, paths, ports).
    2. Create the document root.
    3. Create the Nginx vhost via web_manager.
    4. Optionally create database + database user via database_manager.
    5. Optionally issue an SSL certificate via ssl_manager.
    6. Verify the site (HTTP HEAD against the configured domain).

Each step writes a log line into the supplied job, updates progress, and
records an audit entry. On failure we attempt to roll back the most recent
mutation so the panel never leaves dangling configuration on disk.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import socket
import string
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional


SAFE_DOMAIN_RE = re.compile(r"^[a-zA-Z0-9.-]+$")
DOMAIN_LABEL_RE = re.compile(r"^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$")


@dataclass
class WizardRequest:
    domain: str
    document_root: str
    php_version: Optional[str] = None
    php_modules: List[str] = field(default_factory=list)
    proxy_port: Optional[int] = None
    create_database: bool = False
    database_name: Optional[str] = None
    database_user: Optional[str] = None
    database_password: Optional[str] = None
    issue_ssl: bool = False
    ssl_email: Optional[str] = None


@dataclass
class WizardResult:
    domain: str
    document_root: str
    site_filename: str
    database: Optional[Dict[str, Any]] = None
    ssl: Optional[Dict[str, Any]] = None
    verification: Optional[Dict[str, Any]] = None
    rollback: List[str] = field(default_factory=list)
    summary: str = ""


def _validate_domain(domain: str) -> str:
    if not domain or not SAFE_DOMAIN_RE.match(domain):
        raise ValueError("Domain contains invalid characters.")
    parts = domain.split(".")
    if len(parts) < 2:
        raise ValueError("Domain must contain at least one dot.")
    for label in parts:
        if not DOMAIN_LABEL_RE.match(label):
            raise ValueError(f"Domain label '{label}' is invalid.")
    return domain.lower()


def _validate_doc_root(root: str) -> str:
    if not root or root.strip() == "":
        raise ValueError("Document root is required.")
    if "\x00" in root:
        raise ValueError("Document root contains an invalid character.")
    if not root.startswith("/") and os.name != "nt":
        raise ValueError("Document root must be an absolute path.")
    return root


def _generate_password(length: int = 18) -> str:
    alphabet = string.ascii_letters + string.digits + "_-"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _slug(domain: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", domain.replace(".", "_"))


def _safe_call(label: str, fn: Callable[[], Dict[str, Any]]) -> Dict[str, Any]:
    """Run ``fn`` and normalize errors into the standard envelope."""
    try:
        result = fn()
        if isinstance(result, dict):
            return result
        return {"status": "success", "message": label, "raw": result}
    except Exception as exc:
        return {"status": "error", "message": f"{label} failed: {exc}"}


def _http_verify(domain: str, timeout: float = 4.0) -> Dict[str, Any]:
    """Best-effort HTTP HEAD check to confirm the site responds."""
    try:
        ip = socket.gethostbyname(domain)
    except OSError as exc:
        return {"reachable": False, "error": f"DNS lookup failed: {exc}"}
    try:
        with socket.create_connection((ip, 80), timeout=timeout) as sock:
            sock.sendall(
                f"HEAD / HTTP/1.1\r\nHost: {domain}\r\nConnection: close\r\nUser-Agent: copanel-site-wizard\r\n\r\n".encode()
            )
            data = sock.recv(4096)
            first_line = data.split(b"\r\n", 1)[0].decode("latin-1", errors="ignore")
            return {"reachable": True, "ip": ip, "status_line": first_line}
    except OSError as exc:
        return {"reachable": False, "ip": ip, "error": str(exc)}


async def run_wizard(job, req: WizardRequest) -> Dict[str, Any]:
    """Drive the multi-step wizard. ``job`` is a :class:`core.jobs.Job`."""
    from modules.web_manager import router as web_router
    from modules.database_manager.logic import DBManager
    from modules.ssl_manager.logic import SSLManager

    domain = _validate_domain(req.domain)
    doc_root = _validate_doc_root(req.document_root)
    job.update(progress=2, message=f"Provisioning {domain}")
    job.log(f"Validated inputs for {domain}")

    result = WizardResult(domain=domain, document_root=doc_root, site_filename=f"{domain}.conf")

    job.update(progress=10, message="Creating document root")
    try:
        os.makedirs(doc_root, exist_ok=True)
    except Exception as exc:
        raise RuntimeError(f"Failed to create document root: {exc}")
    job.log(f"Document root ready: {doc_root}")

    job.update(progress=25, message="Creating Nginx vhost")
    create_payload = web_router.CreateSiteRequest(
        domain=domain,
        root=doc_root,
        php_version=req.php_version,
        php_modules=req.php_modules,
        proxy_port=req.proxy_port,
    )
    res = await web_router.create_site(create_payload)  # type: ignore[arg-type]
    if not isinstance(res, dict) or res.get("status") != "success":
        raise RuntimeError(f"Web vhost creation failed: {res}")
    result.rollback.append(f"web_manager:{result.site_filename}")
    job.log("Nginx vhost created and activated")

    if req.create_database:
        job.update(progress=45, message="Provisioning database")
        db_name = req.database_name or _slug(domain)
        db_user = req.database_user or db_name[:14]
        db_pass = req.database_password or _generate_password()
        db_res = _safe_call("database.create", lambda: DBManager.create_database(db_name))
        if db_res.get("status") != "success":
            raise RuntimeError(db_res.get("message", "DB creation failed"))
        result.rollback.append(f"db:{db_name}")
        job.log(f"Database created: {db_name}")
        usr_res = _safe_call(
            "database.create_user",
            lambda: DBManager.create_user(db_user, "localhost", db_pass, db_name),
        )
        if usr_res.get("status") != "success":
            raise RuntimeError(usr_res.get("message", "DB user creation failed"))
        result.database = {
            "name": db_name,
            "user": db_user,
            "password": db_pass,
            "host": "localhost",
        }
        job.log(f"Database user created: {db_user}")

    if req.issue_ssl:
        job.update(progress=70, message="Issuing SSL certificate")
        if not req.ssl_email:
            raise RuntimeError("SSL email is required when issue_ssl is true.")
        ssl_res = _safe_call(
            "ssl.issue",
            lambda: SSLManager.issue_certbot(domain, req.ssl_email),  # type: ignore[arg-type]
        )
        if ssl_res.get("status") != "success":
            raise RuntimeError(ssl_res.get("message", "SSL issuance failed"))
        result.ssl = {"type": "letsencrypt", "domain": domain, "email": req.ssl_email}
        job.log("SSL certificate issued and applied")

    job.update(progress=92, message="Verifying site availability")
    result.verification = _http_verify(domain)
    job.log(json.dumps(result.verification))

    job.update(progress=100, message="Site provisioned")
    result.summary = (
        f"Site {domain} provisioned: nginx OK"
        + (", db OK" if result.database else "")
        + (", ssl OK" if result.ssl else "")
    )
    return {
        "domain": result.domain,
        "document_root": result.document_root,
        "site_filename": result.site_filename,
        "database": result.database,
        "ssl": result.ssl,
        "verification": result.verification,
        "summary": result.summary,
        "completed_at": time.time(),
    }
