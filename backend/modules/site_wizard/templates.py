"""Site Wizard template catalog and default resolution."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

TEMPLATES: List[Dict[str, Any]] = [
    {
        "id": "static",
        "name": "Static site",
        "description": "HTML/CSS/JS with Nginx and optional SSL.",
        "icon": "FileCode",
        "features": ["Nginx vhost", "Placeholder page", "SSL optional"],
        "one_click": True,
        "php_version": None,
        "php_modules": [],
        "proxy_port": None,
        "create_database": False,
        "issue_ssl": True,
        "stack_preset": "nginx_only",
    },
    {
        "id": "wordpress",
        "name": "WordPress",
        "description": "1-click WordPress: PHP, MySQL, core files, wp-config.",
        "icon": "Wordpress",
        "features": ["LEMP stack", "MySQL DB", "WP core download", "SSL optional"],
        "one_click": True,
        "php_version": "8.2",
        "php_modules": ["mysqli", "curl", "mbstring", "gd", "zip", "xml", "intl"],
        "proxy_port": None,
        "create_database": True,
        "issue_ssl": True,
        "stack_preset": "lemp",
    },
    {
        "id": "laravel",
        "name": "Laravel app",
        "description": "PHP-FPM vhost, MySQL, and a ready public/ skeleton.",
        "icon": "Boxes",
        "features": ["LEMP stack", "MySQL DB", "public/ skeleton", "SSL optional"],
        "one_click": True,
        "php_version": "8.3",
        "php_modules": ["mysqli", "curl", "mbstring", "bcmath", "intl", "zip", "xml"],
        "proxy_port": None,
        "create_database": True,
        "issue_ssl": True,
        "stack_preset": "lemp",
    },
    {
        "id": "node_proxy",
        "name": "Node / Reverse proxy",
        "description": "Nginx reverse proxy to your app port (Node, Bun, Go).",
        "icon": "Server",
        "features": ["Nginx proxy", "Port 3000 default", "SSL optional"],
        "one_click": True,
        "php_version": None,
        "php_modules": [],
        "proxy_port": 3000,
        "create_database": False,
        "issue_ssl": True,
        "stack_preset": "nginx_only",
    },
]


def get_template(template_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not template_id:
        return None
    for tpl in TEMPLATES:
        if tpl["id"] == template_id:
            return dict(tpl)
    return None


def resolve_wizard_defaults(
    template_id: Optional[str],
    *,
    domain: str,
    document_root: Optional[str],
    php_version: Optional[str],
    php_modules: Optional[List[str]],
    proxy_port: Optional[int],
    create_database: Optional[bool],
    issue_ssl: Optional[bool],
    ssl_email: Optional[str],
) -> Dict[str, Any]:
    tpl = get_template(template_id) or get_template("static") or {}
    doc_root = document_root
    if not doc_root or doc_root.strip() in ("/var/www", "/var/www/"):
        clean = domain.strip().lower()
        if tpl.get("id") == "laravel":
            doc_root = f"/var/www/{clean}/public" if clean else "/var/www/site/public"
        else:
            doc_root = f"/var/www/{clean}" if clean else "/var/www/site"

    resolved_ssl_email = ssl_email
    if (issue_ssl if issue_ssl is not None else tpl.get("issue_ssl")) and not resolved_ssl_email and domain:
        resolved_ssl_email = f"admin@{domain}"

    return {
        "template_id": template_id or tpl.get("id") or "static",
        "document_root": doc_root,
        "php_version": php_version if php_version is not None else tpl.get("php_version"),
        "php_modules": php_modules if php_modules is not None else list(tpl.get("php_modules") or []),
        "proxy_port": proxy_port if proxy_port is not None else tpl.get("proxy_port"),
        "create_database": create_database if create_database is not None else bool(tpl.get("create_database")),
        "issue_ssl": issue_ssl if issue_ssl is not None else bool(tpl.get("issue_ssl")),
        "ssl_email": resolved_ssl_email,
        "stack_preset": tpl.get("stack_preset"),
    }
