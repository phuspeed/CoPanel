"""
System Monitor Module Logic
Provides system resource monitoring using psutil, listing processes, and PM2 management.
"""
import psutil
from typing import Dict, Any, List
import platform
import shutil
import subprocess
import json


class SystemMonitor:
    """System monitoring functionality."""
    
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
            return {
                "total": len(psutil.pids()),
                "running": 0,
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
                "uptime_seconds": int(psutil.time.time() - boot_time),
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def get_top_processes() -> List[Dict[str, Any]]:
        """Get the top 20 active processes by CPU/Memory."""
        processes = []
        try:
            for proc in psutil.process_iter(['pid', 'name', 'username', 'cpu_percent', 'memory_percent']):
                try:
                    processes.append(proc.info)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            processes.sort(key=lambda p: (p.get('cpu_percent') or 0) + (p.get('memory_percent') or 0), reverse=True)
            return processes[:20]
        except Exception:
            return []

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
