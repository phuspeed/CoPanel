from __future__ import annotations

# id → (title, icon hint, short description)
MODULE_CATALOG: dict[str, tuple[str, str, str]] = {
    "system_monitor": ("System Monitor", "Activity", "Real-time CPU, memory, disk, processes"),
    "firewall": ("Firewall", "Lock", "UFW rules and Fail2Ban"),
    "cron_manager": ("Cron Manager", "Clock", "Scheduled jobs"),
    "docker_manager": ("Docker", "Layers", "Containers start/stop/restart"),
    "database_manager": ("Database Manager", "Database", "MySQL / PostgreSQL"),
    "dns_manager": ("DNS Manager", "Network", "Zones and records"),
    "package_manager": ("Packages", "Package", "System services & packages"),
    "ssl_manager": ("SSL Manager", "Shield", "Certificates"),
    "terminal": ("Terminal", "Terminal", "Remote shell (Phase 2)"),
    "file_manager": ("File Manager", "Folder", "Browse files"),
    "web_manager": ("Web Manager", "Globe", "Nginx / sites"),
    "backup_manager": ("Backup Manager", "Cloud", "Cloud backups"),
    "system_cleaner": ("System Cleaner", "Trash", "Junk & disk analyzer"),
    "site_wizard": ("Site Wizard", "Wand", "1-click sites"),
    "appstore_manager": ("App Store", "ShoppingBag", "Install modules"),
}

# Screens implemented in this TUI version
IMPLEMENTED = frozenset({"system_monitor", "firewall", "cron_manager", "docker_manager"})
