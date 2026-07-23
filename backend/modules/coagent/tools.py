"""Safe OS tool wrappers for CoAgent (no arbitrary shell execution)."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .sanitizers import (
    SanitizeError,
    assert_firewall_port_safe,
    sanitize_domain,
    sanitize_firewall_action,
    sanitize_log_lines,
    sanitize_nginx_action,
    sanitize_port,
    sanitize_protocol,
    sanitize_service_name,
    truncate_text,
)

IS_WINDOWS = os.name == "nt"

# Tool metadata used by the agent + OpenAI function schemas
TOOL_DEFS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_system_metrics",
            "description": "Read current VPS CPU, RAM, SWAP, and disk usage percentages.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_service_status",
            "description": "Check systemd service status (e.g. nginx, mysql, docker).",
            "parameters": {
                "type": "object",
                "properties": {
                    "service_name": {
                        "type": "string",
                        "description": "Systemd unit name without .service suffix is OK.",
                    }
                },
                "required": ["service_name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_system_logs",
            "description": "Read recent journalctl logs for a systemd service.",
            "parameters": {
                "type": "object",
                "properties": {
                    "service_name": {"type": "string"},
                    "lines": {
                        "type": "integer",
                        "description": "Number of log lines (default 50, max 200).",
                    },
                },
                "required": ["service_name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "restart_service",
            "description": "Restart a systemd service. REQUIRES user confirmation before execution.",
            "parameters": {
                "type": "object",
                "properties": {"service_name": {"type": "string"}},
                "required": ["service_name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clear_system_cache",
            "description": "Drop Linux page cache / buffers to free RAM. REQUIRES user confirmation.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_nginx_vhost",
            "description": (
                "Create/update/delete an Nginx reverse-proxy vhost for a domain pointing to a local port. "
                "Optionally issue Let's Encrypt SSL via certbot. REQUIRES user confirmation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "update", "delete"],
                        "description": "create|update|delete",
                    },
                    "domain": {"type": "string"},
                    "port": {
                        "type": "integer",
                        "description": "Upstream app port on 127.0.0.1 (e.g. 8000).",
                    },
                    "enable_ssl": {
                        "type": "boolean",
                        "description": "If true, attempt certbot SSL after create/update.",
                    },
                    "ssl_email": {
                        "type": "string",
                        "description": "Email for Let's Encrypt (required when enable_ssl=true).",
                    },
                },
                "required": ["action", "domain"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_firewall_port",
            "description": (
                "Add or remove a UFW firewall rule for a port. "
                "REQUIRES user confirmation. Cannot deny/delete ports 22 or 8686."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "port": {"type": "integer"},
                    "protocol": {"type": "string", "enum": ["tcp", "udp"]},
                    "action": {"type": "string", "enum": ["allow", "deny", "delete"]},
                },
                "required": ["port", "action"],
                "additionalProperties": False,
            },
        },
    },
]

READ_ONLY_TOOLS = frozenset(
    {"get_system_metrics", "get_service_status", "read_system_logs"}
)
ACTION_TOOLS = frozenset(
    {
        "restart_service",
        "clear_system_cache",
        "manage_nginx_vhost",
        "manage_firewall_port",
    }
)


def is_readonly(tool_name: str) -> bool:
    return tool_name in READ_ONLY_TOOLS


def _run(cmd: List[str], *, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        shell=False,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _run_privileged(cmd: List[str], *, timeout: int = 60) -> subprocess.CompletedProcess:
    proc = _run(cmd, timeout=timeout)
    if proc.returncode == 0 or IS_WINDOWS:
        return proc
    sudo_bin = shutil.which("sudo")
    if sudo_bin:
        return _run([sudo_bin, "-n", *cmd], timeout=timeout)
    return proc


def _ok(summary: str, data: Any = None, **extra) -> Dict[str, Any]:
    out: Dict[str, Any] = {"ok": True, "summary": summary}
    if data is not None:
        out["data"] = data
    out.update(extra)
    return out


def _err(message: str, **extra) -> Dict[str, Any]:
    out: Dict[str, Any] = {"ok": False, "summary": message, "error": message}
    out.update(extra)
    return out


# ---------------------------------------------------------------------------
# READ tools
# ---------------------------------------------------------------------------


def get_system_metrics() -> Dict[str, Any]:
    try:
        from modules.system_monitor.logic import SystemMonitor

        cpu = SystemMonitor.get_cpu_usage()
        mem = SystemMonitor.get_memory_usage()
        disk = SystemMonitor.get_disk_usage()
        agg = disk.get("aggregate") or {}
        data = {
            "cpu_percent": cpu.get("percent"),
            "cpu_count": cpu.get("count"),
            "memory_percent": mem.get("percent"),
            "memory_used": mem.get("used"),
            "memory_total": mem.get("total"),
            "memory_available": mem.get("available"),
            "swap_percent": (mem.get("swap") or {}).get("percent"),
            "swap_used": (mem.get("swap") or {}).get("used"),
            "swap_total": (mem.get("swap") or {}).get("total"),
            "disk_percent": agg.get("percent"),
            "disk_used": agg.get("used"),
            "disk_total": agg.get("total"),
            "disk_free": agg.get("free"),
        }
        summary = (
            f"CPU {data.get('cpu_percent')}%, "
            f"RAM {data.get('memory_percent')}%, "
            f"SWAP {data.get('swap_percent')}%, "
            f"Disk {data.get('disk_percent')}%"
        )
        return _ok(summary, data)
    except Exception as exc:
        return _err(f"Failed to read system metrics: {exc}")


def get_service_status(service_name: str) -> Dict[str, Any]:
    try:
        svc = sanitize_service_name(service_name)
    except SanitizeError as exc:
        return _err(str(exc))

    if IS_WINDOWS:
        return _ok(
            f"Service {svc} appears active (mock)",
            {"service": svc, "active": "active", "status_text": f"mock status for {svc}"},
            command_preview=f"systemctl status {svc} --no-pager -l",
        )

    active = _run(["systemctl", "is-active", svc], timeout=15)
    status = _run(["systemctl", "status", svc, "--no-pager", "-l"], timeout=20)
    text = truncate_text((status.stdout or status.stderr or "").strip(), 6000)
    state = (active.stdout or "").strip() or "unknown"
    return _ok(
        f"Service {svc} is {state}",
        {"service": svc, "active": state, "status_text": text},
    )


def read_system_logs(service_name: str, lines: int = 50) -> Dict[str, Any]:
    try:
        svc = sanitize_service_name(service_name)
        n = sanitize_log_lines(lines)
    except SanitizeError as exc:
        return _err(str(exc))

    if IS_WINDOWS:
        return _ok(
            f"Mock logs for {svc}",
            {"service": svc, "lines": n, "logs": f"[mock] recent logs for {svc}"},
        )

    proc = _run(
        ["journalctl", "-u", svc, "-n", str(n), "--no-pager", "-o", "short-iso"],
        timeout=30,
    )
    text = truncate_text((proc.stdout or proc.stderr or "").strip(), 8000)
    if proc.returncode != 0 and not text:
        # Fallback: try common /var/log files for well-known services
        candidates = {
            "nginx": ["/var/log/nginx/error.log", "/var/log/nginx/access.log"],
            "apache2": ["/var/log/apache2/error.log"],
            "httpd": ["/var/log/httpd/error_log"],
        }
        for path in candidates.get(svc, []):
            p = Path(path)
            if p.is_file():
                try:
                    content = p.read_text(encoding="utf-8", errors="replace").splitlines()
                    text = truncate_text("\n".join(content[-n:]), 8000)
                    break
                except OSError:
                    continue
        if not text:
            return _err(f"Could not read logs for {svc}: {proc.stderr or 'unknown error'}")

    return _ok(f"Fetched last {n} log lines for {svc}", {"service": svc, "lines": n, "logs": text})


# ---------------------------------------------------------------------------
# ACTION tools (execute only after HITL confirmation)
# ---------------------------------------------------------------------------


def preview_restart_service(service_name: str) -> Tuple[Dict[str, Any], str, str]:
    svc = sanitize_service_name(service_name)
    args = {"service_name": svc}
    preview = f"systemctl restart {svc}"
    title = f"Restart service `{svc}`"
    return args, title, preview


def restart_service(service_name: str) -> Dict[str, Any]:
    try:
        svc = sanitize_service_name(service_name)
    except SanitizeError as exc:
        return _err(str(exc))

    if IS_WINDOWS:
        return _ok(f"Restarted {svc} (mock)", {"service": svc})

    proc = _run_privileged(["systemctl", "restart", svc], timeout=90)
    if proc.returncode != 0:
        return _err(
            f"Failed to restart {svc}: {truncate_text(proc.stderr or proc.stdout, 2000)}"
        )
    active = _run(["systemctl", "is-active", svc], timeout=15)
    state = (active.stdout or "").strip()
    return _ok(f"Restarted {svc}; now {state or 'unknown'}", {"service": svc, "active": state})


def preview_clear_system_cache() -> Tuple[Dict[str, Any], str, str]:
    return (
        {},
        "Clear system page cache (drop_caches)",
        "sync; echo 3 > /proc/sys/vm/drop_caches",
    )


def clear_system_cache() -> Dict[str, Any]:
    if IS_WINDOWS:
        return _ok("Cleared system cache (mock)")

    sync_proc = _run_privileged(["sync"], timeout=30)
    if sync_proc.returncode != 0:
        return _err(f"sync failed: {sync_proc.stderr or sync_proc.stdout}")

    # Prefer writing via tee under sudo to avoid shell=True
    drop = Path("/proc/sys/vm/drop_caches")
    if not drop.exists():
        return _err("/proc/sys/vm/drop_caches not available on this system.")

    tee = shutil.which("tee") or "/usr/bin/tee"
    sudo_bin = shutil.which("sudo")
    try:
        if sudo_bin:
            proc = subprocess.run(
                [sudo_bin, "-n", tee, str(drop)],
                input="3\n",
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
        else:
            proc = subprocess.run(
                [tee, str(drop)],
                input="3\n",
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
        if proc.returncode != 0:
            return _err(
                f"drop_caches failed: {truncate_text(proc.stderr or proc.stdout, 1500)}"
            )
    except Exception as exc:
        return _err(f"drop_caches failed: {exc}")

    return _ok("System page cache cleared successfully.")


def _nginx_paths() -> Tuple[Path, Path]:
    if IS_WINDOWS:
        base = Path("./test_nginx")
        avail = base / "sites-available"
        enabled = base / "sites-enabled"
        avail.mkdir(parents=True, exist_ok=True)
        enabled.mkdir(parents=True, exist_ok=True)
        return avail, enabled
    return Path("/etc/nginx/sites-available"), Path("/etc/nginx/sites-enabled")


def _proxy_template(domain: str, upstream_port: int, listen: int = 80) -> str:
    server_names = domain
    if not domain.startswith("www.") and "." in domain:
        server_names = f"{domain} www.{domain}"
    return f"""server {{
    listen {listen};
    server_name {server_names};
    client_max_body_size 500M;

    location / {{
        proxy_pass http://127.0.0.1:{upstream_port};
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


def preview_manage_nginx_vhost(
    action: str,
    domain: str,
    port: Optional[int] = None,
    enable_ssl: bool = False,
    ssl_email: Optional[str] = None,
) -> Tuple[Dict[str, Any], str, str]:
    act = sanitize_nginx_action(action)
    dom = sanitize_domain(domain)
    args: Dict[str, Any] = {"action": act, "domain": dom, "enable_ssl": bool(enable_ssl)}
    if act != "delete":
        if port is None:
            raise SanitizeError("port is required for create/update.")
        args["port"] = sanitize_port(port)
    if enable_ssl:
        email = (ssl_email or "").strip()
        if not email or "@" not in email:
            raise SanitizeError("ssl_email is required when enable_ssl=true.")
        args["ssl_email"] = email

    fname = f"{dom}.conf"
    if act == "delete":
        preview = f"rm /etc/nginx/sites-enabled/{fname} /etc/nginx/sites-available/{fname}; nginx -t; systemctl reload nginx"
        title = f"Delete Nginx vhost `{dom}`"
    else:
        preview = (
            f"Write reverse-proxy for {dom} -> 127.0.0.1:{args['port']} "
            f"({fname}); nginx -t; systemctl reload nginx"
        )
        if enable_ssl:
            preview += f"; certbot --nginx -d {dom} -m {args['ssl_email']}"
        title = f"{act.title()} Nginx reverse proxy for `{dom}`"
    return args, title, preview


def manage_nginx_vhost(
    action: str,
    domain: str,
    port: Optional[int] = None,
    enable_ssl: bool = False,
    ssl_email: Optional[str] = None,
) -> Dict[str, Any]:
    try:
        args, _, _ = preview_manage_nginx_vhost(
            action, domain, port=port, enable_ssl=enable_ssl, ssl_email=ssl_email
        )
    except SanitizeError as exc:
        return _err(str(exc))

    act = args["action"]
    dom = args["domain"]
    avail, enabled = _nginx_paths()
    fname = f"{dom}.conf"
    avail_path = avail / fname
    enabled_path = enabled / fname

    if act == "delete":
        if IS_WINDOWS:
            for p in (avail_path, enabled_path):
                if p.exists():
                    p.unlink()
            return _ok(f"Deleted vhost {dom} (mock)")
        removed = []
        for p in (enabled_path, avail_path):
            if p.exists():
                rm = _run_privileged(["rm", "-f", str(p)], timeout=30)
                if rm.returncode != 0:
                    return _err(f"Failed to remove {p}: {rm.stderr or rm.stdout}")
                removed.append(str(p))
        test = _run_privileged(["nginx", "-t"], timeout=30)
        if test.returncode != 0:
            return _err(f"nginx -t failed after delete: {test.stderr or test.stdout}")
        _run_privileged(["systemctl", "reload", "nginx"], timeout=60)
        return _ok(f"Deleted Nginx vhost {dom}", {"removed": removed})

    upstream = int(args["port"])
    content = _proxy_template(dom, upstream)

    if IS_WINDOWS:
        avail_path.write_text(content, encoding="utf-8")
        if not enabled_path.exists():
            try:
                enabled_path.symlink_to(avail_path)
            except OSError:
                enabled_path.write_text(content, encoding="utf-8")
        msg = f"{act}d reverse proxy {dom} -> :{upstream} (mock)"
        if args.get("enable_ssl"):
            msg += " + SSL (mock)"
        return _ok(msg, {"file": str(avail_path), "port": upstream})

    # Write via temp + install to handle permissions
    tmp = Path(f"/tmp/coagent_{fname}")
    try:
        tmp.write_text(content, encoding="utf-8")
        install = _run_privileged(["install", "-m", "644", str(tmp), str(avail_path)], timeout=30)
        if install.returncode != 0:
            # fallback: tee
            tee = shutil.which("tee") or "/usr/bin/tee"
            sudo_bin = shutil.which("sudo")
            cmd = [sudo_bin, "-n", tee, str(avail_path)] if sudo_bin else [tee, str(avail_path)]
            proc = subprocess.run(
                cmd, input=content, capture_output=True, text=True, timeout=30, check=False
            )
            if proc.returncode != 0:
                return _err(f"Failed to write vhost: {install.stderr or proc.stderr}")
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass

    if not enabled_path.exists():
        link = _run_privileged(["ln", "-sf", str(avail_path), str(enabled_path)], timeout=15)
        if link.returncode != 0:
            return _err(f"Failed to enable site: {link.stderr or link.stdout}")

    test = _run_privileged(["nginx", "-t"], timeout=30)
    if test.returncode != 0:
        return _err(f"nginx -t failed: {truncate_text(test.stderr or test.stdout, 2000)}")

    reload = _run_privileged(["systemctl", "reload", "nginx"], timeout=60)
    if reload.returncode != 0:
        return _err(f"nginx reload failed: {reload.stderr or reload.stdout}")

    result_data: Dict[str, Any] = {"domain": dom, "port": upstream, "file": str(avail_path)}

    if args.get("enable_ssl"):
        try:
            from modules.ssl_manager.logic import SSLManager

            ssl_res = SSLManager.issue_certbot(dom, args["ssl_email"])
            result_data["ssl"] = ssl_res
            if ssl_res.get("status") != "success":
                return _ok(
                    f"Vhost ready for {dom}, but SSL failed: {ssl_res.get('message')}",
                    result_data,
                )
        except Exception as exc:
            return _ok(f"Vhost ready for {dom}, but SSL error: {exc}", result_data)

    return _ok(f"Nginx reverse proxy {act}d for {dom} -> 127.0.0.1:{upstream}", result_data)


def preview_manage_firewall_port(
    port: int, protocol: str = "tcp", action: str = "allow"
) -> Tuple[Dict[str, Any], str, str]:
    p = sanitize_port(port)
    proto = sanitize_protocol(protocol)
    act = sanitize_firewall_action(action)
    assert_firewall_port_safe(p, act)
    port_spec = f"{p}/{proto}"
    args = {"port": p, "protocol": proto, "action": act}
    if act == "delete":
        preview = f"ufw --force delete allow {port_spec}  # (and matching deny if present)"
        title = f"Delete firewall rule for `{port_spec}`"
    else:
        preview = f"ufw {act} {port_spec}"
        title = f"Firewall {act} `{port_spec}`"
    return args, title, preview


def manage_firewall_port(port: int, protocol: str = "tcp", action: str = "allow") -> Dict[str, Any]:
    try:
        args, _, _ = preview_manage_firewall_port(port, protocol, action)
    except SanitizeError as exc:
        return _err(str(exc))

    p = args["port"]
    proto = args["protocol"]
    act = args["action"]
    port_spec = f"{p}/{proto}"

    if IS_WINDOWS:
        return _ok(f"Firewall {act} {port_spec} (mock)", args)

    ufw = None
    for candidate in ("/usr/sbin/ufw", "/sbin/ufw", shutil.which("ufw")):
        if candidate and Path(candidate).exists():
            ufw = candidate
            break
    if not ufw:
        return _err("UFW is not installed on this system.")

    if act == "delete":
        # Try deleting both allow and deny variants
        ok_any = False
        details = []
        for base in ("allow", "deny"):
            proc = _run_privileged([ufw, "--force", "delete", base, port_spec], timeout=30)
            details.append((base, proc.returncode, (proc.stdout or proc.stderr or "").strip()))
            if proc.returncode == 0:
                ok_any = True
        if not ok_any:
            return _err(f"Failed to delete UFW rule for {port_spec}: {details}")
        return _ok(f"Deleted UFW rule(s) for {port_spec}", {"details": details})

    proc = _run_privileged([ufw, act, port_spec], timeout=30)
    if proc.returncode != 0:
        return _err(f"UFW {act} {port_spec} failed: {proc.stderr or proc.stdout}")
    return _ok(f"UFW {act} applied for {port_spec}", args)


# ---------------------------------------------------------------------------
# Registry / dispatch
# ---------------------------------------------------------------------------

_PREVIEWERS: Dict[str, Callable[..., Tuple[Dict[str, Any], str, str]]] = {
    "restart_service": lambda **kw: preview_restart_service(kw.get("service_name", "")),
    "clear_system_cache": lambda **kw: preview_clear_system_cache(),
    "manage_nginx_vhost": lambda **kw: preview_manage_nginx_vhost(
        kw.get("action", "create"),
        kw.get("domain", ""),
        port=kw.get("port"),
        enable_ssl=bool(kw.get("enable_ssl", False)),
        ssl_email=kw.get("ssl_email"),
    ),
    "manage_firewall_port": lambda **kw: preview_manage_firewall_port(
        kw.get("port"),
        protocol=kw.get("protocol", "tcp"),
        action=kw.get("action", "allow"),
    ),
}

_EXECUTORS: Dict[str, Callable[..., Dict[str, Any]]] = {
    "get_system_metrics": lambda **kw: get_system_metrics(),
    "get_service_status": lambda **kw: get_service_status(kw.get("service_name", "")),
    "read_system_logs": lambda **kw: read_system_logs(
        kw.get("service_name", ""), lines=kw.get("lines", 50)
    ),
    "restart_service": lambda **kw: restart_service(kw.get("service_name", "")),
    "clear_system_cache": lambda **kw: clear_system_cache(),
    "manage_nginx_vhost": lambda **kw: manage_nginx_vhost(
        kw.get("action", "create"),
        kw.get("domain", ""),
        port=kw.get("port"),
        enable_ssl=bool(kw.get("enable_ssl", False)),
        ssl_email=kw.get("ssl_email"),
    ),
    "manage_firewall_port": lambda **kw: manage_firewall_port(
        kw.get("port"),
        protocol=kw.get("protocol", "tcp"),
        action=kw.get("action", "allow"),
    ),
}

ACTION_RISK: Dict[str, str] = {
    "restart_service": "medium",
    "clear_system_cache": "low",
    "manage_nginx_vhost": "high",
    "manage_firewall_port": "high",
}


def build_action_preview(tool_name: str, raw_args: Dict[str, Any]) -> Dict[str, Any]:
    if tool_name not in _PREVIEWERS:
        raise SanitizeError(f"Unknown or non-action tool: {tool_name}")
    args, title, preview = _PREVIEWERS[tool_name](**(raw_args or {}))
    return {
        "tool": tool_name,
        "args": args,
        "title": title,
        "command_preview": preview,
        "risk": ACTION_RISK.get(tool_name, "medium"),
    }


def execute_tool(tool_name: str, raw_args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if tool_name not in _EXECUTORS:
        return _err(f"Unknown tool: {tool_name}")
    try:
        return _EXECUTORS[tool_name](**(raw_args or {}))
    except SanitizeError as exc:
        return _err(str(exc))
    except TypeError as exc:
        return _err(f"Invalid arguments for {tool_name}: {exc}")
    except Exception as exc:
        return _err(f"Tool {tool_name} failed: {exc}")


def list_tools_public() -> List[Dict[str, Any]]:
    out = []
    for item in TOOL_DEFS:
        fn = item["function"]
        name = fn["name"]
        out.append(
            {
                "name": name,
                "description": fn.get("description"),
                "readonly": is_readonly(name),
            }
        )
    return out


def tool_result_for_llm(result: Dict[str, Any]) -> str:
    """Compact JSON string for tool message content."""
    try:
        return json.dumps(result, ensure_ascii=False, default=str)[:12000]
    except Exception:
        return str(result)[:12000]
