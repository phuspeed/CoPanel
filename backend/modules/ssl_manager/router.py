"""
SSL Manager Router
Exposes FastAPI endpoints for managing SSL Certificates for domains.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List
from pydantic import BaseModel
from .logic import SSLManager

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

class IssueCertbotRequest(BaseModel):
    domain: str
    email: str

class CustomSSLRequest(BaseModel):
    domain: str
    private_key: str
    certificate: str

@router.get("/certificates")
def get_certificates() -> Dict[str, Any]:
    """Retrieve all domains and active SSL statuses."""
    try:
        certs = SSLManager.get_certificates()
        return {"status": "success", "data": certs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/issue")
def issue_certbot(req: IssueCertbotRequest) -> Dict[str, Any]:
    """Obtain a free Let's Encrypt certificate via Certbot."""
    try:
        res = SSLManager.issue_certbot(req.domain, req.email)
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/custom")
def install_custom_ssl(req: CustomSSLRequest) -> Dict[str, Any]:
    """Upload or install a user's pasted SSL certificate and private key."""
    try:
        res = SSLManager.install_custom_ssl(req.domain, req.private_key, req.certificate)
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/renew")
def renew_certificates() -> Dict[str, Any]:
    """Renew all available Let's Encrypt certificates."""
    try:
        res = SSLManager.renew_certificates()
        if res.get("status") == "error":
            raise HTTPException(status_code=400, detail=res["message"])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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

