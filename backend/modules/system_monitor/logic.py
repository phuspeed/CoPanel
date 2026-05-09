"""
System Monitor Module Logic
Provides system resource monitoring using psutil, listing processes, and PM2 management.
"""
from __future__ import annotations

import json
import os
import platform
import shutil
import signal
import subprocess
import time
from typing import Any, Dict, List, Optional, Tuple

import psutil


class SystemMonitor:
    """System monitoring functionality."""

    @staticmethod
    def _protected_pids() -> set:
        """PIDs that must not receive signals from the panel (avoid self-destruct)."""
        protected = {1, os.getpid()}
        return protected

    @staticmethod
    def get_cpu_usage() -> Dict[str, Any]:
        """Get CPU usage information."""
        try:
            cpu_percent = psutil.cpu_percent(interval=1)
            cpu_count = psutil.cpu_count()
            cpu_freq = psutil.cpu_freq()

            return {
                "percent": cpu_percent,
                "count": cpu_count,
                "frequency": {
                    "current": cpu_freq.current if cpu_freq else 0,
                    "min": cpu_freq.min if cpu_freq else 0,
                    "max": cpu_freq.max if cpu_freq else 0,
                } if cpu_freq else None
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_memory_usage() -> Dict[str, Any]:
        """Get memory usage information."""
        try:
            memory = psutil.virtual_memory()
            swap = psutil.swap_memory()

            return {
                "total": memory.total,
                "used": memory.used,
                "free": memory.free,
                "percent": memory.percent,
                "available": memory.available,
                "swap": {
                    "total": swap.total,
                    "used": swap.used,
                    "free": swap.free,
                    "percent": swap.percent,
                }
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_disk_usage() -> Dict[str, Any]:
        """Get disk usage information."""
        try:
            partitions = []
            for partition in psutil.disk_partitions():
                try:
                    usage = psutil.disk_usage(partition.mountpoint)
                    partitions.append({
                        "device": partition.device,
                        "mountpoint": partition.mountpoint,
                        "fstype": partition.fstype,
                        "total": usage.total,
                        "used": usage.used,
                        "free": usage.free,
                        "percent": usage.percent,
                    })
                except PermissionError:
                    continue

            return {"partitions": partitions}
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_network_stats() -> Dict[str, Any]:
        """Get network statistics."""
        try:
            net_io = psutil.net_io_counters()
            connections = len(psutil.net_connections())

            return {
                "bytes_sent": net_io.bytes_sent,
                "bytes_recv": net_io.bytes_recv,
                "packets_sent": net_io.packets_sent,
                "packets_recv": net_io.packets_recv,
                "connections": connections,
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_process_count() -> Dict[str, Any]:
        """Get process count."""
        try:
            status_counts: Dict[str, int] = {}
            for proc in psutil.process_iter(['status']):
                try:
                    status = proc.info.get("status") or "unknown"
                    status_counts[status] = status_counts.get(status, 0) + 1
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue

            return {
                "total": len(psutil.pids()),
                "running": status_counts.get(psutil.STATUS_RUNNING, 0),
                "sleeping": status_counts.get(psutil.STATUS_SLEEPING, 0),
                "stopped": status_counts.get(psutil.STATUS_STOPPED, 0),
                "zombie": status_counts.get(psutil.STATUS_ZOMBIE, 0),
                "status_counts": status_counts,
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_system_info() -> Dict[str, Any]:
        """Get system information."""
        try:
            boot_time = psutil.boot_time()
            return {
                "system": platform.system(),
                "platform": platform.platform(),
                "hostname": platform.node(),
                "processor": platform.processor(),
                "boot_time": boot_time,
                "uptime_seconds": int(time.time() - boot_time),
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_top_processes(limit: int = 48) -> List[Dict[str, Any]]:
        """Top processes by CPU + memory with richer fields (Linux-oriented)."""
        processes: List[Dict[str, Any]] = []
        try:
            procs: List[psutil.Process] = []
            for proc in psutil.process_iter():
                try:
                    procs.append(proc)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue

            for p in procs:
                try:
                    p.cpu_percent(interval=None)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue

            time.sleep(0.12)

            for p in procs:
                try:
                    cpu = p.cpu_percent(interval=None)
                    with p.oneshot():
                        info = p.as_dict(
                            attrs=[
                                "pid", "name", "username", "memory_percent",
                                "status", "num_threads", "create_time", "ppid",
                            ]
                        )
                    mi = p.memory_info()
                    rss = int(mi.rss) if mi else 0
                    cmdline: List[str] = []
                    try:
                        cmdline = p.cmdline() or []
                    except (psutil.AccessDenied, psutil.NoSuchProcess):
                        cmdline = []
                    preview = " ".join(cmdline)[:220] if cmdline else ""

                    processes.append({
                        "pid": info.get("pid"),
                        "name": info.get("name") or "",
                        "username": info.get("username"),
                        "cpu_percent": float(cpu or 0.0),
                        "memory_percent": float(info.get("memory_percent") or 0.0),
                        "rss": rss,
                        "status": info.get("status"),
                        "num_threads": info.get("num_threads"),
                        "create_time": info.get("create_time"),
                        "ppid": info.get("ppid"),
                        "cmdline_preview": preview,
                    })
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue

            processes.sort(
                key=lambda x: (x.get("cpu_percent") or 0) + (x.get("memory_percent") or 0),
                reverse=True,
            )
            return processes[: max(1, min(limit, 100))]
        except Exception:
            return []

    @staticmethod
    def _status_to_str(status: Any) -> Optional[str]:
        if status is None:
            return None
        if isinstance(status, str):
            return status
        try:
            return str(status)
        except Exception:
            return None

    @staticmethod
    def get_process_detail(pid: int) -> Optional[Dict[str, Any]]:
        """Single process snapshot for drawer / drill-down. Returns sparse dict on partial access."""
        if pid <= 0:
            return None
        try:
            p = psutil.Process(pid)
        except psutil.NoSuchProcess:
            return None
        except (psutil.Error, OSError):
            return None

        out: Dict[str, Any] = {
            "pid": pid,
            "name": "",
            "username": None,
            "cpu_percent": 0.0,
            "memory_percent": 0.0,
            "rss": 0,
            "vms": 0,
            "status": None,
            "num_threads": None,
            "create_time": None,
            "ppid": None,
            "exe": None,
            "cwd": None,
            "cmdline": [],
            "connections_tcp_udp": None,
        }

        try:
            out["name"] = p.name() or ""
        except (psutil.Error, OSError):
            pass

        try:
            out["username"] = p.username()
        except (psutil.Error, OSError):
            pass

        try:
            p.cpu_percent(interval=None)
            time.sleep(0.05)
            out["cpu_percent"] = float(p.cpu_percent(interval=None) or 0.0)
        except (psutil.Error, OSError):
            out["cpu_percent"] = 0.0

        try:
            with p.oneshot():
                info = p.as_dict(
                    attrs=[
                        "pid", "name", "username", "memory_percent", "status",
                        "num_threads", "create_time", "ppid", "exe", "cwd",
                    ]
                )
            if info.get("name"):
                out["name"] = str(info["name"])
            out["memory_percent"] = float(info.get("memory_percent") or 0.0)
            out["status"] = SystemMonitor._status_to_str(info.get("status"))
            out["num_threads"] = info.get("num_threads")
            out["create_time"] = info.get("create_time")
            out["ppid"] = info.get("ppid")
            if info.get("exe"):
                out["exe"] = info.get("exe")
            if info.get("cwd"):
                out["cwd"] = info.get("cwd")
        except (psutil.AccessDenied, psutil.Error, OSError):
            try:
                out["memory_percent"] = float(p.memory_percent() or 0.0)
            except Exception:
                pass

        try:
            mi = p.memory_info()
            if mi:
                out["rss"] = int(mi.rss)
                out["vms"] = int(mi.vms)
        except (psutil.Error, OSError):
            pass

        try:
            out["cmdline"] = list(p.cmdline() or [])
        except (psutil.Error, OSError):
            out["cmdline"] = []

        try:
            conns = p.net_connections(kind="inet")
            out["connections_tcp_udp"] = len(conns) if conns is not None else 0
        except (psutil.AccessDenied, psutil.NoSuchProcess, PermissionError, OSError, AttributeError):
            out["connections_tcp_udp"] = None

        if not out["name"]:
            out["name"] = f"pid-{pid}"
        return out

    @staticmethod
    def send_process_signal(pid: int, sig_name: str) -> Tuple[bool, str]:
        """
        Send SIGTERM (graceful) or SIGKILL (force) to a process.
        Returns (ok, code) where code is ok|protected_pid|invalid|no_such_process|permission_denied|unsupported.
        """
        if pid <= 0:
            return False, "invalid"

        if pid in SystemMonitor._protected_pids():
            return False, "protected_pid"

        if sig_name not in ("term", "kill"):
            return False, "invalid_signal"
        sig_map = {"term": signal.SIGTERM, "kill": signal.SIGKILL}
        sig = sig_map[sig_name]

        if platform.system() == "Windows":
            # psutil fallback for Windows dev machines
            try:
                proc = psutil.Process(pid)
                if sig_name == "kill":
                    proc.kill()
                else:
                    proc.terminate()
                return True, "ok"
            except psutil.NoSuchProcess:
                return False, "no_such_process"
            except psutil.AccessDenied:
                return False, "permission_denied"
            except Exception:
                return False, "error"

        try:
            os.kill(pid, sig)
            return True, "ok"
        except ProcessLookupError:
            return False, "no_such_process"
        except PermissionError:
            return False, "permission_denied"
        except OSError:
            return False, "error"

    @staticmethod
    def get_pm2_processes() -> List[Dict[str, Any]]:
        """Fetch PM2 processes details."""
        if not shutil.which("pm2"):
            return []
        try:
            res = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=5)
            if res.returncode == 0:
                return json.loads(res.stdout)
        except Exception:
            pass
        return []

    @staticmethod
    def manage_pm2(action: str, target: str) -> bool:
        """Control PM2 processes lifecycle."""
        if not shutil.which("pm2"):
            return False
        if action not in ["restart", "stop", "delete", "start"]:
            return False
        try:
            res = subprocess.run(["pm2", action, target], capture_output=True, text=True, timeout=5)
            return res.returncode == 0
        except Exception:
            return False

    @staticmethod
    def get_all_stats() -> Dict[str, Any]:
        """Get all system statistics."""
        return {
            "system": SystemMonitor.get_system_info(),
            "cpu": SystemMonitor.get_cpu_usage(),
            "memory": SystemMonitor.get_memory_usage(),
            "disk": SystemMonitor.get_disk_usage(),
            "network": SystemMonitor.get_network_stats(),
            "processes": SystemMonitor.get_process_count(),
            "top_processes": SystemMonitor.get_top_processes(),
            "pm2": SystemMonitor.get_pm2_processes(),
        }
