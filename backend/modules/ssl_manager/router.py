"""
SSL Manager Router
Exposes FastAPI endpoints for managing SSL Certificates for domains.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List
from pydantic import BaseModel, Field
from .logic import SSLManager
from .auto_renew import AutoRenewManager

router = APIRouter()


def _expiry_to_days_left(expiry: str) -> int:
    """Parse a Certbot/openssl ``notAfter`` string and return days remaining.

    Returns -1 if the expiry cannot be parsed (caller treats as ``unknown``).
    """
    if not expiry or expiry in {"N/A"}:
        return -1
    candidates = [
        "%b %d %H:%M:%S %Y %Z",
        "%b %d %H:%M:%S %Y GMT",
        "%Y-%m-%d %H:%M:%S",
    ]
    for fmt in candidates:
        try:
            dt = datetime.strptime(expiry.strip(), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return max(-1, (dt - datetime.now(timezone.utc)).days)
        except ValueError:
            continue
    return -1


def _unwrap_result(res: Dict[str, Any]) -> Dict[str, Any]:
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message", "Operation failed."))
    return res


class IssueCertbotRequest(BaseModel):
    domain: str
    email: str


class CustomSSLRequest(BaseModel):
    domain: str
    private_key: str
    certificate: str


class AutoRenewSettingsRequest(BaseModel):
    enabled: bool
    hour: int = Field(default=3, ge=0, le=23)
    minute: int = Field(default=30, ge=0, le=59)


@router.get("/certificates")
def get_certificates() -> Dict[str, Any]:
    """Retrieve all domains and active SSL statuses."""
    try:
        certs = SSLManager.get_certificates()
        enriched = []
        for cert in certs:
            days_left = _expiry_to_days_left(cert.get("expiry", ""))
            enriched.append({**cert, "days_left": days_left})
        return {"status": "success", "data": enriched}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/issue")
def issue_certbot(req: IssueCertbotRequest) -> Dict[str, Any]:
    """Obtain a free Let's Encrypt certificate via Certbot."""
    try:
        return _unwrap_result(SSLManager.issue_certbot(req.domain, req.email))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/custom")
def install_custom_ssl(req: CustomSSLRequest) -> Dict[str, Any]:
    """Upload or install a user's pasted SSL certificate and private key."""
    try:
        return _unwrap_result(SSLManager.install_custom_ssl(req.domain, req.private_key, req.certificate))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/renew")
def renew_certificates() -> Dict[str, Any]:
    """Renew all available Let's Encrypt certificates."""
    try:
        result = _unwrap_result(SSLManager.renew_certificates())
        AutoRenewManager.record_run(result)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/renew/{domain}")
def renew_domain_certificate(domain: str, force: bool = False) -> Dict[str, Any]:
    """Renew a single domain's Let's Encrypt certificate."""
    try:
        return _unwrap_result(SSLManager.renew_domain(domain, force=force))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/auto_renew")
def get_auto_renew_status() -> Dict[str, Any]:
    """Return auto-renew settings, cron state, and last run info."""
    return {"status": "success", "data": AutoRenewManager.get_status()}


@router.post("/auto_renew")
def save_auto_renew_settings(req: AutoRenewSettingsRequest) -> Dict[str, Any]:
    """Enable or disable scheduled certbot renew via CoPanel-managed cron."""
    try:
        data = AutoRenewManager.save_settings(req.enabled, req.hour, req.minute)
        return {"status": "success", "data": AutoRenewManager.get_status(), "message": "Auto-renew settings saved."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/expiry")
def list_expiring(days: int = 30) -> Dict[str, Any]:
    """Return certificates that expire within ``days`` days.

    Used by the dashboard "SSL expiry" widget and by alerting in the future.
    The threshold is configurable so users can build their own renewal cadence.
    """
    out: List[Dict[str, Any]] = []
    for cert in SSLManager.get_certificates():
        if not cert.get("active"):
            continue
        days_left = _expiry_to_days_left(cert.get("expiry", ""))
        out.append({
            **cert,
            "days_left": days_left,
            "expiring_soon": 0 <= days_left <= days,
        })
    return {"status": "success", "data": out}
