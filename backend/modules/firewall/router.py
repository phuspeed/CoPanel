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
    has_ufw = shutil.which("ufw") or Path("/usr/sbin/ufw").exists() or Path("/sbin/ufw").exists()
    if not IS_WINDOWS and not has_ufw:
        return {
            "status": "success",
            "active": False,
            "rules": [],
            "error_message": "UFW Firewall is not installed on this system."
        }

    try:
        # Check ufw status without requiring sudo if we are root
        if shutil.which("sudo"):
            out = run_cmd(["sudo", "ufw", "status"])
        else:
            out = run_cmd(["ufw", "status"])
        
        if not out or "Status:" not in out:
            out = run_cmd(["/usr/sbin/ufw", "status"]) or run_cmd(["/sbin/ufw", "status"])
            
        is_active = "Status: active" in out

        # Extract rules
        # Format of rule lines: "22/tcp                     ALLOW       Anywhere"
        rules = []
        lines = out.splitlines()
        for line in lines:
            if "ALLOW" in line or "DENY" in line:
                parts = re.split(r'\s{2,}', line.strip())
                if len(parts) >= 2:
                    rules.append({
                        "port": parts[0],
                        "action": parts[1].replace(" IN", ""),
                        "comment": parts[2] if len(parts) > 2 else ""
                    })

        return {
            "status": "success",
            "active": is_active,
            "rules": rules
        }
    except Exception as e:
        # Prevent crash if command fails
        return {
            "status": "success",
            "active": False,
            "rules": [],
            "error_message": f"Failed to execute UFW status check: {str(e)}"
        }




def run_ufw_cmd(action: str, port: str) -> bool:
    """Helper to run UFW commands natively or with sudo."""
    import shutil
    from pathlib import Path
    ufw_path = shutil.which("ufw") or ("/usr/sbin/ufw" if Path("/usr/sbin/ufw").exists() else "/sbin/ufw")
    try:
        res = subprocess.run([ufw_path, action, port], shell=False, capture_output=True, text=True)
        if res.returncode == 0:
            return True
    except Exception:
        pass

    if shutil.which("sudo"):
        try:
            res = subprocess.run(["sudo", ufw_path, action, port], shell=False, capture_output=True, text=True)
            if res.returncode == 0:
                return True
        except Exception:
            pass

    return False


def run_ufw_delete_cmd(action: str, port: str) -> bool:
    """Helper to run UFW delete commands natively or with sudo."""
    import shutil
    from pathlib import Path
    ufw_path = shutil.which("ufw") or ("/usr/sbin/ufw" if Path("/usr/sbin/ufw").exists() else "/sbin/ufw")
    try:
        res = subprocess.run([ufw_path, "delete", action, port], shell=False, capture_output=True, text=True)
        if res.returncode == 0:
            return True
    except Exception:
        pass

    if shutil.which("sudo"):
        try:
            res = subprocess.run(["sudo", ufw_path, "delete", action, port], shell=False, capture_output=True, text=True)
            if res.returncode == 0:
                return True
        except Exception:
            pass

    return False


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
        MOCK_RULES = [r for r in MOCK_RULES if not (r["port"] == req.port and r["action"] == req.action.upper())]
        if len(MOCK_RULES) == original_count:
            raise HTTPException(status_code=404, detail="Rule not found in Mock Mode.")
        return {
            "status": "success",
            "message": "Firewall rule deleted successfully (Mock Mode)."
        }

    try:
        if not run_ufw_delete_cmd(req.action.lower(), req.port):
            raise HTTPException(status_code=500, detail="Failed to delete firewall rule via ufw CLI.")

        return {
            "status": "success",
            "message": "Firewall rule deleted successfully."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
