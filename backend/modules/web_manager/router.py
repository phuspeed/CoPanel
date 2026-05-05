"""
Web Manager Module Router
Nginx + Apache vhosts, stack bootstrap (LEMP/LAMP), PHP-FPM and DB service overview.
"""
import os
import re
import shutil
import subprocess
import urllib.request
from typing import List, Dict, Any, Optional, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import logic

router = APIRouter()

IS_WINDOWS = logic.IS_WINDOWS
ensure_nginx_dirs = logic.ensure_nginx_dirs
parse_nginx_config = logic.parse_nginx_config
parse_apache_vhost = logic.parse_apache_vhost
sanitize_filename = logic.sanitize_filename
run_with_optional_sudo = logic.run_with_optional_sudo
detect_php_fpm_socket = logic.detect_php_fpm_socket
detect_apache_layout = logic.detect_apache_layout
list_apache_site_files = logic.list_apache_site_files
read_apache_site = logic.read_apache_site
is_apache_vhost_enabled = logic.is_apache_vhost_enabled
nginx_reload_test = logic.nginx_reload_test
apache_reload_test = logic.apache_reload_test
pkg_manager = logic.pkg_manager


def _nginx_paths():
    return ensure_nginx_dirs()


def _pkg_manager() -> Optional[str]:
    return pkg_manager()


def _pkg_installed(pkg_name: str) -> bool:
    pm = _pkg_manager()
    if not pm:
        return False
    try:
        if pm == "apt-get":
            res = subprocess.run(["dpkg-query", "-W", "-f=${Status}", pkg_name], capture_output=True, text=True)
            return "install ok installed" in (res.stdout or "")
        res = subprocess.run(["rpm", "-q", pkg_name], capture_output=True, text=True)
        return res.returncode == 0
    except Exception:
        return False

# Schemas
class CreateSiteRequest(BaseModel):
    filename: Optional[str] = None
    domain: str
    root: str
    port: Optional[int] = 80
    proxy_port: Optional[int] = None
    php_version: Optional[str] = None
    php_modules: Optional[List[str]] = None
    engine: Literal["nginx", "apache"] = "nginx"

class ToggleSiteRequest(BaseModel):
    filename: str
    active: bool
    engine: Literal["nginx", "apache"] = "nginx"

class DeleteSiteRequest(BaseModel):
    filename: str
    engine: Literal["nginx", "apache"] = "nginx"

class UpdateSiteRequest(BaseModel):
    filename: str
    content: str
    engine: Literal["nginx", "apache"] = "nginx"


class StackBootstrapRequest(BaseModel):
    preset: Literal["lemp", "lamp", "nginx_only", "apache_only", "php_mysql"] = Field(
        ..., description="lemp=nginx+php-fpm+mysql; lamp=apache+php+mysql; php_mysql=PHP-FPM variants + DB client libs"
    )
    php_version: Optional[str] = "8.2"



@router.get("/list")
async def list_sites() -> Dict[str, Any]:
    """List Nginx and Apache vhosts (unified list with engine field)."""
    try:
        sites: List[Dict[str, Any]] = []
        np = _nginx_paths()
        for filename in os.listdir(np.sites_available):
            file_path = os.path.join(np.sites_available, filename)
            if not os.path.isfile(file_path):
                continue
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            parsed = parse_nginx_config(content)
            enabled_path = os.path.join(np.sites_enabled, filename)
            is_active = os.path.exists(enabled_path)
            sites.append(
                {
                    "filename": filename,
                    "domain": parsed["domain"],
                    "root": parsed["root"],
                    "active": is_active,
                    "content": content,
                    "engine": "nginx",
                }
            )

        layout = detect_apache_layout()
        if layout:
            for filename in list_apache_site_files(layout):
                try:
                    _, content = read_apache_site(layout, filename)
                except Exception:
                    continue
                parsed = parse_apache_vhost(content)
                sites.append(
                    {
                        "filename": filename,
                        "domain": parsed["domain"],
                        "root": parsed["root"],
                        "active": is_apache_vhost_enabled(layout, filename),
                        "content": content,
                        "engine": "apache",
                    }
                )

        return {"status": "success", "sites": sites}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _apache_vhost_template(
    port: int,
    server_name_str: str,
    docroot: str,
    php_version: Optional[str],
    proxy_port: Optional[int],
    php_socket: Optional[str],
) -> str:
    parts = server_name_str.split()
    primary = parts[0] if parts else server_name_str
    aliases = parts[1:] if len(parts) > 1 else []
    alias_line = f"    ServerAlias {' '.join(aliases)}\n" if aliases else ""

    if proxy_port:
        return f"""<VirtualHost *:{port}>
    ServerName {primary}
{alias_line}    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:{proxy_port}/
    ProxyPassReverse / http://127.0.0.1:{proxy_port}/
</VirtualHost>
"""
    if php_version and php_socket:
        return f"""<VirtualHost *:{port}>
    ServerName {primary}
{alias_line}    DocumentRoot {docroot}
    <Directory {docroot}>
        AllowOverride All
        Require all granted
    </Directory>
    <FilesMatch \\.php$>
        SetHandler "proxy:unix:{php_socket}|fcgi://localhost"
    </FilesMatch>
</VirtualHost>
"""
    return f"""<VirtualHost *:{port}>
    ServerName {primary}
{alias_line}    DocumentRoot {docroot}
    <Directory {docroot}>
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
"""


@router.post("/create")
async def create_site(req: CreateSiteRequest) -> Dict[str, Any]:
    """Create a new Nginx or Apache vhost from a basic template."""
    try:
        fname = req.filename
        if not fname or fname.strip() == "":
            domain_name = req.domain.strip().lower()
            domain_name = re.sub(r"^(https?://)?(www\.)?", "", domain_name)
            fname = f"{domain_name}.conf"

        safe_filename = sanitize_filename(fname)

        server_name_str = req.domain.strip()
        if not req.domain.startswith("www.") and "." in req.domain and not req.domain.replace(".", "").isdigit():
            server_name_str += f" www.{req.domain}"

        if req.root and req.root.strip() != "":
            try:
                os.makedirs(req.root.strip(), exist_ok=True)
            except Exception:
                pass

        if req.engine == "apache":
            layout = detect_apache_layout()
            if not layout:
                raise HTTPException(status_code=400, detail="Apache layout not detected on this system.")

            if layout.style == "debian" and layout.sites_available and layout.sites_enabled:
                file_path = os.path.join(layout.sites_available, safe_filename)
                enabled_path = os.path.join(layout.sites_enabled, safe_filename)
            elif layout.style == "rhel" and layout.conf_d:
                rhel_name = safe_filename if safe_filename.endswith(".conf") else f"{safe_filename}.conf"
                file_path = os.path.join(layout.conf_d, rhel_name)
                enabled_path = file_path
            else:
                raise HTTPException(status_code=400, detail="Unsupported Apache layout.")

            if os.path.exists(file_path):
                raise HTTPException(status_code=400, detail="Apache vhost file already exists.")

            php_sock = None
            if req.php_version:
                php_sock = detect_php_fpm_socket(req.php_version) or f"/run/php/php{req.php_version}-fpm.sock"

            template = _apache_vhost_template(
                req.port or 80,
                server_name_str,
                req.root.strip() if req.root else "/var/www/html",
                req.php_version,
                req.proxy_port,
                php_sock,
            )

            with open(file_path, "w", encoding="utf-8") as f:
                f.write(template)

            if not IS_WINDOWS and layout.style == "debian":
                try:
                    if req.proxy_port:
                        subprocess.run(["sudo", "a2enmod", "proxy", "proxy_http", "headers"], capture_output=True, text=True)
                    elif req.php_version:
                        subprocess.run(["sudo", "a2enmod", "proxy", "proxy_fcgi", "setenvif"], capture_output=True, text=True)
                except Exception:
                    pass

            if layout.style == "debian" and layout.sites_enabled:
                if not os.path.exists(enabled_path):
                    try:
                        if IS_WINDOWS:
                            shutil.copy2(file_path, enabled_path)
                        else:
                            subprocess.run(["sudo", "a2ensite", safe_filename], check=True, capture_output=True, text=True)
                    except subprocess.CalledProcessError:
                        if os.path.exists(file_path):
                            os.remove(file_path)
                        raise HTTPException(status_code=400, detail="a2ensite failed; check site name and apache config.")

            if not IS_WINDOWS:
                try:
                    apache_reload_test(layout)
                except subprocess.CalledProcessError as e:
                    if layout.style == "debian":
                        try:
                            subprocess.run(["sudo", "a2dissite", safe_filename], capture_output=True, text=True)
                        except Exception:
                            pass
                    if os.path.exists(file_path):
                        try:
                            os.remove(file_path)
                        except Exception:
                            pass
                    raise HTTPException(
                        status_code=400,
                        detail=f"Apache configuration invalid: {e.stderr or e.stdout}",
                    )

            return {"status": "success", "message": "Apache vhost created and activated successfully.", "engine": "apache"}

        # ---- Nginx ----
        np = _nginx_paths()
        file_path = os.path.join(np.sites_available, safe_filename)
        enabled_path = os.path.join(np.sites_enabled, safe_filename)

        if os.path.exists(file_path):
            raise HTTPException(status_code=400, detail="Site configuration file already exists.")

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
            sock = detect_php_fpm_socket(req.php_version) or f"/run/php/php{req.php_version}-fpm.sock"
            template = f"""server {{
    listen {req.port};
    server_name {server_name_str};
    root {req.root};
    client_max_body_size 500M;

    index index.php index.html index.htm;

    location / {{
        try_files $uri $uri/ /index.php?$query_string;
    }}

    location ~ \\.php$ {{
        include fastcgi_params;
        fastcgi_pass unix:{sock};
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }}

    location ~ /\\.ht {{
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

        with open(file_path, "w", encoding="utf-8") as f:
            f.write(template)

        if not IS_WINDOWS and req.php_version and req.php_modules:
            try:
                pm = "apt-get" if shutil.which("apt-get") else ("yum" if shutil.which("yum") else None)
                if pm == "apt-get":
                    pkgs = [f"php{req.php_version}-{m}" for m in req.php_modules]
                    subprocess.run(["sudo", "apt-get", "install", "-y"] + pkgs, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                elif pm == "yum":
                    pkgs = [f"php-{m}" for m in req.php_modules]
                    subprocess.run(["sudo", "yum", "install", "-y"] + pkgs, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception:
                pass

        if not os.path.exists(enabled_path):
            if IS_WINDOWS:
                shutil.copy2(file_path, enabled_path)
            else:
                os.symlink(file_path, enabled_path)

        if not IS_WINDOWS:
            try:
                nginx_reload_test()
            except subprocess.CalledProcessError as e:
                if os.path.exists(enabled_path):
                    if os.path.islink(enabled_path):
                        os.unlink(enabled_path)
                    else:
                        os.remove(enabled_path)
                if os.path.exists(file_path):
                    os.remove(file_path)
                raise HTTPException(
                    status_code=400,
                    detail=f"Nginx configuration invalid: {e.stderr}",
                )

        return {"status": "success", "message": "Nginx site created and activated successfully.", "engine": "nginx"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/toggle")
async def toggle_site(req: ToggleSiteRequest) -> Dict[str, Any]:
    """Enable or disable a Nginx site (symlink) or Apache vhost (a2ensite / rename)."""
    try:
        safe_filename = sanitize_filename(req.filename)

        if req.engine == "apache":
            layout = detect_apache_layout()
            if not layout:
                raise HTTPException(status_code=404, detail="Apache not available.")
            try:
                read_apache_site(layout, safe_filename)
            except Exception:
                raise HTTPException(status_code=404, detail="Apache vhost not found.")

            if layout.style == "debian":
                try:
                    if req.active:
                        subprocess.run(["sudo", "a2ensite", safe_filename], check=True, capture_output=True, text=True)
                    else:
                        subprocess.run(["sudo", "a2dissite", safe_filename], check=True, capture_output=True, text=True)
                except subprocess.CalledProcessError as e:
                    raise HTTPException(status_code=400, detail=(e.stderr or e.stdout or "a2en/a2dis failed.").strip())
            elif layout.style == "rhel" and layout.conf_d:
                base = os.path.join(layout.conf_d, safe_filename if safe_filename.endswith(".conf") else f"{safe_filename}.conf")
                off = base + ".off"
                try:
                    if req.active:
                        if os.path.isfile(off):
                            os.rename(off, base)
                        elif not os.path.isfile(base):
                            raise HTTPException(status_code=404, detail="Vhost conf missing.")
                    else:
                        if os.path.isfile(base):
                            os.rename(base, off)
                except HTTPException:
                    raise
                except Exception as e:
                    raise HTTPException(status_code=400, detail=str(e))

            if not IS_WINDOWS:
                try:
                    apache_reload_test(layout)
                except subprocess.CalledProcessError as e:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Apache configuration invalid: {e.stderr or e.stdout}",
                    )
            return {"status": "success", "message": f"Apache site {'enabled' if req.active else 'disabled'} successfully."}

        np = _nginx_paths()
        available_path = os.path.join(np.sites_available, safe_filename)
        enabled_path = os.path.join(np.sites_enabled, safe_filename)

        if not os.path.exists(available_path):
            raise HTTPException(status_code=404, detail="Site configuration not found in sites-available.")

        if req.active:
            if not os.path.exists(enabled_path):
                if IS_WINDOWS:
                    shutil.copy2(available_path, enabled_path)
                else:
                    os.symlink(available_path, enabled_path)
        else:
            if os.path.exists(enabled_path):
                if os.path.islink(enabled_path):
                    os.unlink(enabled_path)
                else:
                    os.remove(enabled_path)

        if not IS_WINDOWS:
            try:
                nginx_reload_test()
            except subprocess.CalledProcessError as e:
                if req.active and os.path.exists(enabled_path):
                    if os.path.islink(enabled_path):
                        os.unlink(enabled_path)
                    else:
                        os.remove(enabled_path)
                raise HTTPException(
                    status_code=400,
                    detail=f"Nginx configuration invalid: {e.stderr}",
                )

        return {"status": "success", "message": f"Site {'enabled' if req.active else 'disabled'} successfully."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/delete")
async def delete_site(req: DeleteSiteRequest) -> Dict[str, Any]:
    """Delete Nginx or Apache vhost configuration."""
    try:
        safe_filename = sanitize_filename(req.filename)

        if req.engine == "apache":
            layout = detect_apache_layout()
            if not layout:
                raise HTTPException(status_code=404, detail="Apache not available.")
            if layout.style == "debian" and layout.sites_available and layout.sites_enabled:
                enabled_path = os.path.join(layout.sites_enabled, safe_filename)
                available_path = os.path.join(layout.sites_available, safe_filename)
                if os.path.exists(enabled_path):
                    if os.path.islink(enabled_path):
                        os.unlink(enabled_path)
                    else:
                        os.remove(enabled_path)
                try:
                    subprocess.run(["sudo", "a2dissite", safe_filename], capture_output=True, text=True)
                except Exception:
                    pass
                if os.path.exists(available_path):
                    os.remove(available_path)
            elif layout.style == "rhel" and layout.conf_d:
                base = os.path.join(
                    layout.conf_d,
                    safe_filename if safe_filename.endswith(".conf") else f"{safe_filename}.conf",
                )
                for path in (base, base + ".off"):
                    if os.path.isfile(path):
                        os.remove(path)
            if not IS_WINDOWS:
                try:
                    apache_reload_test(layout)
                except Exception:
                    pass
            return {"status": "success", "message": "Apache vhost removed."}

        np = _nginx_paths()
        available_path = os.path.join(np.sites_available, safe_filename)
        enabled_path = os.path.join(np.sites_enabled, safe_filename)

        if os.path.exists(enabled_path):
            if os.path.islink(enabled_path):
                os.unlink(enabled_path)
            else:
                os.remove(enabled_path)

        if os.path.exists(available_path):
            os.remove(available_path)

        if not IS_WINDOWS:
            subprocess.run(["nginx", "-t"], check=False)
            subprocess.run(["systemctl", "reload", "nginx"], check=False)

        return {"status": "success", "message": "Nginx site removed completely."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/update")
async def update_site(req: UpdateSiteRequest) -> Dict[str, Any]:
    """Update Nginx or Apache vhost content, test syntax, and reload."""
    try:
        safe_filename = sanitize_filename(req.filename)

        if req.engine == "apache":
            layout = detect_apache_layout()
            if not layout:
                raise HTTPException(status_code=404, detail="Apache not available.")
            try:
                available_path, backup_content = read_apache_site(layout, safe_filename)
            except Exception:
                raise HTTPException(status_code=404, detail="Apache vhost not found.")

            with open(available_path, "w", encoding="utf-8") as f:
                f.write(req.content)

            if not IS_WINDOWS:
                try:
                    apache_reload_test(layout)
                except subprocess.CalledProcessError as e:
                    with open(available_path, "w", encoding="utf-8") as f:
                        f.write(backup_content)
                    raise HTTPException(
                        status_code=400,
                        detail=f"Apache configuration syntax error:\n{e.stderr or e.stdout}",
                    )
            return {"status": "success", "message": "Apache configuration saved and reloaded successfully."}

        np = _nginx_paths()
        available_path = os.path.join(np.sites_available, safe_filename)

        if not os.path.exists(available_path):
            raise HTTPException(status_code=404, detail="Site configuration not found.")

        with open(available_path, "r", encoding="utf-8", errors="ignore") as f:
            backup_content = f.read()

        with open(available_path, "w", encoding="utf-8") as f:
            f.write(req.content)

        if not IS_WINDOWS:
            try:
                nginx_reload_test()
            except subprocess.CalledProcessError as e:
                with open(available_path, "w", encoding="utf-8") as f:
                    f.write(backup_content)
                raise HTTPException(
                    status_code=400,
                    detail=f"Nginx configuration syntax error:\n{e.stderr or e.stdout}",
                )

        return {"status": "success", "message": "Configuration saved and reloaded successfully."}
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
        if sid == "apache2":
            bin_exists = bin_exists or shutil.which("apache2") or shutil.which("httpd")
            bin_exists = bin_exists or os.path.isdir("/etc/apache2") or os.path.isdir("/etc/httpd")
        if bin_exists or os.path.exists(f"/etc/{sid}"):
            s["installed"] = True
            installed_ids.add(sid)
            try:
                active = False
                for unit in (sid, "httpd") if sid == "apache2" else (sid,):
                    res = subprocess.run(["systemctl", "is-active", unit], capture_output=True, text=True)
                    if res.stdout.strip() == "active":
                        active = True
                        break
                s["status"] = "running" if active else "stopped"
            except Exception:
                s["status"] = "stopped"

    # Populate conflicts: only list conflicts that are actually installed
    for s in services:
        s["conflicts_with"] = [c for c in CONFLICT_MAP.get(s["id"], []) if c in installed_ids]

    return {"status": "success", "services": services}


@router.get("/stack")
async def stack_overview() -> Dict[str, Any]:
    """Unified LEMP/LAMP-style overview: web servers, PHP-FPM, SQL services."""
    ws = await list_web_services()
    return {
        "status": "success",
        "web_servers": ws.get("services", []),
        "php_fpm": logic.list_php_fpm_versions(),
        "database_services": logic.database_service_rows(),
        "apache_detected": detect_apache_layout() is not None,
    }


@router.post("/stack/bootstrap")
async def stack_bootstrap(req: StackBootstrapRequest) -> Dict[str, Any]:
    """Install common presets: LEMP (nginx + php-fpm + mariadb), LAMP, or PHP+DB libs only."""
    if IS_WINDOWS:
        return {"status": "success", "message": f"Bootstrap '{req.preset}' simulated (Windows)."}

    pm = pkg_manager()
    if not pm:
        raise HTTPException(status_code=400, detail="No supported package manager (apt-get/yum).")

    ver = (req.php_version or "8.2").strip()
    cmds: List[List[str]] = []

    if req.preset == "nginx_only":
        cmds.append(["sudo", pm, "install", "-y", "nginx"])
    elif req.preset == "apache_only":
        pkg = "apache2" if pm == "apt-get" else "httpd"
        cmds.append(["sudo", pm, "install", "-y", pkg])
    elif req.preset == "lemp":
        cmds.append(["sudo", pm, "install", "-y", "nginx"])
        if pm == "apt-get":
            cmds.append(["sudo", pm, "install", "-y", f"php{ver}-fpm", f"php{ver}-cli", f"php{ver}-mysql", "mariadb-server"])
        else:
            cmds.append(
                ["sudo", pm, "install", "-y", "php-fpm", "php-mysqlnd", "mariadb-server"]
            )
    elif req.preset == "lamp":
        if pm == "apt-get":
            cmds.append(
                [
                    "sudo",
                    pm,
                    "install",
                    "-y",
                    "apache2",
                    f"php{ver}",
                    f"libapache2-mod-php{ver}",
                    f"php{ver}-mysql",
                    "mariadb-server",
                ]
            )
        else:
            cmds.append(["sudo", pm, "install", "-y", "httpd", "php", "php-mysqlnd", "mariadb-server"])
    elif req.preset == "php_mysql":
        if pm == "apt-get":
            cmds.append(
                [
                    "sudo",
                    pm,
                    "install",
                    "-y",
                    f"php{ver}-fpm",
                    f"php{ver}-cli",
                    f"php{ver}-mysql",
                    f"php{ver}-curl",
                    f"php{ver}-mbstring",
                    f"php{ver}-xml",
                ]
            )
        else:
            cmds.append(["sudo", pm, "install", "-y", "php-fpm", "php-mysqlnd", "php-cli"])

    for cmd in cmds:
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as e:
            raise HTTPException(
                status_code=500,
                detail=(e.stderr or e.stdout or "Bootstrap install failed.").strip(),
            )

    return {"status": "success", "message": f"Stack bootstrap '{req.preset}' completed."}


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
        unit = service_id
        if service_id == "apache2":
            r_a = subprocess.run(["systemctl", "cat", "apache2"], capture_output=True, text=True)
            r_h = subprocess.run(["systemctl", "cat", "httpd"], capture_output=True, text=True)
            unit = "apache2" if r_a.returncode == 0 else ("httpd" if r_h.returncode == 0 else "apache2")
        try:
            subprocess.run(["sudo", "systemctl", action, unit], check=True, capture_output=True, text=True)
            return {"status": "success", "message": f"Service {unit} {action}ed successfully."}
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
    pma_installed = (
        os.path.exists("/usr/share/phpmyadmin")
        or os.path.exists("/usr/share/phpMyAdmin")
        or os.path.exists("/var/www/html/phpmyadmin")
        or os.path.exists("/var/www/html/phpMyAdmin")
        or _pkg_installed("phpmyadmin")
        or _pkg_installed("phpMyAdmin")
    )
    pma_url = "/phpmyadmin"
    if os.path.exists("/var/www/html/phpmyadmin/index.php") or os.path.exists("/usr/share/phpmyadmin/index.php"):
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
    adminer_installed = adminer_installed or _pkg_installed("adminer")
    adminer_url = "/adminer.php"
    if os.path.exists("/usr/share/adminer/adminer.php"):
        adminer_url = "/adminer.php"
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
                try:
                    run_with_optional_sudo([pkg, "install", "-y", "mariadb-server"])
                except Exception:
                    run_with_optional_sudo([pkg, "install", "-y", "mysql-server"])
                run_with_optional_sudo([pkg, "install", "-y", "phpmyadmin"])
            else:
                try:
                    run_with_optional_sudo([pkg, "install", "-y", "mariadb-server"])
                except Exception:
                    run_with_optional_sudo([pkg, "install", "-y", "mysql-server"])
                # phpMyAdmin package name differs by distro; try best-effort
                try:
                    run_with_optional_sudo([pkg, "install", "-y", "phpMyAdmin"])
                except Exception:
                    run_with_optional_sudo([pkg, "install", "-y", "phpmyadmin"])
            return {"status": "success", "message": "MySQL/MariaDB and phpMyAdmin installation completed."}

        if tool_id == "postgresql":
            if pkg == "apt-get":
                run_with_optional_sudo([pkg, "install", "-y", "postgresql"])
                run_with_optional_sudo([pkg, "install", "-y", "pgadmin4"])
            else:
                run_with_optional_sudo([pkg, "install", "-y", "postgresql-server"])
                run_with_optional_sudo([pkg, "install", "-y", "pgadmin4"])
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
    public_adminer_path = "/var/www/html/adminer.php"
    nginx_conf = "/etc/nginx/conf.d/adminer.conf"
    apache_conf = "/etc/apache2/conf-available/adminer.conf"

    try:
        os.makedirs(adminer_dir, exist_ok=True)
        os.makedirs("/var/www/html", exist_ok=True)
        url = "https://github.com/vrana/adminer/releases/download/v4.8.1/adminer-4.8.1.php"
        urllib.request.urlretrieve(url, adminer_path)
        try:
            shutil.copy2(adminer_path, public_adminer_path)
        except Exception:
            pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download Adminer: {e}")

    # Create Nginx config for Adminer
    if shutil.which("nginx"):
        adminer_sock = None
        for v in ("8.3", "8.2", "8.1", "8.0", "7.4"):
            adminer_sock = detect_php_fpm_socket(v)
            if adminer_sock:
                break
        if not adminer_sock:
            adminer_sock = "/run/php/php8.2-fpm.sock"
        nginx_config = f"""server {{
    listen 80;
    server_name _;
    location /adminer {{
        alias {adminer_dir};
        index adminer.php;
        location ~ \\.php$ {{
            include fastcgi_params;
            fastcgi_pass unix:{adminer_sock};
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

    return {"status": "success", "message": "Adminer installed successfully. Try /adminer.php (or /adminer if nginx alias is active)."}


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

