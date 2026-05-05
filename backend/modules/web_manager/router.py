"""
Web Manager Module Router
Manages Nginx sites-available and sites-enabled.
"""
import os
import re
import shutil
import subprocess
import urllib.request
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


def sanitize_filename(value: str) -> str:
    return re.sub(r'[^a-zA-Z0-9_.-]', '', value)


def _run_with_optional_sudo(cmd: List[str], timeout: int = 120) -> subprocess.CompletedProcess:
    """Run command directly, then fallback to non-interactive sudo on Linux."""
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=True)
    except Exception:
        pass
    if IS_WINDOWS:
        raise subprocess.CalledProcessError(returncode=1, cmd=cmd, stderr="Command failed on Windows mode.")
    return subprocess.run(["sudo", "-n"] + cmd, capture_output=True, text=True, timeout=timeout, check=True)


def _pkg_manager() -> Optional[str]:
    if shutil.which("apt-get"):
        return "apt-get"
    if shutil.which("yum"):
        return "yum"
    return None

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

        safe_filename = sanitize_filename(fname)
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
        safe_filename = sanitize_filename(req.filename)
        available_path = os.path.join(SITES_AVAILABLE, safe_filename)
        enabled_path = os.path.join(SITES_ENABLED, safe_filename)

        if not os.path.exists(available_path):
            raise HTTPException(status_code=404, detail="Site configuration not found in sites-available.")

        if req.active:
            # Activate site
            if not os.path.exists(enabled_path):
                if IS_WINDOWS:
                    # Windows symlink fallback: file copy
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
        safe_filename = sanitize_filename(req.filename)
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
    try:
        safe_filename = sanitize_filename(req.filename)
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

@router.get("/web_services")
async def list_web_services() -> Dict[str, Any]:
    """Retrieve status of main web server services with conflict info."""

    # Conflict rules: if a service is installed/running, it conflicts with others on port 80
    CONFLICT_MAP = {
        "nginx": ["apache2", "litespeed"],
        "apache2": ["nginx", "litespeed"],
        "litespeed": ["nginx", "apache2"],
    }

    services = [
        {"id": "nginx",     "name": "Nginx",           "description": "High-performance HTTP & reverse proxy server.", "installed": False, "status": "not_installed", "conflicts_with": []},
        {"id": "apache2",   "name": "Apache2",          "description": "Battle-tested web server with .htaccess support.", "installed": False, "status": "not_installed", "conflicts_with": []},
        {"id": "litespeed", "name": "OpenLiteSpeed",    "description": "Low-RAM alternative with LSPHP & LSCache support.", "installed": False, "status": "not_installed", "conflicts_with": []},
    ]

    if IS_WINDOWS:
        services[0].update({"installed": True, "status": "running"})
        # Populate conflicts based on installed state
        for s in services:
            if s["installed"]:
                s["conflicts_with"] = CONFLICT_MAP.get(s["id"], [])
        return {"status": "success", "services": services}

    # Query systemctl on Linux
    installed_ids = set()
    for s in services:
        sid = s["id"]
        bin_exists = shutil.which(sid) or shutil.which("openlitespeed" if sid == "litespeed" else sid)
        if bin_exists or os.path.exists(f"/etc/{sid}"):
            s["installed"] = True
            installed_ids.add(sid)
            try:
                res = subprocess.run(["systemctl", "is-active", sid], capture_output=True, text=True)
                s["status"] = "running" if res.stdout.strip() == "active" else "stopped"
            except Exception:
                s["status"] = "stopped"

    # Populate conflicts: only list conflicts that are actually installed
    for s in services:
        s["conflicts_with"] = [c for c in CONFLICT_MAP.get(s["id"], []) if c in installed_ids]

    return {"status": "success", "services": services}


@router.post("/web_services/install_stack")
async def install_web_stack(req: dict) -> Dict[str, Any]:
    """Install a chosen web server stack with conflict guard."""
    stack = req.get("stack", "nginx")  # nginx | apache2 | litespeed | nginx_apache

    if IS_WINDOWS:
        return {"status": "success", "message": f"Stack '{stack}' install simulated (Windows mock)."}

    pkg_manager = "apt-get" if shutil.which("apt-get") else ("yum" if shutil.which("yum") else None)
    if not pkg_manager:
        raise HTTPException(status_code=400, detail="No supported package manager found.")

    install_cmds: List[List[str]] = []

    if stack == "nginx":
        install_cmds.append(["sudo", pkg_manager, "install", "-y", "nginx"])
    elif stack == "apache2":
        pkg = "apache2" if pkg_manager == "apt-get" else "httpd"
        install_cmds.append(["sudo", pkg_manager, "install", "-y", pkg])
    elif stack == "litespeed":
        # OpenLiteSpeed repo install
        install_cmds.append(["sudo", pkg_manager, "install", "-y", "wget"])
        install_cmds.append(["bash", "-c",
            "wget -O - https://repo.litespeed.sh | sudo bash && "
            + ("sudo apt-get install -y openlitespeed" if pkg_manager == "apt-get" else "sudo yum install -y openlitespeed")
        ])
    elif stack == "nginx_apache":
        pkg = "apache2" if pkg_manager == "apt-get" else "httpd"
        install_cmds.append(["sudo", pkg_manager, "install", "-y", "nginx", pkg])
        # Configure Apache to listen on 8080
        apache_conf = "/etc/apache2/ports.conf" if pkg_manager == "apt-get" else "/etc/httpd/conf/httpd.conf"
        if os.path.exists(apache_conf):
            try:
                with open(apache_conf, "r") as f:
                    content = f.read()
                content = content.replace("Listen 80", "Listen 8080")
                with open(apache_conf, "w") as f:
                    f.write(content)
            except Exception:
                pass

    for cmd in install_cmds:
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as e:
            raise HTTPException(status_code=500, detail=f"Install failed: {e.stderr or e.stdout}")

    return {"status": "success", "message": f"Stack '{stack}' installed successfully."}

@router.post("/web_services/{service_id}/{action}")
async def control_web_service(service_id: str, action: str) -> Dict[str, Any]:
    """Control starting, stopping, restarting, or removing web server services."""
    if IS_WINDOWS:
        return {"status": "success", "message": f"Service {service_id} action '{action}' performed successfully (Mock mode)."}

    if action == "install":
        # Run package installation using apt/yum
        pkg_manager = "apt-get" if shutil.which("apt-get") else ("yum" if shutil.which("yum") else None)
        if pkg_manager == "apt-get":
            subprocess.run(["sudo", "apt-get", "update", "-y"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["sudo", "apt-get", "install", "-y", service_id], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif pkg_manager == "yum":
            subprocess.run(["sudo", "yum", "install", "-y", service_id], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {"status": "success", "message": f"{service_id} installed successfully."}

    if action in ["start", "stop", "restart"]:
        try:
            subprocess.run(["sudo", "systemctl", action, service_id], check=True, capture_output=True, text=True)
            return {"status": "success", "message": f"Service {service_id} {action}ed successfully."}
        except subprocess.CalledProcessError as e:
            raise HTTPException(status_code=400, detail=f"Service control failed: {e.stderr or e.stdout}")

    return {"status": "error", "message": "Unknown action"}



@router.get("/db_admin_tools")
async def get_db_admin_tools() -> Dict[str, Any]:
    """Detect installed database engines and their admin tools."""

    def check_service_running(service: str) -> bool:
        if IS_WINDOWS:
            return False
        try:
            res = subprocess.run(["systemctl", "is-active", service], capture_output=True, text=True)
            return res.stdout.strip() == "active"
        except Exception:
            return False

    def get_db_version(cmd: List[str]) -> str:
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            return res.stdout.strip().split("\n")[0] if res.returncode == 0 else ""
        except Exception:
            return ""

    engines = []

    # MySQL / MariaDB
    mysql_installed = bool(shutil.which("mysql") or shutil.which("mariadb") or os.path.exists("/var/lib/mysql"))
    mysql_version = ""
    if mysql_installed and not IS_WINDOWS:
        mysql_version = get_db_version(["mysql", "--version"])
    pma_installed = os.path.exists("/usr/share/phpmyadmin") or os.path.exists("/var/www/html/phpmyadmin")
    pma_url = "/phpmyadmin/"
    if os.path.exists("/var/www/html/phpmyadmin/index.php"):
        pma_url = "/phpmyadmin/index.php"
    engines.append({
        "id": "mysql",
        "name": "MySQL / MariaDB",
        "installed": mysql_installed,
        "version": mysql_version,
        "status": "running" if (mysql_installed and check_service_running("mysql")) or (mysql_installed and check_service_running("mariadb")) else ("stopped" if mysql_installed else "not_installed"),
        "admin_tool": "phpmyadmin",
        "admin_name": "phpMyAdmin",
        "admin_url": pma_url,
        "admin_installed": pma_installed,
    })

    # PostgreSQL
    pg_installed = bool(shutil.which("psql") or os.path.exists("/var/lib/postgresql"))
    pg_version = ""
    if pg_installed and not IS_WINDOWS:
        pg_version = get_db_version(["psql", "--version"])
    pgadmin_installed = os.path.exists("/usr/lib/python3/dist-packages/pgadmin4") or os.path.exists("/etc/pgadmin")
    engines.append({
        "id": "postgresql",
        "name": "PostgreSQL",
        "installed": pg_installed,
        "version": pg_version,
        "status": "running" if (pg_installed and check_service_running("postgresql")) else ("stopped" if pg_installed else "not_installed"),
        "admin_tool": "pgadmin",
        "admin_name": "pgAdmin 4",
        "admin_url": "/pgadmin4",
        "admin_installed": pgadmin_installed,
    })

    # Adminer — universal lightweight fallback
    adminer_paths = ["/usr/share/adminer/adminer.php", "/var/www/html/adminer.php"]
    adminer_installed = any(os.path.exists(p) for p in adminer_paths)
    adminer_url = "/adminer"
    if os.path.exists("/usr/share/adminer/adminer.php"):
        adminer_url = "/adminer/adminer.php"
    elif os.path.exists("/var/www/html/adminer.php"):
        adminer_url = "/adminer.php"
    engines.append({
        "id": "adminer",
        "name": "Adminer",
        "installed": True,  # Always available as option
        "version": "latest",
        "status": "available",
        "admin_tool": "adminer",
        "admin_name": "Adminer (Universal)",
        "admin_url": adminer_url,
        "admin_installed": adminer_installed,
    })

    return {"status": "success", "engines": engines}


@router.post("/db_admin_tools/{tool_id}/install")
async def install_db_admin_tool(tool_id: str) -> Dict[str, Any]:
    """Install missing DB engine/admin tool packages."""
    if IS_WINDOWS:
        return {"status": "success", "message": f"{tool_id} install simulated (Windows mock)."}

    pkg = _pkg_manager()
    if not pkg:
        raise HTTPException(status_code=400, detail="No supported package manager found (apt-get/yum).")

    try:
        if tool_id == "mysql":
            if pkg == "apt-get":
                _run_with_optional_sudo([pkg, "install", "-y", "mariadb-server"])
                _run_with_optional_sudo([pkg, "install", "-y", "phpmyadmin"])
            else:
                _run_with_optional_sudo([pkg, "install", "-y", "mariadb-server"])
                # phpMyAdmin package name differs by distro; try best-effort
                try:
                    _run_with_optional_sudo([pkg, "install", "-y", "phpMyAdmin"])
                except Exception:
                    _run_with_optional_sudo([pkg, "install", "-y", "phpmyadmin"])
            return {"status": "success", "message": "MySQL/MariaDB and phpMyAdmin installation completed."}

        if tool_id == "postgresql":
            if pkg == "apt-get":
                _run_with_optional_sudo([pkg, "install", "-y", "postgresql"])
                _run_with_optional_sudo([pkg, "install", "-y", "pgadmin4"])
            else:
                _run_with_optional_sudo([pkg, "install", "-y", "postgresql-server"])
                _run_with_optional_sudo([pkg, "install", "-y", "pgadmin4"])
            return {"status": "success", "message": "PostgreSQL and pgAdmin installation completed."}

        if tool_id == "adminer":
            return await install_adminer()

        raise HTTPException(status_code=404, detail=f"Unsupported db admin tool: {tool_id}")
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=(e.stderr or e.stdout or "Installation failed.").strip())


@router.post("/db_admin_tools/adminer/install")
async def install_adminer() -> Dict[str, Any]:
    """Download and configure Adminer as a universal DB admin tool."""
    if IS_WINDOWS:
        return {"status": "success", "message": "Adminer install simulated (Windows mock)."}

    adminer_dir = "/usr/share/adminer"
    adminer_path = f"{adminer_dir}/adminer.php"
    nginx_conf = "/etc/nginx/conf.d/adminer.conf"
    apache_conf = "/etc/apache2/conf-available/adminer.conf"

    try:
        os.makedirs(adminer_dir, exist_ok=True)
        url = "https://github.com/vrana/adminer/releases/download/v4.8.1/adminer-4.8.1.php"
        urllib.request.urlretrieve(url, adminer_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download Adminer: {e}")

    # Create Nginx config for Adminer
    if shutil.which("nginx"):
        nginx_config = f"""server {{
    listen 80;
    server_name _;
    location /adminer {{
        alias {adminer_dir};
        index adminer.php;
        location ~ \\.php$ {{
            include fastcgi_params;
            fastcgi_pass unix:/run/php/php8.2-fpm.sock;
            fastcgi_param SCRIPT_FILENAME $request_filename;
        }}
    }}
}}
"""
        try:
            with open(nginx_conf, "w") as f:
                f.write(nginx_config)
            subprocess.run(["nginx", "-t"], check=True, capture_output=True)
            subprocess.run(["systemctl", "reload", "nginx"], check=False)
        except Exception:
            pass

    # Create Apache config for Adminer
    if shutil.which("apache2ctl") and os.path.exists("/etc/apache2"):
        apache_config = f"""Alias /adminer {adminer_dir}
<Directory {adminer_dir}>
    Options Indexes FollowSymLinks
    AllowOverride None
    Require all granted
</Directory>
"""
        try:
            with open(apache_conf, "w") as f:
                f.write(apache_config)
            subprocess.run(["a2enconf", "adminer"], check=False, capture_output=True)
            subprocess.run(["systemctl", "reload", "apache2"], check=False)
        except Exception:
            pass

    return {"status": "success", "message": "Adminer installed successfully at /adminer"}


class SavePhpMyAdminCredentialsRequest(BaseModel):
    user: str
    password: str

@router.get("/phpmyadmin")
async def get_phpmyadmin_credentials() -> Dict[str, Any]:
    """Return phpMyAdmin login credentials saved by install.sh."""
    creds_file = "/opt/copanel/config/mysql_credentials.txt"
    pma_installed = bool(
        shutil.which("mysql") or os.path.exists("/usr/share/phpmyadmin")
    )

    if not os.path.exists(creds_file):
        return {"installed": pma_installed, "user": "", "password": ""}

    user, password = "", ""
    try:
        with open(creds_file, "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith("MYSQL_USER="):
                    user = line.split("=", 1)[1]
                elif line.startswith("MYSQL_PASS="):
                    password = line.split("=", 1)[1]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"installed": pma_installed, "user": user, "password": password}


@router.post("/phpmyadmin/save")
async def save_phpmyadmin_credentials(req: SavePhpMyAdminCredentialsRequest) -> Dict[str, Any]:
    """Save or create phpMyAdmin/MySQL user."""
    # Save to file
    creds_file = "/opt/copanel/config/mysql_credentials.txt"
    os.makedirs(os.path.dirname(creds_file), exist_ok=True)
    with open(creds_file, "w") as f:
        f.write(f"MYSQL_USER={req.user}\n")
        f.write(f"MYSQL_PASS={req.password}\n")
        
    # On Linux, also try to create/update MySQL user directly!
    if os.name != 'nt':
        try:
            cmd = f"sudo mysql -e \"CREATE USER IF NOT EXISTS '{req.user}'@'localhost' IDENTIFIED BY '{req.password}'; GRANT ALL PRIVILEGES ON *.* TO '{req.user}'@'localhost' WITH GRANT OPTION; FLUSH PRIVILEGES;\""
            subprocess.run(cmd, shell=True, capture_output=True, text=True)
        except Exception:
            pass
            
    return {"status": "success", "message": "Credentials updated successfully."}

