"""
SSL Manager Router
Exposes FastAPI endpoints for managing SSL Certificates for domains.
"""
from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from pydantic import BaseModel
from .logic import SSLManager

router = APIRouter()

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

