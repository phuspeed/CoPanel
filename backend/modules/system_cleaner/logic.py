import os
import subprocess
from typing import Dict, List, Any

def get_dir_size(path: str) -> int:
    """Returns size of a directory in bytes using du."""
    if not os.path.exists(path):
        return 0
    try:
        res = subprocess.run(["du", "-sb", path], capture_output=True, text=True, timeout=10)
        if res.returncode == 0 and res.stdout.strip():
            return int(res.stdout.split()[0])
    except Exception:
        pass
    return 0

def get_junk_info() -> Dict[str, Any]:
    # APT cache size
    apt_size = get_dir_size("/var/cache/apt/archives")
    
    # Journald size
    journal_size = 0
    try:
        res = subprocess.run(["journalctl", "--disk-usage"], capture_output=True, text=True, timeout=10)
        # output example: Archived and active journals take up 128.0M in the file system.
        # we can just use du on /var/log/journal
        journal_size = get_dir_size("/var/log/journal")
    except Exception:
        pass

    # Old rotated logs size (/var/log/*.gz, /var/log/*.[1-9])
    old_logs_size = 0
    try:
        res = subprocess.run(
            ["find", "/var/log", "-type", "f", "-name", "*.gz", "-o", "-type", "f", "-name", "*.[1-9]"],
            capture_output=True, text=True, timeout=10
        )
        if res.returncode == 0:
            for file_path in res.stdout.splitlines():
                if os.path.isfile(file_path):
                    old_logs_size += os.path.getsize(file_path)
    except Exception:
        pass

    return {
        "apt_cache_bytes": apt_size,
        "journal_bytes": journal_size,
        "old_logs_bytes": old_logs_size,
        "total_bytes": apt_size + journal_size + old_logs_size
    }

def clean_junk(categories: List[str]) -> Dict[str, Any]:
    logs = []
    freed = 0
    
    if "apt" in categories:
        try:
            # Clean apt
            subprocess.run(["apt-get", "clean", "-y"], capture_output=True, timeout=30)
            subprocess.run(["apt-get", "autoremove", "-y"], capture_output=True, timeout=60)
            logs.append("Cleaned APT cache and autoremoved unused packages.")
        except Exception as e:
            logs.append(f"Failed to clean APT: {str(e)}")

    if "journal" in categories:
        try:
            subprocess.run(["journalctl", "--vacuum-time=3d"], capture_output=True, timeout=30)
            logs.append("Vacuumed systemd journal (kept last 3 days).")
        except Exception as e:
            logs.append(f"Failed to vacuum journal: {str(e)}")

    if "old_logs" in categories:
        try:
            res = subprocess.run(
                ["find", "/var/log", "-type", "f", "-name", "*.gz", "-o", "-type", "f", "-name", "*.[1-9]"],
                capture_output=True, text=True, timeout=10
            )
            count = 0
            if res.returncode == 0:
                for file_path in res.stdout.splitlines():
                    if os.path.isfile(file_path):
                        os.remove(file_path)
                        count += 1
            logs.append(f"Removed {count} old log files.")
        except Exception as e:
            logs.append(f"Failed to remove old logs: {str(e)}")

    return {"status": "ok", "logs": logs}

def get_disk_tree(path: str) -> List[Dict[str, Any]]:
    if not os.path.isdir(path):
        raise ValueError(f"Path is not a directory: {path}")

    # Use du --max-depth=1 to get sizes of immediate children
    # -b for bytes, -x to not cross filesystems
    try:
        res = subprocess.run(["du", "-b", "-x", "--max-depth=1", path], capture_output=True, text=True, timeout=60)
        if res.returncode != 0 and not res.stdout:
            raise RuntimeError(f"du failed: {res.stderr}")
    except Exception as e:
        raise RuntimeError(f"Command execution failed: {str(e)}")

    items = []
    lines = res.stdout.strip().splitlines()
    for line in lines:
        parts = line.split("\t", 1)
        if len(parts) == 2:
            size_str, item_path = parts
            # skip the parent itself if we have other items, or we can include it
            if item_path == path:
                continue
                
            name = os.path.basename(item_path.rstrip("/"))
            is_dir = os.path.isdir(item_path)
            items.append({
                "name": name,
                "path": item_path,
                "type": "folder" if is_dir else "file",
                "size_bytes": int(size_str)
            })
            
    # Sort by size descending
    items.sort(key=lambda x: x["size_bytes"], reverse=True)
    return items

def get_large_files(path: str = "/", min_size_mb: int = 50) -> List[Dict[str, Any]]:
    """Find files larger than min_size_mb."""
    # find / -xdev -type f -size +50M -printf "%s\t%p\n"
    if not os.path.isdir(path):
        raise ValueError("Invalid path")
        
    try:
        size_arg = f"+{min_size_mb}M"
        cmd = ["find", path, "-xdev", "-type", "f", "-size", size_arg, "-printf", "%s\t%p\n"]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        items = []
        for line in res.stdout.strip().splitlines():
            parts = line.split("\t", 1)
            if len(parts) == 2:
                items.append({
                    "name": os.path.basename(parts[1]),
                    "path": parts[1],
                    "size_bytes": int(parts[0])
                })
                
        # Sort descending by size, limit top 100
        items.sort(key=lambda x: x["size_bytes"], reverse=True)
        return items[:100]
    except Exception as e:
        raise RuntimeError(f"Failed to find large files: {str(e)}")

def delete_file_or_dir(path: str) -> bool:
    if not os.path.exists(path):
        return False
    # Extremely basic safety check (do not delete / or /etc etc)
    unsafe = ["/", "/etc", "/bin", "/usr", "/var", "/boot", "/dev", "/proc", "/sys", "/lib", "/opt/copanel"]
    # Allow deletion if it's deeply nested, but not the roots
    if os.path.abspath(path) in unsafe:
        raise ValueError("Unsafe operation: Cannot delete system directories.")
        
    try:
        if os.path.isdir(path):
            import shutil
            shutil.rmtree(path)
        else:
            os.remove(path)
        return True
    except Exception as e:
        raise RuntimeError(f"Failed to delete {path}: {str(e)}")
