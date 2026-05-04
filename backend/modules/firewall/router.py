"""
Firewall Module Router
Manages ufw firewall rules and Fail2Ban intrusion prevention system.
"""
import os
import re
import shutil
import subprocess
from pathlib import Path
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
MOCK_F2B_INSTALLED = True
MOCK_F2B_ACTIVE = True
MOCK_F2B_JAILS = ["sshd"]
MOCK_F2B_BANNED = [{"ip": "192.168.1.100", "jail": "sshd"}]

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
    for p in ["/usr/sbin/ufw", "/sbin/ufw", "/usr/bin/ufw", "/bin/ufw"]:
        if os.path.exists(p) and os.access(p, os.X_OK):
            return p
    w = shutil.which("ufw")
    if w:
        return w
    return "ufw"


def find_fail2ban_path() -> str:
    for p in ["/usr/bin/fail2ban-client", "/bin/fail2ban-client", "/usr/sbin/fail2ban-client", "/sbin/fail2ban-client"]:
        if os.path.exists(p) and os.access(p, os.X_OK):
            return p
    w = shutil.which("fail2ban-client")
    if w:
        return w
    return "fail2ban-client"


def check_fail2ban_installed() -> bool:
    if IS_WINDOWS:
        return MOCK_F2B_INSTALLED
    p = find_fail2ban_path()
    if p and p != "fail2ban-client":
        return True
    return bool(shutil.which("fail2ban-client"))


def run_cmd(cmd: List[str]) -> str:
    """Run system command using subprocess safely."""
    try:
        res = subprocess.run(cmd, shell=False, capture_output=True, text=True, check=False)
        return res.stdout if res.returncode == 0 else res.stderr
    except Exception:
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

    ufw_path = find_ufw_path()
    has_ufw = shutil.which("ufw") or Path(ufw_path).exists()
    if not has_ufw:
        return {
            "status": "success",
            "active": False,
            "rules": [],
            "error_message": "UFW Firewall is not installed on this system."
        }

    try:
        res = subprocess.run([ufw_path, "status"], shell=False, capture_output=True, text=True, check=False)
        out = res.stdout if res.returncode == 0 else res.stderr

        is_active = "Status: active" in out

        # Extract rules
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
        subprocess.run([ufw_path, "allow", "22"], shell=False, check=False)
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

    if "22" in req.port and req.action.upper() == "DENY":
        raise HTTPException(
            status_code=400,
            detail="Cannot add a rule blocking SSH port 22 to prevent lockout."
        )

    if IS_WINDOWS:
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


# --- FAIL2BAN SPECIFIC ENDPOINTS ---

@router.get("/fail2ban/status")
async def get_fail2ban_status() -> Dict[str, Any]:
    """Fetch real Fail2Ban status and banned IPs list."""
    global MOCK_F2B_ACTIVE, MOCK_F2B_JAILS, MOCK_F2B_BANNED
    
    installed = check_fail2ban_installed()
    if not installed:
        return {
            "status": "success",
            "installed": False,
            "active": False,
            "jails": [],
            "banned": []
        }

    if IS_WINDOWS:
        return {
            "status": "success",
            "installed": True,
            "active": MOCK_F2B_ACTIVE,
            "jails": MOCK_F2B_JAILS,
            "banned": MOCK_F2B_BANNED
        }

    f2b_path = find_fail2ban_path()
    try:
        # Check if fail2ban systemd service is active or fail2ban-client is responding
        ping_res = subprocess.run([f2b_path, "ping"], shell=False, capture_output=True, text=True)
        is_active = "Server echoed pong" in ping_res.stdout
        
        # Get all Jails
        res = subprocess.run([f2b_path, "status"], shell=False, capture_output=True, text=True)
        jails = []
        if res.returncode == 0:
            match = re.search(r'Jail list:\s+(.+)', res.stdout)
            if match:
                jails = [j.strip() for j in match.group(1).split(',')]
                
        # Get banned IPs for each jail
        banned = []
        for jail in jails:
            jres = subprocess.run([f2b_path, "status", jail], shell=False, capture_output=True, text=True)
            if jres.returncode == 0:
                ip_match = re.search(r'Banned IP list:\s+(.+)', jres.stdout)
                if ip_match:
                    ips = [ip.strip() for ip in ip_match.group(1).split(' ') if ip.strip()]
                    for ip in ips:
                        banned.append({"ip": ip, "jail": jail})

        return {
            "status": "success",
            "installed": True,
            "active": is_active,
            "jails": jails,
            "banned": banned
        }
    except Exception as e:
        return {
            "status": "success",
            "installed": True,
            "active": False,
            "jails": [],
            "banned": [],
            "error_message": f"Fail2Ban is installed but unresponsive: {str(e)}"
        }


@router.post("/fail2ban/install")
async def install_fail2ban() -> Dict[str, Any]:
    """Trigger Fail2Ban installation on system."""
    global MOCK_F2B_INSTALLED
    if IS_WINDOWS:
        MOCK_F2B_INSTALLED = True
        return {"status": "success", "message": "Fail2Ban installed successfully (Mock Mode)."}

    # Determine package manager
    try:
        if shutil.which("apt-get"):
            cmd = "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban"
        elif shutil.which("yum"):
            cmd = "sudo yum install -y fail2ban"
        else:
            raise HTTPException(status_code=500, detail="No suitable package manager found.")

        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if res.returncode == 0:
            return {"status": "success", "message": "Fail2Ban installed successfully!"}
        raise HTTPException(status_code=500, detail=res.stderr or "Installation failed.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fail2ban/unban")
async def unban_ip(req: UnbanRequest) -> Dict[str, Any]:
    """Unbans an IP address from a Fail2Ban jail."""
    global MOCK_F2B_BANNED
    if IS_WINDOWS:
        MOCK_F2B_BANNED = [b for b in MOCK_F2B_BANNED if not (b["ip"] == req.ip and b["jail"] == req.jail)]
        return {"status": "success", "message": f"Successfully unbanned IP {req.ip} from {req.jail} (Mock Mode)."}

    f2b_path = find_fail2ban_path()
    try:
        res = subprocess.run([f2b_path, "set", req.jail, "unbanip", req.ip], shell=False, capture_output=True, text=True)
        if res.returncode == 0:
            return {"status": "success", "message": f"Successfully unbanned IP {req.ip} from {req.jail}."}
        raise HTTPException(status_code=500, detail=res.stderr or f"Failed to unban IP {req.ip}.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))