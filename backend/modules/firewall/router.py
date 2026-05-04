"""
Firewall Module Router
Manages ufw firewall rules.
"""
import os
import re
import subprocess
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

IS_WINDOWS = os.name == 'nt'

# Global mock data for non-Linux testing
MOCK_RULES = [
    {"port": "22/tcp", "action": "ALLOW", "comment": "Default SSH"},
    {"port": "80/tcp", "action": "ALLOW", "comment": "Web Traffic"},
    {"port": "8686/tcp", "action": "ALLOW", "comment": "CoPanel Web UI"}
]
MOCK_STATUS = "active"

# Schemas
class RuleRequest(BaseModel):
    port: str = Field(..., description="e.g. 80, 443/tcp")
    action: str = Field("ALLOW", description="ALLOW or DENY")
    comment: Optional[str] = ""

class DeleteRuleRequest(BaseModel):
    port: str
    action: str

class UnbanRequest(BaseModel):
    jail: str
    ip: str


def find_ufw_path() -> str:
    import shutil
    import os
    for p in ["/usr/sbin/ufw", "/sbin/ufw", "/usr/bin/ufw", "/bin/ufw"]:
        if os.path.exists(p) and os.access(p, os.X_OK):
            return p
    w = shutil.which("ufw")
    if w:
        return w
    return "ufw"


def run_cmd(cmd: List[str]) -> str:
    """Run system command using subprocess safely."""
    try:
        res = subprocess.run(cmd, shell=False, capture_output=True, text=True, check=False)
        return res.stdout if res.returncode == 0 else res.stderr
    except Exception as e:
        return ""


@router.get("/status")
async def get_firewall_status() -> Dict[str, Any]:
    """Get status and rules list from ufw."""
    global MOCK_STATUS, MOCK_RULES
    if IS_WINDOWS:
        return {
            "status": "success",
            "active": MOCK_STATUS == "active",
            "rules": MOCK_RULES
        }

    import shutil
    from pathlib import Path
    ufw_path = find_ufw_path()
    has_ufw = shutil.which("ufw") or Path(ufw_path).exists()
    if not IS_WINDOWS and not has_ufw:
        return {
            "status": "success",
            "active": False,
            "rules": [],
            "error_message": "UFW Firewall is not installed on this system."
        }

    try:
        # Run ufw status numbered to get ports and numbers correctly
        res = subprocess.run([ufw_path, "status"], shell=False, capture_output=True, text=True, check=False)
        out = res.stdout if res.returncode == 0 else res.stderr

        is_active = "Status: active" in out

        # Extract rules
        # Format of rule lines:
        # 22/tcp                     ALLOW       Anywhere
        # 80                         ALLOW       Anywhere
        rules = []
        lines = out.splitlines()
        for line in lines:
            line_strip = line.strip()
            if not line_strip or "Status:" in line_strip or "To " in line_strip or "Action " in line_strip or "---" in line_strip:
                continue
            
            match = re.search(r'^(.*?)\s+(ALLOW(?:\s+IN)?|DENY(?:\s+IN)?)\s+(.*?)$', line_strip, re.IGNORECASE)
            if match:
                port = match.group(1).strip()
                action = match.group(2).replace(" IN", "").replace(" in", "").strip().upper()
                comment = match.group(3).strip()

                if "(v6)" in port:
                    continue

                rules.append({
                    "port": port,
                    "action": action,
                    "comment": comment
                })

        return {
            "status": "success",
            "active": is_active,
            "rules": rules
        }
    except Exception as e:
        return {
            "status": "success",
            "active": False,
            "rules": [],
            "error_message": f"Failed to execute UFW status check: {str(e)}"
        }


def run_ufw_cmd(action: str, port: str) -> bool:
    """Helper to run UFW commands natively."""
    ufw_path = find_ufw_path()
    try:
        # Allow/Deny rule
        res = subprocess.run([ufw_path, action, port], shell=False, capture_output=True, text=True)
        if res.returncode == 0:
            return True
    except Exception:
        pass
    return False


def run_ufw_delete_cmd(action: str, port: str) -> bool:
    """Helper to run UFW delete commands."""
    ufw_path = find_ufw_path()
    try:
        res = subprocess.run([ufw_path, "delete", action, port], input="y\n", shell=False, capture_output=True, text=True)
        if res.returncode == 0:
            return True
    except Exception:
        pass
    return False


@router.post("/enable")
async def enable_firewall() -> Dict[str, Any]:
    """Enable UFW firewall."""
    global MOCK_STATUS
    if IS_WINDOWS:
        MOCK_STATUS = "active"
        return {"status": "success", "message": "Firewall enabled successfully (Mock Mode)."}
    ufw_path = find_ufw_path()
    try:
        # Before enabling, we must ensure SSH port 22 is open so users don't get locked out!
        subprocess.run([ufw_path, "allow", "22"], shell=False, check=False)
        # Enable
        res = subprocess.run([ufw_path, "enable"], input="y\n", shell=False, capture_output=True, text=True)
        if res.returncode == 0:
            return {"status": "success", "message": "Firewall enabled successfully."}
        raise HTTPException(status_code=500, detail=res.stderr or "Failed to enable firewall.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/disable")
async def disable_firewall() -> Dict[str, Any]:
    """Disable UFW firewall."""
    global MOCK_STATUS
    if IS_WINDOWS:
        MOCK_STATUS = "inactive"
        return {"status": "success", "message": "Firewall disabled successfully (Mock Mode)."}
    ufw_path = find_ufw_path()
    try:
        res = subprocess.run([ufw_path, "disable"], shell=False, capture_output=True, text=True)
        if res.returncode == 0:
            return {"status": "success", "message": "Firewall disabled successfully."}
        raise HTTPException(status_code=500, detail=res.stderr or "Failed to disable firewall.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add")
async def add_firewall_rule(req: RuleRequest) -> Dict[str, Any]:
    """Add a rule to the firewall."""
    global MOCK_RULES

    # Always enforce SSH safety check
    if "22" in req.port and req.action.upper() == "DENY":
        raise HTTPException(
            status_code=400,
            detail="Cannot add a rule blocking SSH port 22 to prevent lockout."
        )

    if IS_WINDOWS:
        # Check if rule exists
        for rule in MOCK_RULES:
            if rule["port"] == req.port:
                raise HTTPException(status_code=400, detail="Rule already exists.")
        MOCK_RULES.append({
            "port": req.port,
            "action": req.action.upper(),
            "comment": req.comment or ""
        })
        return {
            "status": "success",
            "message": "Firewall rule added successfully (Mock Mode)."
        }

    try:
        if not run_ufw_cmd(req.action.lower(), req.port):
            raise HTTPException(status_code=500, detail="Failed to apply firewall rule via ufw CLI.")

        return {
            "status": "success",
            "message": "Firewall rule added successfully."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/delete")
async def delete_firewall_rule(req: DeleteRuleRequest) -> Dict[str, Any]:
    """Delete a rule from the firewall."""
    global MOCK_RULES

    # Enforce SSH safety check
    if "22" in req.port:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete SSH rule for port 22 to prevent lockout."
        )

    if IS_WINDOWS:
        original_count = len(MOCK_RULES)
        MOCK_RULES = [r for r in MOCK_RULE