"""
Web Manager Module Router
Manages Nginx sites-available and sites-enabled.
"""
import os
import re
import subprocess
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

IS_WINDOWS = os.name == 'nt'

# Directories for Nginx configuration files
if IS_WINDOWS:
    SITES_AVAILABLE = os.path.abspath("./test_nginx/sites-available")
    SITES_ENABLED = os.path.abspath("./test_nginx/sites-enabled")
else:
    SITES_AVAILABLE = "/etc/nginx/sites-available"
    SITES_ENABLED = "/etc/nginx/sites-enabled"

# Create directories on development (and ensure available in testing)
os.makedirs(SITES_AVAILABLE, exist_ok=True)
os.makedirs(SITES_ENABLED, exist_ok=True)

# Helper: Parse domain names and root paths from Nginx config text
def parse_nginx_config(content: str) -> Dict[str, str]:
    """Parse domain name and root path from nginx config content."""
    server_names = re.findall(r'server_name\s+([^;]+);', content)
    roots = re.findall(r'root\s+([^;]+);', content)
    
    server_name = server_names[0].strip() if server_names else "unknown"
    root_path = roots[0].strip() if roots else "unknown"
    
    return {
        "domain": server_name,
        "root": root_path
    }

# Schemas
class CreateSiteRequest(BaseModel):
    filename: Optional[str] = None
    domain: str
    root: str
    port: Optional[int] = 80
    proxy_port: Optional[int] = None
    php_version: Optional[str] = None
    php_modules: Optional[List[str]] = None

class ToggleSiteRequest(BaseModel):
    filename: str
    active: bool

class DeleteSiteRequest(BaseModel):
    filename: str

class UpdateSiteRequest(BaseModel):
    filename: str
    content: str



@router.get("/list")
async def list_sites() -> Dict[str, Any]:
    """List all available sites and their status."""
    try:
        sites = []
        for filename in os.listdir(SITES_AVAILABLE):
            file_path = os.path.join(SITES_AVAILABLE, filename)
            if not os.path.isfile(file_path):
                continue
            
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

            parsed = parse_nginx_config(content)
            
            # Check if active (symlink exists in sites-enabled or file copy in Windows)
            enabled_path = os.path.join(SITES_ENABLED, filename)
            is_active = os.path.exists(enabled_path)

            sites.append({
                "filename": filename,
                "domain": parsed["domain"],
                "root": parsed["root"],
                "active": is_active,
                "content": content
            })

        return {
            "status": "success",
            "sites": sites
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create")
async def create_site(req: CreateSiteRequest) -> Dict[str, Any]:
    """Create a new Nginx site from a basic template."""
    try:
        # Auto-generate filename if not provided
        fname = req.filename
        if not fname or fname.strip() == "":
            domain_name = req.domain.strip().lower()
            domain_name = re.sub(r'^(https?://)?(www\.)?', '', domain_name)
            fname = f"{domain_name}.conf"

        safe_filename = re.sub(r'[^a-zA-Z0-9_.-]', '', fname)
        file_path = os.path.join(SITES_AVAILABLE, safe_filename)
        enabled_path = os.path.join(SITES_ENABLED, safe_filename)

        if os.path.exists(file_path):
            raise HTTPException(status_code=400, detail="Site configuration file already exists.")

        # Generate server_name string: include www alias for domain names
        server_name_str = req.domain
        if not req.domain.startswith("www.") and "." in req.domain and not req.domain.replace(".", "").isdigit():
            server_name_str += f" www.{req.domain}"

        # Create basic template
        if req.proxy_port:
            template = f"""server {{
    listen {req.port};
    server_name {server_name_str};
    client_max_body_size 500M;

    location / {{
        proxy_pass http://127.0.0.1:{req.proxy_port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }}
}}
"""
        elif req.php_version:
            # PHP Template
            template = f"""server {{
    listen {req.port};
    server_name {server_name_str};
    root {req.root};
    client_max_body_size 500M;

    index index.php index.html index.htm;

    location / {{
        try_files $uri $uri/ /index.php?$query_string;
    }}

    location ~ \.php$ {{
        include fastcgi_params;
        fastcgi_pass unix:/run/php/php{req.php_version}-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }}

    location ~ /\.ht {{
        deny all;
    }}
}}
"""
        else:
            template = f"""server {{
    listen {req.port};
    server_name {server_name_str};
    root {req.root};
    client_max_body_size 500M;

    index index.html index.htm;

    location / {{
        try_files $uri $uri/ =404;
    }}
}}
"""


        # Ensure that document root directory exists
        if req.root and req.root.strip() != "":
            try:
                os.makedirs(req.root.strip(), exist_ok=True)
            except Exception:
                pass

        with open(file_path, "w", encoding="utf-8") as f:
            f.write(template)

        # On Linux, if PHP is selected and modules are requested, install them
        if not IS_WINDOWS and req.php_version and req.php_modules:
            try:
                import shutil
                pkg_manager = "apt-get" if shutil.which("apt-get") else ("yum" if shutil.which("yum") else None)
                if pkg_manager == "apt-get":
                    pkgs = [f"php{req.php_version}-{m}" for m in req.php_modules]
                    subprocess.run(["sudo", "apt-get", "install", "-y"] + pkgs, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                elif pkg_manager == "yum":
                    pkgs = [f"php-{m}" for m in req.php_modules]
                    subprocess.run(["sudo", "yum", "install", "-y"] + pkgs, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception:
                pass

        # Automatically activate the new site
        if not os.path.exists(enabled_path):
            if IS_WINDOWS:
                import shutil
                shutil.copy2(file_path, enabled_path)
            else:
                os.symlink(file_path, enabled_path)

        # Test and reload on Linux
        if not IS_WINDOWS:
            try:
                subprocess.run(["nginx", "-t"], check=True, capture_output=True, text=True)
                subprocess.run(["systemctl", "reload", "nginx"], check=True, capture_output=True, text=True)
            except subprocess.CalledProcessError as e:
                # Revert if nginx -t fails
                if os.path.exists(enabled_path):
                    if os.path.islink(enabled_path):
                        os.unlink(enabled_path)
                    else:
                        os.remove(enabled_path)
                if os.path.exists(file_path):
                    os.remove(file_path)
                raise HTTPException(
                    status_code=400,
                    detail=f"Nginx configuration invalid: {e.stderr}"
                )

        return {
            "status": "success",
            "message": "Nginx site created and activated successfully."
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/toggle")
async def toggle_site(req: ToggleSiteRequest) -> Dict[str, Any]:
    """Enable or disable an Nginx site by creating or deleting its link."""
    try:
        safe_filename = re.sub(r'[^a-zA-Z0-9_.-]', '', req.filename)
        available_path = os.path.join(SITES_AVAILABLE, safe_filename)
        enabled_path = os.path.join(SITES_ENABLED, safe_filename)

        if not os.path.exists(available_path):
            raise HTTPException(status_code=404, detail="Site configuration not found in sites-available.")

        if req.active:
            # Activate site
            if not os.path.exists(enabled_path):
                if IS_WINDOWS:
                    # Windows symlink fallback: file copy
                    import shutil
                    shutil.copy2(available_path, enabled_path)
                else:
                    os.symlink(available_path, enabled_path)
        else:
            # Deactivate site
            if os.path.exists(enabled_path):
                if os.path.islink(enabled_path):
                    os.unlink(enabled_path)
                else:
                    os.remove(enabled_path)

        # Test and reload on Linux
        if not IS_WINDOWS:
            try:
                subprocess.run(["nginx", "-t"], check=True, capture_output=True, text=True)
                subprocess.run(["systemctl", "reload", "nginx"], check=True, capture_output=True, text=True)
            except subprocess.CalledProcessError as e:
                # Revert if nginx -t fails
                if req.active and os.path.exists(enabled_path):
                    if os.path.islink(enabled_path):
                        os.unlink(enabled_path)
                    else:
                        os.remove(enabled_path)
                raise HTTPException(
                    status_code=400,
                    detail=f"Nginx configuration invalid: {e.stderr}"
                )

        return {
            "status": "success",
            "message": f"Site {'enabled' if req.active else 'disabled'} successfully."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/delete")
async def delete_site(req: DeleteSiteRequest) -> Dict[str, Any]:
    """Delete site configuration from sites-available and sites-enabled."""
    try:
        safe_filename = re.sub(r'[^a-zA-Z0-9_.-]', '', req.filename)
        available_path = os.path.join(SITES_AVAILABLE, safe_filename)
        enabled_path = os.path.join(SITES_ENABLED, safe_filename)

        # Remove from sites-enabled first
        if os.path.exists(enabled_path):
            if os.path.islink(enabled_path):
                os.unlink(enabled_path)
            else:
                os.remove(enabled_path)

        # Remove from sites-available
        if os.path.exists(available_path):
            os.remove(available_path)

        # Reload Nginx on Linux
        if not IS_WINDOWS:
            subprocess.run(["nginx", "-t"], check=False)
            subprocess.run(["systemctl", "reload", "nginx"], check=False)

        return {
            "status": "success",
            "message": "Nginx site removed completely."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/update")
async def update_site(req: UpdateSiteRequest) -> Dict[str, Any]:
    """Update Nginx or Apache site configuration, test syntax, and reload."""
    import shutil
    try:
        safe_filename = re.sub(r'[^a-zA-Z0-9_.-]', '', req.filename)
        available_path = os.path.join(SITES_AVAILABLE, safe_filename)

        if not os.path.exists(available_path):
            raise HTTPException(status_code=404, detail="Site configuration not found.")

        # Read original backup
        with open(available_path, "r", encoding="utf-8", errors="ignore") as f:
            backup_content = f.read()

        # Write new content
        with open(available_path, "w", encoding="utf-8") as f:
            f.write(req.content)

        # Test configuration syntax and reload on Linux
        if not IS_WINDOWS:
            # Check Nginx
            if os.path.exists("/etc/nginx") or shutil.which("nginx"):
                try:
                    subprocess.run(["nginx", "-t"], check=True, capture_output=True, text=True)
                    subprocess.run(["systemctl", "reload", "nginx"], check=True, capture_output=True, text=True)
                except subprocess.CalledProcessError as e:
                    # Restore backup
                    with open(available_path, "w", encoding="utf-8") as f:
                        f.write(backup_content)
                    raise HTTPException(
                        status_code=400,
                        detail=f"Nginx configuration syntax error:\n{e.stderr or e.stdout}"
                    )
            # Fallback to Apache if applicable
            elif os.path.exists("/etc/apache2") or shutil.which("apache2ctl"):
                try:
                    subprocess.run(["apache2ctl", "configtest"], check=True, capture_output=True, text=True)
                    subprocess.run(["systemctl", "reload", "apache2"], check=True, capture_output=True, text=True)
                except subprocess.CalledProcessError as e:
                    # Restore backup
                    with open(available_path, "w", encoding="utf-8") as f:
                        f.write(backup_content)
                    raise HTTPException(
                        status_code=400,
                        detail=f"Apache configuration syntax error:\n{e.stderr or e.stdout}"
                    )

        return {
            "status": "success",
            "message": "Configuration saved and reloaded successfully."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

