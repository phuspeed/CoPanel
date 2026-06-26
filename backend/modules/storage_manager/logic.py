"""
Storage Manager — block devices, volumes, SMART health, and admin mount/format actions.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from modules.system_monitor.logic import SystemMonitor

IS_WINDOWS = os.name == "nt"

_SKIP_DISK_PREFIXES = ("loop", "sr", "ram", "zram", "fd", "dm-")
# Format + mount + fsck support
_ALLOWED_FSTYPES = frozenset({
    "ext4", "xfs", "btrfs", "vfat", "exfat", "ntfs", "hfsplus",
})
_FSCK_FSTYPES = frozenset({
    "ext4", "ext3", "ext2", "xfs", "btrfs", "vfat", "exfat", "ntfs", "hfsplus",
})
# Recognized on disk (mount / display); APFS is read-only on Linux
_RECOGNIZED_FSTYPES = _ALLOWED_FSTYPES | frozenset({"apfs", "hfs", "fat", "fat32", "ntfs3"})
_FSTYPE_ALIASES = {
    "fat": "vfat",
    "fat16": "vfat",
    "fat32": "vfat",
    "msdos": "vfat",
    "hfs": "hfsplus",
    "hfs+": "hfsplus",
    "ntfs3": "ntfs",
}
_MOUNT_FSTYPES = {
    "vfat": "vfat",
    "exfat": "exfat",
    "ntfs": "ntfs-3g",
    "hfsplus": "hfsplus",
    "apfs": "apfs",
}
_DEFAULT_MOUNT_OPTIONS = {
    "vfat": "defaults,uid=1000,gid=1000,umask=022",
    "exfat": "defaults,uid=1000,gid=1000,umask=022",
    "ntfs": "defaults,uid=1000,gid=1000",
    "hfsplus": "ro",
    "apfs": "ro",
}
_FSTYPE_LABELS = {
    "ext4": "ext4 (Linux)",
    "xfs": "XFS (Linux)",
    "btrfs": "Btrfs (Linux)",
    "vfat": "FAT32 / VFAT",
    "exfat": "exFAT",
    "ntfs": "NTFS (Windows)",
    "hfsplus": "HFS+ (macOS)",
    "apfs": "APFS (Apple, read-only)",
}
_PROTECTED_MOUNTS = frozenset({"/", "/boot", "/boot/efi", "/usr", "/var"})
_DEVICE_RE = re.compile(r"^/dev/(?P<name>[a-zA-Z0-9_-]+)$")
_FSTAB_PATH = Path("/etc/fstab")
_SKIP_FSTYPES = frozenset({
    "", "tmpfs", "devtmpfs", "proc", "sysfs", "cgroup", "cgroup2",
    "pstore", "bpf", "tracefs", "fusectl", "mqueue", "overlay",
    "rpc_pipefs", "autofs", "binfmt_misc", "securityfs", "debugfs",
    "squashfs", "fuse.portal", "fuse.gvfsd-fuse",
})

# Older util-linux (e.g. Ubuntu 20.04) lacks STATE/HOTPLUG — try simpler sets first.
_LSBLK_COLUMN_SETS = (
    "NAME,KNAME,TYPE,SIZE,ROTA,RO,MODEL,SERIAL,FSTYPE,MOUNTPOINT,PKNAME,TRAN,RM",
    "NAME,TYPE,SIZE,FSTYPE,MOUNTPOINT,PKNAME,ROTA,RM,MODEL,SERIAL,TRAN",
    "NAME,TYPE,SIZE,FSTYPE,MOUNTPOINT,PKNAME,ROTA,RM",
    "NAME,TYPE,SIZE,FSTYPE,MOUNTPOINT,PKNAME",
)

_PARTITION_ROW_TYPES = frozenset({"part", "primary", "extended", "logical", "lvm", "crypt"})
_PARTED_FREE_RE = re.compile(
    r"^\s*([\d.]+\s*(?:MiB|GiB|MB|GB|kB|KB|B|%)?)\s+([\d.]+\s*(?:MiB|GiB|MB|GB|kB|KB|B|%)?)\s+([\d.]+\s*(?:MiB|GiB|MB|GB|kB|KB|B)?)\s+Free\s+Space\s*$",
    re.IGNORECASE,
)

MOCK_DISKS: List[Dict[str, Any]] = [
    {
        "name": "sda",
        "path": "/dev/sda",
        "size_bytes": 2_000_398_934_016,
        "model": "WDC WD20EFRX-68EUZN0",
        "serial": "WD-WCC4E1234567",
        "transport": "sata",
        "rotational": True,
        "removable": False,
        "state": "running",
        "is_system_disk": True,
        "partitions": [
            {"name": "sda1", "path": "/dev/sda1", "size_bytes": 536_870_912_000, "fstype": "ext4", "mountpoint": "/"},
            {"name": "sda2", "path": "/dev/sda2", "size_bytes": 1_463_528_934_016, "fstype": "ext4", "mountpoint": "/data"},
        ],
        "smart": {
            "available": True,
            "passed": True,
            "status": "healthy",
            "health_percent": 92,
            "temperature_c": 34,
            "power_on_hours": 18240,
            "power_cycle_count": 890,
            "host_reads_gb": 12500.5,
            "host_writes_gb": 4820.2,
            "reallocated_sectors": 0,
            "message": "SMART overall-health self-assessment test result: PASSED",
        },
    },
    {
        "name": "nvme0n1",
        "path": "/dev/nvme0n1",
        "size_bytes": 512_110_190_592,
        "model": "Samsung SSD 980 PRO 500GB",
        "serial": "S5GXNX0T123456",
        "transport": "nvme",
        "rotational": False,
        "removable": False,
        "state": "running",
        "is_system_disk": False,
        "partitions": [
            {"name": "nvme0n1p1", "path": "/dev/nvme0n1p1", "size_bytes": 512_110_190_592, "fstype": "xfs", "mountpoint": "/mnt/nvme"},
        ],
        "smart": {
            "available": True,
            "passed": True,
            "status": "healthy",
            "health_percent": 97,
            "temperature_c": 41,
            "power_on_hours": 4200,
            "power_cycle_count": 312,
            "host_reads_gb": 8200.0,
            "host_writes_gb": 3100.5,
            "reallocated_sectors": None,
            "message": "SMART overall-health self-assessment test result: PASSED",
        },
    },
]

BENCHMARK_TASKS: Dict[str, Any] = {}

MOCK_VOLUMES: List[Dict[str, Any]] = [
    {
        "device": "/dev/sda1",
        "mountpoint": "/",
        "fstype": "ext4",
        "total": 500_000_000_000,
        "used": 350_000_000_000,
        "free": 150_000_000_000,
        "percent": 70.0,
    },
    {
        "device": "/dev/sda2",
        "mountpoint": "/data",
        "fstype": "ext4",
        "total": 1_400_000_000_000,
        "used": 900_000_000_000,
        "free": 500_000_000_000,
        "percent": 64.3,
    },
    {
        "device": "/dev/nvme0n1p1",
        "mountpoint": "/mnt/nvme",
        "fstype": "xfs",
        "total": 500_000_000_000,
        "used": 120_000_000_000,
        "free": 380_000_000_000,
        "percent": 24.0,
    },
]

MOCK_POOLS: Dict[str, Any] = {
    "lvm": {
        "available": True,
        "volume_groups": [
            {"vg_name": "data-vg", "vg_size_bytes": 2_000_398_934_016, "vg_free_bytes": 500_000_000_000, "pv_count": 2, "lv_count": 1},
        ],
        "logical_volumes": [
            {
                "lv_name": "data-lv",
                "vg_name": "data-vg",
                "lv_path": "/dev/data-vg/data-lv",
                "lv_size_bytes": 1_500_398_934_016,
                "mountpoint": "/data",
                "fstype": "ext4",
            },
        ],
        "physical_volumes": [
            {"pv_name": "/dev/sdb1", "vg_name": "data-vg", "pv_size_bytes": 1_000_199_467_008},
            {"pv_name": "/dev/sdc1", "vg_name": "data-vg", "pv_size_bytes": 1_000_199_467_008},
        ],
    },
    "raid": {
        "available": True,
        "arrays": [
            {
                "name": "md0",
                "path": "/dev/md0",
                "level": "raid1",
                "state": "active",
                "size_bytes": 976_630_336,
                "devices": ["/dev/sdb1", "/dev/sdc1"],
                "health": "clean",
            },
        ],
    },
}


class StorageManagerError(Exception):
    def __init__(self, message: str, code: str = "storage_error"):
        super().__init__(message)
        self.code = code


class StorageService:
    def __init__(self, command_timeout: int = 45):
        self.command_timeout = command_timeout

    def _run(self, args: List[str], timeout: Optional[int] = None) -> subprocess.CompletedProcess:
        try:
            return subprocess.run(
                args,
                capture_output=True,
                text=True,
                check=False,
                timeout=timeout or self.command_timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise StorageManagerError("Command timed out", code="timeout") from exc
        except Exception as exc:
            raise StorageManagerError(f"Command failed: {exc}", code="exec_failed") from exc

    def _parse_size(self, raw: Any) -> int:
        if raw is None:
            return 0
        if isinstance(raw, (int, float)):
            return int(raw)
        text = str(raw).strip()
        if not text:
            return 0
        if text.isdigit():
            return int(text)
        m = re.match(r"^([\d.]+)\s*([KMGTPE])?i?B?$", text, re.I)
        if not m:
            return 0
        num = float(m.group(1))
        unit = (m.group(2) or "").upper()
        mult = {"": 1, "K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4, "P": 1024**5, "E": 1024**6}
        return int(num * mult.get(unit, 1))

    def _should_skip_disk_name(self, name: str) -> bool:
        base = (name or "").strip()
        if not base:
            return True
        return any(base.startswith(p) for p in _SKIP_DISK_PREFIXES)

    def _normalize_fstype(self, fstype: Optional[str]) -> Optional[str]:
        if not fstype:
            return None
        key = str(fstype).strip().lower()
        if not key:
            return None
        return _FSTYPE_ALIASES.get(key, key)

    def _probe_fstype(self, device_path: str) -> Optional[str]:
        if IS_WINDOWS or not shutil.which("blkid"):
            return None
        result = self._run(["blkid", "-o", "value", "-s", "TYPE", device_path], timeout=15)
        if result.returncode != 0:
            return None
        return self._normalize_fstype((result.stdout or "").strip())

    def _enrich_partition_fstype(self, part: Dict[str, Any]) -> Dict[str, Any]:
        path = part.get("path") or ""
        fstype = self._normalize_fstype(part.get("fstype"))
        if not fstype and path:
            fstype = self._probe_fstype(path)
        if fstype:
            part = dict(part)
            part["fstype"] = fstype
            part["fstype_label"] = _FSTYPE_LABELS.get(fstype, fstype.upper())
        return part

    def _read_sysfs(self, block_name: str, field: str) -> Optional[str]:
        path = f"/sys/block/{block_name}/device/{field}"
        if not os.path.isfile(path):
            path = f"/sys/block/{block_name}/{field}"
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                return fh.read().strip() or None
        except OSError:
            return None

    def _lsblk_bin(self) -> str:
        found = self._lsblk_bin_optional()
        if not found:
            raise StorageManagerError("lsblk not found. Install util-linux.", code="lsblk_missing")
        return found

    def _lsblk_bin_optional(self) -> Optional[str]:
        for candidate in ("/usr/bin/lsblk", "/bin/lsblk", "/sbin/lsblk"):
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
        return shutil.which("lsblk")

    def _lsblk_rows(self) -> List[Dict[str, Any]]:
        if IS_WINDOWS:
            return []
        lsblk = self._lsblk_bin()
        last_err = ""
        for cols in _LSBLK_COLUMN_SETS:
            result = self._run([lsblk, "-J", "-b", "-o", cols])
            if result.returncode != 0 or not (result.stdout or "").strip():
                last_err = (result.stderr or result.stdout or "").strip() or "lsblk failed"
                continue
            try:
                payload = json.loads(result.stdout)
            except json.JSONDecodeError:
                last_err = "Invalid lsblk JSON output"
                continue
            rows = payload.get("blockdevices") or []
            if rows:
                return rows
            last_err = "lsblk returned no block devices"
        raise StorageManagerError(
            last_err or "Failed to list block devices",
            code="lsblk_failed",
        )

    def _flatten_lsblk(self, nodes: List[Dict[str, Any]], parent: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        flat: List[Dict[str, Any]] = []
        for node in nodes:
            item = dict(node)
            item["_parent_name"] = parent.get("name") if parent else None
            flat.append(item)
            children = node.get("children") or []
            if children:
                flat.extend(self._flatten_lsblk(children, node))
        return flat

    def _system_disk_names(self, flat: List[Dict[str, Any]]) -> set:
        names: set = set()
        by_name = {row.get("name"): row for row in flat if row.get("name")}
        for row in flat:
            mp = row.get("mountpoint") or ""
            if mp in ("/", "/boot", "/boot/efi"):
                current = row
                while current:
                    pk = current.get("pkname") or current.get("_parent_name")
                    if current.get("type") == "disk":
                        names.add(str(current.get("name")))
                        break
                    current = by_name.get(pk) if pk else None
        return names

    def _is_descendant_of_disk(self, node_name: str, disk_name: str, flat: List[Dict[str, Any]]) -> bool:
        by_name = {row.get("name"): row for row in flat if row.get("name")}
        current = by_name.get(node_name)
        seen: set = set()
        while current:
            if current.get("name") == disk_name:
                return True
            if current.get("type") == "disk":
                return str(current.get("name")) == disk_name
            pk = current.get("pkname") or current.get("_parent_name")
            if not pk or pk in seen:
                break
            seen.add(str(pk))
            if pk == disk_name:
                return True
            current = by_name.get(pk)
        return False

    def _partition_rows_for_disk(
        self,
        disk_name: str,
        flat: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        if flat is None:
            flat = self._get_flat_block()
        partitions: List[Dict[str, Any]] = []
        for part in flat:
            name = str(part.get("name") or "")
            if not name or name == disk_name:
                continue
            if part.get("type") not in _PARTITION_ROW_TYPES:
                continue
            if not self._is_descendant_of_disk(name, disk_name, flat):
                continue
            partitions.append(self._enrich_partition_fstype({
                "name": part.get("name"),
                "path": f"/dev/{part.get('name')}",
                "size_bytes": self._parse_size(part.get("size")),
                "fstype": part.get("fstype") or None,
                "mountpoint": part.get("mountpoint") or None,
                "type": part.get("type"),
            }))
        partitions.sort(key=lambda p: str(p.get("name") or ""))
        return partitions

    def _partitions_for_disk(self, disk_name: str, flat: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return self._partition_rows_for_disk(disk_name, flat)

    def list_disks(self, include_smart: bool = True) -> List[Dict[str, Any]]:
        if IS_WINDOWS:
            return [dict(d) for d in MOCK_DISKS]

        flat = self._flatten_lsblk(self._lsblk_rows())
        system_names = self._system_disk_names(flat)
        disks: List[Dict[str, Any]] = []

        for row in flat:
            if row.get("type") != "disk":
                continue
            name = str(row.get("name") or "")
            if self._should_skip_disk_name(name):
                continue

            model = (row.get("model") or "").strip() or self._read_sysfs(name, "model") or "Unknown"
            serial = (row.get("serial") or "").strip() or self._read_sysfs(name, "serial") or None
            transport = (row.get("tran") or "").strip().lower() or None
            rotational = bool(int(row.get("rota") or 0)) if row.get("rota") is not None else None

            partitions = self._partitions_for_disk(name, flat)

            smart_summary = self._smart_summary(name) if include_smart else {
                "available": False,
                "status": "unknown",
                "message": "SMART loaded on demand",
            }

            disks.append({
                "name": name,
                "path": f"/dev/{name}",
                "size_bytes": self._parse_size(row.get("size")),
                "model": model,
                "serial": serial,
                "transport": transport,
                "rotational": rotational,
                "removable": bool(int(row.get("rm") or 0)),
                "state": row.get("state") or "unknown",
                "is_system_disk": name in system_names,
                "partitions": partitions,
                "smart": smart_summary,
            })

        disks.sort(key=lambda d: d.get("name") or "")
        return disks

    def _smartctl_bin(self) -> Optional[str]:
        for candidate in ("/usr/sbin/smartctl", "/sbin/smartctl", "/usr/bin/smartctl"):
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
        return shutil.which("smartctl")

    def _smart_attr_raw(self, attrs: List[Dict[str, Any]], *needles: str) -> Optional[int]:
        needles_l = [n.lower() for n in needles]
        for attr in attrs:
            name = str(attr.get("name") or "").lower()
            if any(n in name for n in needles_l):
                raw = attr.get("raw") or {}
                val = raw.get("value")
                if val is not None:
                    try:
                        return int(val)
                    except (TypeError, ValueError):
                        continue
        return None

    def _gb_from_32mib_units(self, units: Optional[int]) -> Optional[float]:
        if units is None:
            return None
        return round(units * 32 / 1024, 2)

    def _gb_from_lba(self, lba: Optional[int], sector_bytes: int = 512) -> Optional[float]:
        if lba is None:
            return None
        return round(lba * sector_bytes / (1024 ** 3), 2)

    def _derive_health_percent(
        self,
        passed: Optional[bool],
        status: str,
        nvme_log: Dict[str, Any],
        attrs: List[Dict[str, Any]],
    ) -> Optional[int]:
        if isinstance(nvme_log, dict):
            used = nvme_log.get("percentage_used")
            if used is not None:
                try:
                    return max(0, min(100, 100 - int(used)))
                except (TypeError, ValueError):
                    pass
        wear = self._smart_attr_raw(attrs, "wear_leveling", "media_wearout", "percent_lifetime")
        if wear is not None and 0 <= wear <= 100:
            return int(wear)
        if passed is True:
            return 100
        if passed is False or status == "critical":
            return 0
        return None

    def _parse_smart_json(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        smart_status = payload.get("smart_status") or {}
        passed = smart_status.get("passed")
        temperature = None
        temp_obj = payload.get("temperature")
        if isinstance(temp_obj, dict):
            temperature = temp_obj.get("current")
        elif isinstance(temp_obj, int):
            temperature = temp_obj

        nvme_log = payload.get("nvme_smart_health_information_log") or {}
        if temperature is None and isinstance(nvme_log, dict):
            temperature = nvme_log.get("temperature")

        power_on_hours = None
        pot = payload.get("power_on_time") or {}
        if isinstance(pot, dict):
            power_on_hours = pot.get("hours")
        if power_on_hours is None and isinstance(nvme_log, dict):
            power_on_hours = nvme_log.get("power_on_hours")

        power_cycle_count = None
        if isinstance(nvme_log, dict):
            power_cycle_count = nvme_log.get("power_cycles")

        attrs = (payload.get("ata_smart_attributes") or {}).get("table") or []
        reallocated = self._smart_attr_raw(attrs, "reallocated")

        host_reads_gb = None
        host_writes_gb = None
        if isinstance(nvme_log, dict):
            unit_size = 512000
            dur = nvme_log.get("data_units_read")
            duw = nvme_log.get("data_units_written")
            if dur is not None:
                try:
                    host_reads_gb = round(int(dur) * unit_size / (1024 ** 3), 2)
                except (TypeError, ValueError):
                    pass
            if duw is not None:
                try:
                    host_writes_gb = round(int(duw) * unit_size / (1024 ** 3), 2)
                except (TypeError, ValueError):
                    pass
        if host_reads_gb is None:
            host_reads_gb = self._gb_from_32mib_units(
                self._smart_attr_raw(attrs, "host_reads", "total_host_reads", "host_reads_32mib")
            )
            if host_reads_gb is None:
                host_reads_gb = self._gb_from_lba(
                    self._smart_attr_raw(attrs, "total_lbas_read", "lba_read")
                )
        if host_writes_gb is None:
            host_writes_gb = self._gb_from_32mib_units(
                self._smart_attr_raw(attrs, "host_writes", "total_host_writes", "host_writes_32mib")
            )
            if host_writes_gb is None:
                host_writes_gb = self._gb_from_lba(
                    self._smart_attr_raw(attrs, "total_lbas_written", "lba_written")
                )

        if passed is True:
            status = "healthy"
        elif passed is False:
            status = "critical"
        else:
            status = "unknown"

        health_percent = self._derive_health_percent(passed, status, nvme_log, attrs)

        return {
            "available": True,
            "passed": passed,
            "status": status,
            "health_percent": health_percent,
            "temperature_c": temperature,
            "power_on_hours": power_on_hours,
            "power_cycle_count": power_cycle_count,
            "host_reads_gb": host_reads_gb,
            "host_writes_gb": host_writes_gb,
            "reallocated_sectors": reallocated,
            "media_errors": nvme_log.get("media_errors") if isinstance(nvme_log, dict) else None,
            "unsafe_shutdowns": nvme_log.get("unsafe_shutdowns") if isinstance(nvme_log, dict) else None,
            "message": smart_status.get("string") or payload.get("model_name") or "",
        }

    def _parse_smart_text(self, stdout: str) -> Dict[str, Any]:
        passed = None
        if re.search(r"PASSED", stdout, re.I):
            passed = True
        elif re.search(r"FAILED", stdout, re.I):
            passed = False

        temp = None
        m = re.search(r"Temperature(?:\s+Celsius)?\s*:\s*(\d+)", stdout, re.I)
        if m:
            temp = int(m.group(1))

        poh = None
        m = re.search(r"Power_On_Hours\s+\d+\s+\d+\s+\d+\s+(\d+)", stdout)
        if m:
            poh = int(m.group(1))

        realloc = None
        m = re.search(r"Reallocated_Sector_Ct\s+\d+\s+\d+\s+\d+\s+(\d+)", stdout)
        if m:
            realloc = int(m.group(1))

        host_reads_gb = None
        m = re.search(r"Host_Reads_32MiB\s+\d+\s+\d+\s+\d+\s+(\d+)", stdout)
        if m:
            host_reads_gb = self._gb_from_32mib_units(int(m.group(1)))
        m = re.search(r"Host_Writes_32MiB\s+\d+\s+\d+\s+\d+\s+(\d+)", stdout)
        host_writes_gb = self._gb_from_32mib_units(int(m.group(1))) if m else None

        status = "healthy" if passed is True else "critical" if passed is False else "unknown"
        health_percent = 100 if passed is True else 0 if passed is False else None
        return {
            "available": True,
            "passed": passed,
            "status": status,
            "health_percent": health_percent,
            "temperature_c": temp,
            "power_on_hours": poh,
            "power_cycle_count": None,
            "host_reads_gb": host_reads_gb,
            "host_writes_gb": host_writes_gb,
            "reallocated_sectors": realloc,
            "message": stdout.strip().splitlines()[0] if stdout.strip() else "",
        }

    def _smart_summary(self, disk_name: str) -> Dict[str, Any]:
        if IS_WINDOWS:
            for disk in MOCK_DISKS:
                if disk["name"] == disk_name:
                    return dict(disk.get("smart") or {})
            return {"available": False, "status": "unknown", "message": "SMART not available"}

        smartctl = self._smartctl_bin()
        if not smartctl:
            return {
                "available": False,
                "status": "unknown",
                "message": "smartmontools not installed",
            }

        dev = f"/dev/{disk_name}"
        attempts: List[List[str]] = [
            [smartctl, "-H", "-A", "-j", dev],
            [smartctl, "-H", "-A", "-j", "-d", "nvme", dev],
            [smartctl, "-H", "-j", dev],
            [smartctl, "-H", "-A", dev],
        ]

        last_err = ""
        for args in attempts:
            result = self._run(args, timeout=30)
            last_err = (result.stderr or result.stdout or "").strip()
            if result.returncode not in (0, 4) or not (result.stdout or "").strip():
                continue
            stdout = result.stdout.strip()
            if stdout.startswith("{"):
                try:
                    return self._parse_smart_json(json.loads(stdout))
                except json.JSONDecodeError:
                    pass
            return self._parse_smart_text(stdout)

        return {
            "available": False,
            "status": "unknown",
            "message": last_err or "SMART data unavailable",
        }

    def get_disk_smart(self, disk_name: str) -> Dict[str, Any]:
        disks = self.list_disks()
        match = next((d for d in disks if d.get("name") == disk_name), None)
        if not match:
            raise StorageManagerError(f"Disk not found: {disk_name}", code="disk_not_found")

        detail = self._smart_summary(disk_name)
        detail["disk"] = {
            "name": match.get("name"),
            "path": match.get("path"),
            "model": match.get("model"),
            "serial": match.get("serial"),
        }
        return detail

    # --- Disk benchmark (CrystalDiskMark-style) ---

    def _dd_transfer_rate_mibs(self, args: List[str], mebibytes: int, timeout: int = 300) -> float:
        start = time.perf_counter()
        result = self._run(args, timeout=timeout)
        elapsed = time.perf_counter() - start
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            raise StorageManagerError(detail or "Benchmark command failed", code="benchmark_failed")
        if elapsed <= 0:
            raise StorageManagerError("Benchmark completed too quickly to measure", code="benchmark_failed")
        return round(mebibytes / elapsed, 2)

    def _fio_rate_mibs(self, path: str, rw: str, bs: str, size_mb: int, runtime: int = 5) -> Optional[float]:
        fio = shutil.which("fio")
        if not fio:
            return None
        iodepth = 1 if rw.startswith("rand") else 8
        result = self._run(
            [fio, "--output-format=json", "--filename=" + path, f"--rw={rw}", f"--bs={bs}",
             f"--size={size_mb}M", "--numjobs=1", f"--iodepth={iodepth}",
             "--direct=1", f"--runtime={runtime}", "--time_based=1", "--name=copanel_bench"],
            timeout=runtime + 60,
        )
        if result.returncode != 0 or not (result.stdout or "").strip():
            return None
        try:
            payload = json.loads(result.stdout)
            jobs = payload.get("jobs") or []
            if not jobs:
                return None
            read_bw = (jobs[0].get("read") or {}).get("bw_bytes")
            write_bw = (jobs[0].get("write") or {}).get("bw_bytes")
            bw = write_bw if rw.startswith("write") or rw == "randwrite" else read_bw
            if bw is None:
                return None
            return round(bw / (1024 * 1024), 2)
        except (json.JSONDecodeError, TypeError, KeyError):
            return None

    def _benchmark_write_target(self, disk: Dict[str, Any]) -> str:
        if disk.get("is_system_disk"):
            raise StorageManagerError("Write benchmark blocked on system disk.", code="protected_disk")
        for part in disk.get("partitions") or []:
            if not part.get("mountpoint"):
                return str(part.get("path"))
        raise StorageManagerError(
            "No unmounted partition for write test. Unmount a data partition first.",
            code="invalid_target",
        )

    def _run_disk_benchmark(self, disk_name: str, profile: str = "standard") -> Dict[str, Any]:
        disks = self.list_disks(include_smart=False)
        disk = next((d for d in disks if d.get("name") == disk_name), None)
        if not disk:
            raise StorageManagerError(f"Disk not found: {disk_name}", code="disk_not_found")

        if IS_WINDOWS:
            return {
                "disk": disk_name,
                "profile": profile,
                "results": {
                    "seq_read_mibs": 520.0,
                    "seq_write_mibs": 480.0,
                    "rand4k_read_mibs": 42.5,
                    "rand4k_write_mibs": 95.0,
                },
                "note": "Mock benchmark on Windows dev host.",
            }

        self._require_linux_mutations()
        read_path = f"/dev/{disk_name}"
        seq_mb = 256 if profile == "quick" else 512
        rand_mb = 64 if profile == "quick" else 128
        rand_runtime = 4 if profile == "quick" else 8

        results: Dict[str, Any] = {}
        logs: List[str] = []

        try:
            results["seq_read_mibs"] = self._dd_transfer_rate_mibs(
                ["dd", f"if={read_path}", "of=/dev/null", "bs=1M", f"count={seq_mb}", "iflag=direct", "status=none"],
                seq_mb,
            )
            logs.append(f"Sequential read: {results['seq_read_mibs']} MiB/s")
        except StorageManagerError:
            results["seq_read_mibs"] = self._dd_transfer_rate_mibs(
                ["dd", f"if={read_path}", "of=/dev/null", "bs=1M", f"count={seq_mb}", "status=none"],
                seq_mb,
            )
            logs.append(f"Sequential read (cached): {results['seq_read_mibs']} MiB/s")

        write_path = None
        try:
            write_path = self._benchmark_write_target(disk)
            write_mb = 64 if profile == "quick" else 128
            results["seq_write_mibs"] = self._dd_transfer_rate_mibs(
                ["dd", "if=/dev/zero", f"of={write_path}", "bs=1M", f"count={write_mb}",
                 "oflag=direct", "status=none", "conv=fdatasync"],
                write_mb,
            )
            logs.append(f"Sequential write on {write_path}: {results['seq_write_mibs']} MiB/s")
        except StorageManagerError as exc:
            results["seq_write_mibs"] = None
            results["seq_write_skipped"] = str(exc)

        rand_read = self._fio_rate_mibs(read_path, "randread", "4k", rand_mb, rand_runtime)
        rand_write = self._fio_rate_mibs(write_path or read_path, "randwrite", "4k", rand_mb, rand_runtime) if write_path else None
        if rand_read is not None:
            results["rand4k_read_mibs"] = rand_read
            logs.append(f"Random 4K read: {rand_read} MiB/s")
        else:
            results["rand4k_read_mibs"] = self._dd_transfer_rate_mibs(
                ["dd", f"if={read_path}", "of=/dev/null", "bs=4K", f"count={rand_mb * 256}", "iflag=direct", "status=none"],
                max(1, rand_mb // 4),
            )
            logs.append(f"Random 4K read (dd approx): {results['rand4k_read_mibs']} MiB/s")
        if rand_write is not None:
            results["rand4k_write_mibs"] = rand_write
            logs.append(f"Random 4K write: {rand_write} MiB/s")
        elif write_path:
            results["rand4k_write_mibs"] = None
            results["rand4k_write_skipped"] = "fio not installed or write test failed"
        else:
            results["rand4k_write_mibs"] = None

        return {
            "disk": disk_name,
            "profile": profile,
            "results": results,
            "logs": logs,
            "tools": {"fio": bool(shutil.which("fio"))},
        }

    def start_disk_benchmark(self, disk_name: str, profile: str = "standard") -> Dict[str, Any]:
        self._disk_record(disk_name)
        if BENCHMARK_TASKS.get(disk_name, {}).get("status") == "running":
            return {"message": "Benchmark already running", "disk": disk_name}

        BENCHMARK_TASKS[disk_name] = {
            "status": "running",
            "progress": 5,
            "results": None,
            "error": "",
            "logs": ["Starting disk benchmark..."],
        }

        def _worker():
            try:
                BENCHMARK_TASKS[disk_name]["progress"] = 20
                payload = self._run_disk_benchmark(disk_name, profile)
                BENCHMARK_TASKS[disk_name]["status"] = "success"
                BENCHMARK_TASKS[disk_name]["progress"] = 100
                BENCHMARK_TASKS[disk_name]["results"] = payload.get("results")
                BENCHMARK_TASKS[disk_name]["logs"] = payload.get("logs") or []
                BENCHMARK_TASKS[disk_name]["tools"] = payload.get("tools")
                BENCHMARK_TASKS[disk_name]["profile"] = profile
            except Exception as exc:
                BENCHMARK_TASKS[disk_name]["status"] = "failed"
                BENCHMARK_TASKS[disk_name]["progress"] = 100
                BENCHMARK_TASKS[disk_name]["error"] = str(exc)

        threading.Thread(target=_worker, daemon=True).start()
        return {"message": f"Benchmark started for {disk_name}", "disk": disk_name}

    def get_disk_benchmark_status(self, disk_name: str) -> Dict[str, Any]:
        return BENCHMARK_TASKS.get(disk_name, {"status": "not_started", "progress": 0, "results": None, "logs": [], "error": ""})

    def list_volumes(self) -> List[Dict[str, Any]]:
        if IS_WINDOWS:
            return [dict(v) for v in MOCK_VOLUMES]

        disk_data = SystemMonitor.get_disk_usage()
        if "error" in disk_data:
            raise StorageManagerError(disk_data["error"], code="volume_read_failed")

        volumes: List[Dict[str, Any]] = []
        for part in disk_data.get("partitions") or []:
            fst = (part.get("fstype") or "").lower()
            if fst in _SKIP_FSTYPES:
                continue
            mp = part.get("mountpoint") or ""
            if mp.startswith("/proc") or mp.startswith("/sys") or mp.startswith("/dev"):
                continue
            volumes.append({
                "device": part.get("device"),
                "mountpoint": mp,
                "fstype": self._normalize_fstype(part.get("fstype")) or part.get("fstype"),
                "fstype_label": _FSTYPE_LABELS.get(
                    self._normalize_fstype(part.get("fstype")) or "",
                    (part.get("fstype") or "").upper(),
                ),
                "total": int(part.get("total") or 0),
                "used": int(part.get("used") or 0),
                "free": int(part.get("free") or 0),
                "percent": float(part.get("percent") or 0),
            })

        volumes.sort(key=lambda v: (0 if v.get("mountpoint") == "/" else 1, v.get("mountpoint") or ""))
        return volumes

    def _health_from_disks_and_volumes(
        self,
        disks: List[Dict[str, Any]],
        volumes: List[Dict[str, Any]],
    ) -> Tuple[str, str, List[str]]:
        issues: List[str] = []
        level = "healthy"

        for vol in volumes:
            pct = float(vol.get("percent") or 0)
            mp = vol.get("mountpoint") or "?"
            if pct >= 95:
                issues.append(f"Volume {mp} is critically full ({pct:.0f}%).")
                level = "critical"
            elif pct >= 85 and level != "critical":
                issues.append(f"Volume {mp} is nearly full ({pct:.0f}%).")
                level = "warning"

        for disk in disks:
            smart = disk.get("smart") or {}
            status = smart.get("status")
            label = disk.get("name") or disk.get("path") or "disk"
            if status == "critical" or smart.get("passed") is False:
                issues.append(f"Disk {label} SMART health check failed.")
                level = "critical"
            elif status == "unknown" and smart.get("available") is False and level == "healthy":
                issues.append(f"Disk {label}: SMART monitoring unavailable.")
                level = "warning"

        if level == "healthy":
            message = "System storage is healthy."
        elif level == "warning":
            message = "Storage needs attention."
        else:
            message = "Storage health is critical."

        return level, message, issues

    def get_overview(self) -> Dict[str, Any]:
        disks = self.list_disks(include_smart=False)
        volumes = self.list_volumes()
        health, message, issues = self._health_from_disks_and_volumes(disks, volumes)

        total_bytes = sum(int(d.get("size_bytes") or 0) for d in disks)
        used_bytes = sum(int(v.get("used") or 0) for v in volumes)
        free_bytes = sum(int(v.get("free") or 0) for v in volumes)

        smart_available = sum(1 for d in disks if (d.get("smart") or {}).get("available"))
        smart_passed = sum(1 for d in disks if (d.get("smart") or {}).get("passed") is True)

        return {
            "health": health,
            "message": message,
            "issues": issues,
            "disk_count": len(disks),
            "volume_count": len(volumes),
            "total_disk_bytes": total_bytes,
            "mounted_used_bytes": used_bytes,
            "mounted_free_bytes": free_bytes,
            "smart_monitored": smart_available,
            "smart_passed": smart_passed,
            "tools": {
                "lsblk": bool(IS_WINDOWS or self._lsblk_bin_optional()),
                "smartctl": bool(IS_WINDOWS or self._smartctl_bin()),
                "parted": bool(IS_WINDOWS or shutil.which("parted")),
                "blkid": bool(IS_WINDOWS or shutil.which("blkid")),
                "lvm": bool(IS_WINDOWS or shutil.which("vgcreate")),
                "mdadm": bool(IS_WINDOWS or shutil.which("mdadm")),
            },
        }

    # --- Phase 2: partition / format / mount (superadmin) ---

    def _require_linux_mutations(self) -> None:
        if IS_WINDOWS:
            raise StorageManagerError(
                "Storage mutations are simulated only on Windows dev hosts.",
                code="platform_unsupported",
            )

    def _copanel_root(self) -> Optional[str]:
        for cand in (os.environ.get("COPANEL_ROOT"), "/opt/copanel"):
            if cand and os.path.isdir(cand):
                return os.path.realpath(cand)
        try:
            backend = Path(__file__).resolve().parents[2]
            root = backend.parent
            if root.is_dir():
                return os.path.realpath(str(root))
        except (IndexError, OSError):
            pass
        return None

    def _is_protected_mountpoint(self, mountpoint: str) -> bool:
        if not mountpoint:
            return False
        try:
            mp = os.path.realpath(mountpoint)
        except OSError:
            mp = mountpoint
        protected = set(_PROTECTED_MOUNTS)
        panel_root = self._copanel_root()
        if panel_root:
            protected.add(panel_root)
        for path in protected:
            if mp == path or mp.startswith(path.rstrip("/") + "/"):
                return True
        return False

    def _get_flat_block(self) -> List[Dict[str, Any]]:
        return self._flatten_lsblk(self._lsblk_rows())

    def _find_block(self, block_name: str) -> Optional[Dict[str, Any]]:
        for row in self._get_flat_block():
            if row.get("name") == block_name:
                return row
        return None

    def _normalize_device(self, device: str) -> Tuple[str, str]:
        device = (device or "").strip()
        match = _DEVICE_RE.match(device)
        if not match:
            raise StorageManagerError("Invalid device path.", code="invalid_device")
        name = match.group("name")
        if self._should_skip_disk_name(name):
            raise StorageManagerError("Device type is not manageable.", code="invalid_device")
        if self._find_block(name) is None and not IS_WINDOWS:
            raise StorageManagerError("Device not found on this system.", code="device_not_found")
        return device, name

    def _parent_disk_name(self, block_name: str) -> Optional[str]:
        row = self._find_block(block_name)
        if not row:
            return None
        if row.get("type") == "disk":
            return block_name
        return row.get("pkname") or row.get("_parent_name")

    def _disk_record(self, disk_name: str) -> Dict[str, Any]:
        disks = self.list_disks()
        match = next((d for d in disks if d.get("name") == disk_name), None)
        if not match:
            raise StorageManagerError(f"Disk not found: {disk_name}", code="disk_not_found")
        return match

    def _assert_partition_target(self, block_name: str, *, allow_system_disk: bool = False) -> Dict[str, Any]:
        row = self._find_block(block_name)
        if not row:
            raise StorageManagerError("Device not found.", code="device_not_found")
        if row.get("type") == "disk":
            raise StorageManagerError("Select a partition, not a whole disk.", code="invalid_target")
        parent = self._parent_disk_name(block_name)
        disk = self._disk_record(parent) if parent else None
        if disk and disk.get("is_system_disk") and not allow_system_disk:
            raise StorageManagerError("Operation blocked on the system disk.", code="protected_disk")
        if row.get("mountpoint"):
            raise StorageManagerError("Device is mounted. Unmount it first.", code="device_mounted")
        return row

    def _run_ok(self, args: List[str], error_message: str, code: str = "command_failed", timeout: Optional[int] = None) -> str:
        result = self._run(args, timeout=timeout)
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            raise StorageManagerError(f"{error_message}: {detail}", code=code)
        return (result.stdout or "").strip()

    def _device_uuid(self, device: str) -> str:
        if IS_WINDOWS:
            return "00000000-0000-0000-0000-000000000001"
        if not shutil.which("blkid"):
            raise StorageManagerError("blkid not found. Install util-linux.", code="blkid_missing")
        uuid = self._run_ok(["blkid", "-o", "value", "-s", "UUID", device], "Failed to read UUID", code="blkid_failed")
        if not uuid:
            raise StorageManagerError("Device has no UUID. Format it first.", code="blkid_failed")
        return uuid

    def read_fstab(self) -> List[Dict[str, str]]:
        if IS_WINDOWS:
            return []
        if not _FSTAB_PATH.is_file():
            return []
        entries: List[Dict[str, str]] = []
        for line in _FSTAB_PATH.read_text(encoding="utf-8", errors="ignore").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            parts = stripped.split()
            if len(parts) < 3:
                continue
            entries.append({
                "spec": parts[0],
                "mountpoint": parts[1],
                "fstype": parts[2],
                "options": parts[3] if len(parts) > 3 else "defaults",
                "raw": stripped,
            })
        return entries

    def _backup_fstab(self) -> None:
        if _FSTAB_PATH.is_file():
            shutil.copy2(_FSTAB_PATH, str(_FSTAB_PATH) + ".copanel.bak")

    def _fstab_add(self, uuid: str, mountpoint: str, fstype: str, options: str) -> None:
        self._backup_fstab()
        entries = self.read_fstab()
        if any(e.get("mountpoint") == mountpoint for e in entries):
            raise StorageManagerError(f"Mount point already in fstab: {mountpoint}", code="fstab_conflict")
        line = f"UUID={uuid}\t{mountpoint}\t{fstype}\t{options}\t0\t2\n"
        with open(_FSTAB_PATH, "a", encoding="utf-8") as fh:
            fh.write(line)

    def _fstab_remove(self, mountpoint: str) -> bool:
        if not _FSTAB_PATH.is_file():
            return False
        self._backup_fstab()
        lines = _FSTAB_PATH.read_text(encoding="utf-8", errors="ignore").splitlines(keepends=True)
        kept: List[str] = []
        removed = False
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                parts = stripped.split()
                if len(parts) >= 2 and parts[1] == mountpoint:
                    removed = True
                    continue
            kept.append(line)
        if removed:
            _FSTAB_PATH.write_text("".join(kept), encoding="utf-8")
        return removed

    def get_disk_layout(self, disk_name: str) -> Dict[str, Any]:
        disk = self._disk_record(disk_name)
        if IS_WINDOWS:
            return {"disk": disk_name, "layout": "mock", "text": "Mock partition layout"}
        parted = shutil.which("parted")
        if not parted:
            raise StorageManagerError("parted not found. Install parted.", code="parted_missing")
        dev = f"/dev/{disk_name}"
        text = self._run_ok([parted, "-s", dev, "unit", "MiB", "print", "free"], "Failed to read partition layout")
        return {"disk": disk_name, "text": text, "is_system_disk": disk.get("is_system_disk", False)}

    def _parted_bin(self) -> str:
        parted = shutil.which("parted")
        if not parted:
            raise StorageManagerError("parted not found. Install parted.", code="parted_missing")
        return parted

    def _parted_json(self, disk_name: str) -> Dict[str, Any]:
        parted = self._parted_bin()
        dev = f"/dev/{disk_name}"
        result = self._run([parted, "-s", "-j", dev, "unit", "MiB", "print"], timeout=60)
        if result.returncode != 0 or not (result.stdout or "").strip():
            detail = (result.stderr or result.stdout or "").strip()
            raise StorageManagerError(detail or "Failed to read partition table", code="parted_failed")
        raw = (result.stdout or "").strip()
        if not raw.startswith("{"):
            brace = raw.find("{")
            if brace >= 0:
                raw = raw[brace:]
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise StorageManagerError("Invalid parted JSON output", code="parted_failed") from exc

    def _parted_free_from_print(self, disk_name: str) -> Optional[Tuple[str, str]]:
        if IS_WINDOWS:
            return None
        try:
            parted = self._parted_bin()
        except StorageManagerError:
            return None
        dev = f"/dev/{disk_name}"
        result = self._run([parted, "-s", dev, "unit", "MiB", "print", "free"], timeout=60)
        text = (result.stdout or "") + "\n" + (result.stderr or "")
        best: Optional[Tuple[str, str]] = None
        best_size = 0.0
        for line in text.splitlines():
            if "free space" not in line.lower():
                continue
            match = _PARTED_FREE_RE.match(line.strip())
            if not match:
                continue
            start_raw, end_raw, size_raw = match.group(1).strip(), match.group(2).strip(), match.group(3).strip()
            size_bytes = self._parse_size(size_raw.replace(" ", ""))
            size_mib = size_bytes / (1024 * 1024) if size_bytes else 0.0
            if size_mib < 2:
                continue
            if size_mib > best_size:
                best_size = size_mib
                best = (start_raw, end_raw)
        return best

    def _parted_partition_number(self, disk_name: str, part_name: str) -> int:
        payload = self._parted_json(disk_name)
        parts = payload.get("partitions") or []
        children = sorted(
            [
                row for row in self._get_flat_block()
                if row.get("type") in ("part", "primary", "extended", "logical")
                and (row.get("pkname") or row.get("_parent_name")) == disk_name
            ],
            key=lambda r: str(r.get("name") or ""),
        )
        for idx, child in enumerate(children):
            if child.get("name") == part_name:
                if idx < len(parts):
                    num = parts[idx].get("number")
                    if num is not None:
                        return int(num)
                break
        for part in parts:
            if str(part.get("node", "")).endswith(part_name):
                return int(part["number"])
        raise StorageManagerError("Could not resolve partition number in parted.", code="partition_not_found")

    def _volume_usage_for_device(self, device_path: str) -> Optional[Dict[str, Any]]:
        for vol in self.list_volumes():
            if vol.get("device") == device_path:
                return vol
        return None

    def _partitions_detail_from_lsblk(self, disk_name: str, disk: Dict[str, Any]) -> Dict[str, Any]:
        """Build wizard layout from lsblk when parted cannot read the table (blank disk, etc.)."""
        disk_size = int(disk.get("size_bytes") or 0)
        parts_raw = self._partition_rows_for_disk(disk_name)
        partitions: List[Dict[str, Any]] = []
        cursor = 1.0
        for idx, part in enumerate(parts_raw):
            name = part.get("name")
            path = part.get("path") or (f"/dev/{name}" if name else None)
            size_bytes = int(part.get("size_bytes") or 0)
            size_mib = size_bytes / (1024 * 1024) if size_bytes else 0
            start_mib = cursor
            end_mib = start_mib + size_mib if size_mib else start_mib
            cursor = end_mib
            fstype = self._normalize_fstype(part.get("fstype"))
            if path and not fstype:
                fstype = self._probe_fstype(path)
            usage = self._volume_usage_for_device(path) if path else None
            partitions.append({
                "number": idx + 1,
                "name": name,
                "path": path,
                "start_mib": start_mib,
                "end_mib": end_mib,
                "size_bytes": size_bytes or None,
                "fstype": fstype,
                "fstype_label": _FSTYPE_LABELS.get(fstype or "", (fstype or "unknown").upper()) if fstype else None,
                "mountpoint": part.get("mountpoint"),
                "flags": [],
                "is_boot": False,
                "label": None,
                "used_percent": usage.get("percent") if usage else None,
                "used_bytes": usage.get("used") if usage else None,
                "free_bytes": usage.get("free") if usage else None,
                "is_mounted": bool(part.get("mountpoint")),
            })

        unallocated: List[Dict[str, Any]] = []
        if disk_size > 0:
            disk_mib = disk_size / (1024 * 1024)
            if not partitions:
                unallocated.append({"start_mib": 1.0, "end_mib": disk_mib, "size_mib": max(0.0, disk_mib - 1.0)})
            elif cursor < disk_mib - 1:
                unallocated.append({"start_mib": cursor, "end_mib": disk_mib, "size_mib": disk_mib - cursor})

        table = None
        try:
            parted = self._parted_bin()
            pr = self._run([parted, "-s", f"/dev/{disk_name}", "print"], timeout=30)
            text = ((pr.stdout or "") + (pr.stderr or "")).lower()
            if "partition table: gpt" in text:
                table = "gpt"
            elif "partition table: msdos" in text:
                table = "msdos"
            elif "unrecognised" in text or "unrecognized" in text:
                table = None
        except StorageManagerError:
            pass

        return {
            "disk": disk_name,
            "is_system_disk": disk.get("is_system_disk", False),
            "size_bytes": disk_size,
            "model": disk.get("model"),
            "partition_table": table,
            "partitions": partitions,
            "unallocated": unallocated,
        }

    def get_disk_partitions_detail(self, disk_name: str) -> Dict[str, Any]:
        disk = self._disk_record(disk_name)
        if IS_WINDOWS:
            return {
                "disk": disk_name,
                "is_system_disk": disk.get("is_system_disk", False),
                "size_bytes": disk.get("size_bytes"),
                "model": disk.get("model"),
                "partition_table": "gpt",
                "partitions": [
                    {
                        "number": i + 1,
                        "name": p.get("name"),
                        "path": p.get("path"),
                        "size_bytes": p.get("size_bytes"),
                        "fstype": p.get("fstype"),
                        "mountpoint": p.get("mountpoint"),
                        "flags": [],
                        "is_boot": i == 0,
                        "label": None,
                        "used_percent": 60 if p.get("mountpoint") else None,
                    }
                    for i, p in enumerate(disk.get("partitions") or [])
                ],
                "unallocated": [],
            }

        try:
            payload = self._parted_json(disk_name)
        except StorageManagerError as exc:
            if exc.code in ("parted_failed", "parted_missing"):
                return self._partitions_detail_from_lsblk(disk_name, disk)
            raise

        disk_info = payload.get("disk") or {}
        parted_parts = payload.get("partitions") or []
        lsblk_parts = self._partition_rows_for_disk(disk_name)

        if not parted_parts and lsblk_parts:
            return self._partitions_detail_from_lsblk(disk_name, disk)

        partitions: List[Dict[str, Any]] = []
        for idx, pt in enumerate(parted_parts):
            number = int(pt.get("number") or idx + 1)
            child = lsblk_parts[idx] if idx < len(lsblk_parts) else {}
            node = str(pt.get("node") or "")
            name = child.get("name") or (node.rsplit("/", 1)[-1] if node else None)
            path = child.get("path") or (f"/dev/{name}" if name else None)
            fstype = self._normalize_fstype(child.get("fstype")) or (pt.get("filesystem") or None)
            if path and not fstype:
                fstype = self._probe_fstype(path)
            flags = pt.get("flags") or []
            if isinstance(flags, str):
                flags = [flags]
            mountpoint = child.get("mountpoint")
            usage = self._volume_usage_for_device(path) if path else None
            label = None
            if path and shutil.which("blkid"):
                lr = self._run(["blkid", "-o", "value", "-s", "LABEL", path], timeout=10)
                if lr.returncode == 0 and (lr.stdout or "").strip():
                    label = lr.stdout.strip()

            partitions.append({
                "number": number,
                "name": name,
                "path": path,
                "start_mib": pt.get("start"),
                "end_mib": pt.get("end"),
                "size_bytes": self._parse_size(pt.get("size")) or self._parse_size(child.get("size")),
                "fstype": fstype,
                "fstype_label": _FSTYPE_LABELS.get(fstype or "", (fstype or "unknown").upper()),
                "mountpoint": mountpoint,
                "flags": flags,
                "is_boot": any(f in ("boot", "esp", "legacy_boot") for f in flags),
                "label": label,
                "used_percent": usage.get("percent") if usage else None,
                "used_bytes": usage.get("used") if usage else None,
                "free_bytes": usage.get("free") if usage else None,
                "is_mounted": bool(mountpoint),
            })

        disk_size = self._parse_size(disk_info.get("size")) or int(disk.get("size_bytes") or 0)
        unallocated: List[Dict[str, Any]] = []
        cursor = 1.0
        for part in partitions:
            start = float(part.get("start_mib") or cursor)
            if start > cursor + 1:
                unallocated.append({
                    "start_mib": cursor,
                    "end_mib": start,
                    "size_mib": start - cursor,
                })
            cursor = max(cursor, float(part.get("end_mib") or start))
        if disk_size > 0:
            disk_mib = disk_size / (1024 * 1024)
            if cursor < disk_mib - 1:
                unallocated.append({
                    "start_mib": cursor,
                    "end_mib": disk_mib,
                    "size_mib": disk_mib - cursor,
                })

        return self._merge_lsblk_partitions_if_empty(disk_name, disk, {
            "disk": disk_name,
            "is_system_disk": disk.get("is_system_disk", False),
            "size_bytes": disk_size,
            "model": disk.get("model"),
            "partition_table": disk_info.get("partitionTable") or disk_info.get("partition_table"),
            "partitions": partitions,
            "unallocated": unallocated,
        })

    def _merge_lsblk_partitions_if_empty(
        self,
        disk_name: str,
        disk: Dict[str, Any],
        layout: Dict[str, Any],
    ) -> Dict[str, Any]:
        if layout.get("partitions"):
            return layout
        lsblk_layout = self._partitions_detail_from_lsblk(disk_name, disk)
        if lsblk_layout.get("partitions"):
            return lsblk_layout
        return layout

    def delete_partition(self, device: str, confirm_token: str) -> Dict[str, Any]:
        device, name = self._normalize_device(device)
        if confirm_token != name:
            raise StorageManagerError("Confirmation must match partition name exactly.", code="confirm_mismatch")
        self._assert_partition_target(name)
        parent = self._parent_disk_name(name)
        if not parent:
            raise StorageManagerError("Parent disk not found.", code="device_not_found")

        if IS_WINDOWS:
            return {"message": f"Mock deleted partition {device}", "device": device}

        self._require_linux_mutations()
        parted = self._parted_bin()
        num = self._parted_partition_number(parent, name)
        dev = f"/dev/{parent}"
        self._run_ok([parted, "-s", dev, "rm", str(num)], f"Failed to delete partition {num}", code="parted_failed")
        self._partprobe(dev)
        return {"message": f"Deleted partition {device}", "device": device, "partition_number": num}

    def resize_partition(
        self,
        device: str,
        end: str,
        grow_filesystem: bool,
        confirm_token: str,
    ) -> Dict[str, Any]:
        device, name = self._normalize_device(device)
        if confirm_token != name:
            raise StorageManagerError("Confirmation must match partition name exactly.", code="confirm_mismatch")
        row = self._find_block(name)
        if not row:
            raise StorageManagerError("Device not found.", code="device_not_found")
        parent = self._parent_disk_name(name)
        if not parent:
            raise StorageManagerError("Parent disk not found.", code="device_not_found")
        disk = self._disk_record(parent)
        if disk.get("is_system_disk"):
            raise StorageManagerError("Operation blocked on the system disk.", code="protected_disk")

        if IS_WINDOWS:
            return {"message": f"Mock resized {device} to {end}", "device": device}

        self._require_linux_mutations()
        parted = self._parted_bin()
        num = self._parted_partition_number(parent, name)
        dev = f"/dev/{parent}"
        self._run_ok(
            [parted, "-s", dev, "unit", "MiB", "resizepart", str(num), end],
            "Failed to resize partition",
            code="parted_failed",
            timeout=120,
        )
        self._partprobe(dev)
        fs_grown = None
        if grow_filesystem and row.get("mountpoint"):
            fs_grown = self._grow_filesystem(device)
        return {
            "message": f"Resized partition {device} to end {end}",
            "device": device,
            "end": end,
            "filesystem_action": fs_grown,
        }

    def change_partition_label(self, device: str, label: str, confirm_token: str) -> Dict[str, Any]:
        device, name = self._normalize_device(device)
        if confirm_token != name:
            raise StorageManagerError("Confirmation must match partition name exactly.", code="confirm_mismatch")
        row = self._find_block(name)
        if not row:
            raise StorageManagerError("Device not found.", code="device_not_found")
        fstype = self._normalize_fstype(row.get("fstype")) or self._probe_fstype(device)
        if not fstype:
            raise StorageManagerError("Filesystem type required to change label.", code="invalid_fstype")

        if IS_WINDOWS:
            return {"message": f"Mock label set on {device}", "device": device, "label": label}

        self._require_linux_mutations()
        norm = fstype
        if norm == "ext4":
            self._run_ok(["e2label", device, label], "Failed to set ext4 label", code="label_failed")
        elif norm == "xfs":
            self._run_ok(["xfs_admin", "-L", label, device], "Failed to set xfs label", code="label_failed")
        elif norm == "vfat":
            self._run_ok(["fatlabel", device, label[:11]], "Failed to set vfat label", code="label_failed")
        elif norm == "exfat":
            tool = shutil.which("exfatlabel") or shutil.which("tune.exfat")
            if not tool:
                raise StorageManagerError("exfatlabel not installed.", code="label_failed")
            self._run_ok([tool, device, label[:15]], "Failed to set exfat label", code="label_failed")
        elif norm == "ntfs":
            self._run_ok(["ntfslabel", device, label[:32]], "Failed to set ntfs label", code="label_failed")
        elif norm == "btrfs":
            self._run_ok(["btrfs", "filesystem", "label", device, label], "Failed to set btrfs label", code="label_failed")
        else:
            raise StorageManagerError(f"Label change not supported for {fstype}", code="invalid_fstype")
        return {"message": f"Label set on {device}", "device": device, "label": label}

    def set_partition_boot(self, device: str, active: bool, confirm_token: str) -> Dict[str, Any]:
        device, name = self._normalize_device(device)
        if confirm_token != name:
            raise StorageManagerError("Confirmation must match partition name exactly.", code="confirm_mismatch")
        parent = self._parent_disk_name(name)
        if not parent:
            raise StorageManagerError("Parent disk not found.", code="device_not_found")
        disk = self._disk_record(parent)
        if disk.get("is_system_disk"):
            raise StorageManagerError("Cannot change boot flag on system disk.", code="protected_disk")

        if IS_WINDOWS:
            return {"message": f"Mock boot flag {'on' if active else 'off'} for {device}", "device": device}

        self._require_linux_mutations()
        parted = self._parted_bin()
        num = self._parted_partition_number(parent, name)
        dev = f"/dev/{parent}"
        payload = self._parted_json(parent)
        table = (payload.get("disk") or {}).get("partitionTable") or ""
        flag = "esp" if str(table).lower() == "gpt" else "boot"
        state = "on" if active else "off"
        self._run_ok(
            [parted, "-s", dev, "set", str(num), flag, state],
            "Failed to set boot flag",
            code="parted_failed",
        )
        return {"message": f"Boot flag {state} for {device}", "device": device, "flag": flag, "active": active}

    def _partprobe(self, disk_dev: str) -> None:
        partprobe = shutil.which("partprobe") or "/sbin/partprobe"
        if os.path.exists(partprobe) or shutil.which("partprobe"):
            self._run([partprobe, disk_dev], timeout=30)

    def _parted_free_region(self, disk_name: str) -> Optional[Tuple[str, str]]:
        """Return (start, end) for the first unallocated region large enough for a partition."""
        try:
            detail = self.get_disk_partitions_detail(disk_name)
            for gap in detail.get("unallocated") or []:
                size_mib = float(gap.get("size_mib") or 0)
                if size_mib < 2:
                    continue
                start_mib = int(float(gap.get("start_mib") or 1))
                end_mib = int(float(gap.get("end_mib") or start_mib + size_mib))
                return f"{start_mib}MiB", f"{end_mib}MiB"
        except StorageManagerError:
            pass
        return self._parted_free_from_print(disk_name)

    def create_partition(
        self,
        disk_name: str,
        start: str,
        end: str,
        confirm_token: str,
        initialize_gpt: bool = False,
    ) -> Dict[str, Any]:
        if confirm_token != disk_name:
            raise StorageManagerError("Confirmation must match disk name exactly.", code="confirm_mismatch")
        disk = self._disk_record(disk_name)
        if disk.get("is_system_disk"):
            raise StorageManagerError("Cannot partition the system disk.", code="protected_disk")
        if IS_WINDOWS:
            return {"message": f"Mock partition created on {disk_name}", "disk": disk_name}

        self._require_linux_mutations()
        parted = shutil.which("parted")
        if not parted:
            raise StorageManagerError("parted not found. Install parted.", code="parted_missing")

        dev = f"/dev/{disk_name}"
        print_out = self._run([parted, "-s", dev, "unit", "MiB", "print"], timeout=60)
        stdout = (print_out.stdout or "").strip()
        stderr = (print_out.stderr or "").strip()
        combined = f"{stdout}\n{stderr}".lower()
        existing_parts = self._partition_rows_for_disk(disk_name)
        has_table = bool(existing_parts) or (
            "partition table:" in combined
            and "unknown" not in combined
            and "unrecognised" not in combined
            and "unrecognized" not in combined
        )

        if not has_table and not existing_parts:
            if not initialize_gpt:
                raise StorageManagerError(
                    "Disk has no partition table. Check «Initialize GPT» for a blank disk.",
                    code="no_partition_table",
                )
            self._run_ok([parted, "-s", dev, "mklabel", "gpt"], "Failed to initialize GPT", code="parted_failed")

        use_start, use_end = start, end
        default_range = start in ("1MiB", "0MiB", "1049kB") and end in ("100%", "100")
        if default_range:
            free = self._parted_free_region(disk_name)
            if free:
                use_start, use_end = free
            elif existing_parts or has_table:
                raise StorageManagerError(
                    "No unallocated space on this disk. Specify start/end in free space.",
                    code="no_free_space",
                )

        self._run_ok(
            [parted, "-s", dev, "unit", "MiB", "mkpart", "primary", use_start, use_end],
            "Failed to create partition",
            code="parted_failed",
            timeout=120,
        )
        partprobe = shutil.which("partprobe") or "/sbin/partprobe"
        if os.path.exists(partprobe) or shutil.which("partprobe"):
            self._run([partprobe, dev], timeout=30)

        return {
            "message": f"Partition created on {disk_name}",
            "disk": disk_name,
            "start": use_start,
            "end": use_end,
        }

    def format_device(self, device: str, fstype: str, label: Optional[str], confirm_token: str) -> Dict[str, Any]:
        device, name = self._normalize_device(device)
        if confirm_token != name:
            raise StorageManagerError("Confirmation must match partition name exactly.", code="confirm_mismatch")
        norm = self._normalize_fstype(fstype) or fstype
        if norm not in _ALLOWED_FSTYPES:
            raise StorageManagerError(f"Unsupported filesystem: {fstype}", code="invalid_fstype")

        if IS_WINDOWS:
            return {"message": f"Mock format {device} as {fstype}", "device": device, "fstype": fstype}

        self._assert_partition_target(name)
        self._require_linux_mutations()
        norm = self._normalize_fstype(fstype) or fstype
        if norm == "ext4":
            cmd = ["mkfs.ext4", "-F"]
            if label:
                cmd.extend(["-L", label])
            cmd.append(device)
        elif norm == "xfs":
            cmd = ["mkfs.xfs", "-f"]
            if label:
                cmd.extend(["-L", label])
            cmd.append(device)
        elif norm == "btrfs":
            cmd = ["mkfs.btrfs", "-f"]
            if label:
                cmd.extend(["-L", label])
            cmd.append(device)
        elif norm == "vfat":
            cmd = ["mkfs.vfat", "-F", "32"]
            if label:
                cmd.extend(["-n", label[:11]])
            cmd.append(device)
        elif norm == "exfat":
            cmd = ["mkfs.exfat"]
            if label:
                cmd.extend(["-n", label[:15]])
            cmd.append(device)
        elif norm == "ntfs":
            cmd = ["mkfs.ntfs", "-F"]
            if label:
                cmd.extend(["-L", label[:32]])
            cmd.append(device)
        elif norm == "hfsplus":
            cmd = ["mkfs.hfsplus"]
            if label:
                cmd.extend(["-v", label[:27]])
            cmd.append(device)
        else:
            raise StorageManagerError(f"Unsupported filesystem: {fstype}", code="invalid_fstype")

        if not shutil.which(cmd[0]):
            raise StorageManagerError(f"{cmd[0]} not installed.", code="mkfs_missing")

        self._run_ok(cmd, f"Failed to format {device} as {norm}", code="format_failed", timeout=600)
        return {"message": f"Formatted {device} as {norm}", "device": device, "fstype": norm}

    def mount_device(
        self,
        device: str,
        mountpoint: str,
        fstype: Optional[str],
        options: str,
        persist_fstab: bool,
    ) -> Dict[str, Any]:
        device, name = self._normalize_device(device)
        mountpoint = os.path.abspath((mountpoint or "").strip())
        if not mountpoint.startswith("/"):
            raise StorageManagerError("Mount point must be an absolute path.", code="invalid_mountpoint")
        if self._is_protected_mountpoint(mountpoint):
            raise StorageManagerError("Mount point is protected.", code="protected_mount")

        row = self._find_block(name)
        if row and row.get("mountpoint"):
            raise StorageManagerError("Device is already mounted.", code="device_mounted")

        use_fstype = self._normalize_fstype(fstype or (row or {}).get("fstype")) or ""
        if not use_fstype:
            use_fstype = self._probe_fstype(device) or ""
        if not use_fstype:
            raise StorageManagerError("Filesystem type is required.", code="invalid_fstype")

        if IS_WINDOWS:
            return {"message": f"Mock mounted {device} at {mountpoint}", "device": device, "mountpoint": mountpoint}

        self._require_linux_mutations()
        os.makedirs(mountpoint, exist_ok=True)
        opts = (options or "").strip() or _DEFAULT_MOUNT_OPTIONS.get(use_fstype, "defaults")
        mount_cmd = self._mount_command(use_fstype, device, mountpoint, opts)
        self._run_ok(mount_cmd, "Mount failed", code="mount_failed")
        fstab_type = _MOUNT_FSTYPES.get(use_fstype, use_fstype)
        if persist_fstab:
            uuid = self._device_uuid(device)
            self._fstab_add(uuid, mountpoint, fstab_type, opts)

        return {
            "message": f"Mounted {device} at {mountpoint}",
            "device": device,
            "mountpoint": mountpoint,
            "persist_fstab": persist_fstab,
        }

    def _mount_command(self, fstype: str, device: str, mountpoint: str, options: str) -> List[str]:
        norm = self._normalize_fstype(fstype) or fstype
        if norm == "ntfs" and shutil.which("ntfs-3g"):
            return ["ntfs-3g", "-o", options, device, mountpoint]
        mount_type = _MOUNT_FSTYPES.get(norm, norm)
        return ["mount", "-t", mount_type, "-o", options, device, mountpoint]

    def _fsck_command(self, fstype: str, device: str, repair: bool) -> List[str]:
        norm = self._normalize_fstype(fstype) or fstype
        if norm in ("ext4", "ext3", "ext2"):
            tool = shutil.which(f"fsck.{norm}") or shutil.which("fsck")
            if not tool:
                raise StorageManagerError("e2fsprogs (fsck) not installed.", code="fsck_missing")
            return [tool, "-y" if repair else "-n", device]
        if norm == "xfs":
            if not shutil.which("xfs_repair"):
                raise StorageManagerError("xfsprogs (xfs_repair) not installed.", code="fsck_missing")
            return ["xfs_repair", device] if repair else ["xfs_repair", "-n", device]
        if norm == "btrfs":
            if not shutil.which("btrfs"):
                raise StorageManagerError("btrfs-progs not installed.", code="fsck_missing")
            if repair:
                return ["btrfs", "check", "--repair", device]
            return ["btrfs", "check", device]
        if norm == "vfat":
            tool = shutil.which("fsck.vfat") or shutil.which("dosfsck")
            if not tool:
                raise StorageManagerError("dosfstools (fsck.vfat) not installed.", code="fsck_missing")
            return [tool, "-a" if repair else "-n", device]
        if norm == "exfat":
            tool = shutil.which("fsck.exfat") or shutil.which("exfatfsck")
            if not tool:
                raise StorageManagerError("exfatprogs not installed.", code="fsck_missing")
            return [tool, "-y" if repair else "-n", device]
        if norm == "ntfs":
            tool = shutil.which("ntfsfix") or shutil.which("ntfsck")
            if not tool:
                raise StorageManagerError("ntfs-3g (ntfsfix) not installed.", code="fsck_missing")
            if tool.endswith("ntfsfix"):
                return [tool, device] if repair else [tool, "-n", device]
            return [tool, device]
        if norm == "hfsplus":
            tool = shutil.which("fsck.hfsplus")
            if not tool:
                raise StorageManagerError("hfsprogs not installed.", code="fsck_missing")
            return [tool, "-y" if repair else "-n", device]
        raise StorageManagerError(f"Filesystem check not supported for {fstype}", code="invalid_fstype")

    def check_filesystem(self, device: str, repair: bool, confirm_token: str) -> Dict[str, Any]:
        device, name = self._normalize_device(device)
        if confirm_token != name:
            raise StorageManagerError("Confirmation must match partition name exactly.", code="confirm_mismatch")

        row = self._find_block(name)
        if row and row.get("mountpoint"):
            raise StorageManagerError("Unmount the partition before running filesystem check.", code="device_mounted")

        fstype = self._normalize_fstype((row or {}).get("fstype")) or self._probe_fstype(device)
        if not fstype:
            raise StorageManagerError("Could not detect filesystem type.", code="invalid_fstype")
        if fstype not in _FSCK_FSTYPES:
            raise StorageManagerError(f"Check/repair not supported for {fstype}", code="invalid_fstype")

        if IS_WINDOWS:
            action = "repair" if repair else "check"
            msg = f"Mock fsck {action} on {device} ({fstype})"
            self._append_maintenance_event("fsck", device, msg)
            return {"message": msg, "device": device, "fstype": fstype, "repair": repair, "output": msg}

        self._require_linux_mutations()
        parent = self._parent_disk_name(name)
        if parent:
            disk = self._disk_record(parent)
            if disk.get("is_system_disk"):
                raise StorageManagerError("Filesystem check blocked on system disk partitions.", code="protected_disk")

        cmd = self._fsck_command(fstype, device, repair)
        result = self._run(cmd, timeout=3600)
        output = ((result.stdout or "") + (result.stderr or "")).strip()
        # fsck often exits 1 when errors were corrected
        if result.returncode not in (0, 1):
            raise StorageManagerError(output or "Filesystem check failed", code="fsck_failed")

        action = "repair" if repair else "check"
        msg = f"Filesystem {action} completed on {device} ({fstype})"
        self._append_maintenance_event("fsck", device, msg)
        return {
            "message": msg,
            "device": device,
            "fstype": fstype,
            "repair": repair,
            "exit_code": result.returncode,
            "output": output,
        }

    def unmount_device(self, mountpoint: str, remove_fstab: bool) -> Dict[str, Any]:
        mountpoint = os.path.abspath((mountpoint or "").strip())
        if not mountpoint.startswith("/"):
            raise StorageManagerError("Mount point must be an absolute path.", code="invalid_mountpoint")
        if self._is_protected_mountpoint(mountpoint):
            raise StorageManagerError("Cannot unmount a protected system mount.", code="protected_mount")

        if IS_WINDOWS:
            return {"message": f"Mock unmounted {mountpoint}", "mountpoint": mountpoint}

        self._require_linux_mutations()
        self._run_ok(["umount", mountpoint], "Unmount failed", code="umount_failed")
        removed = self._fstab_remove(mountpoint) if remove_fstab else False
        return {
            "message": f"Unmounted {mountpoint}",
            "mountpoint": mountpoint,
            "fstab_removed": removed,
        }

    # --- Phase 3: LVM pools and mdadm RAID ---

    def _parse_lvm_json_report(self, stdout: str, key: str) -> List[Dict[str, Any]]:
        if not stdout.strip():
            return []
        payload = json.loads(stdout)
        items: List[Dict[str, Any]] = []
        for report in payload.get("report") or []:
            chunk = report.get(key)
            if isinstance(chunk, list):
                items.extend(chunk)
        return items

    def _lvm_report(self, tool: str, fields: str, key: str) -> List[Dict[str, Any]]:
        if IS_WINDOWS or not shutil.which(tool):
            return []
        result = self._run([tool, "--units", "b", "--reportformat", "json", "-o", fields])
        if result.returncode != 0 or not (result.stdout or "").strip():
            return []
        try:
            return self._parse_lvm_json_report(result.stdout, key)
        except json.JSONDecodeError:
            return []

    def _list_vgs(self) -> List[Dict[str, Any]]:
        if IS_WINDOWS:
            return list(MOCK_POOLS["lvm"]["volume_groups"])
        rows = self._lvm_report("vgs", "vg_name,vg_size,vg_free,pv_count,lv_count", "vg")
        groups: List[Dict[str, Any]] = []
        for row in rows:
            groups.append({
                "vg_name": row.get("vg_name"),
                "vg_size_bytes": self._parse_size(row.get("vg_size")),
                "vg_free_bytes": self._parse_size(row.get("vg_free")),
                "pv_count": int(row.get("pv_count") or 0),
                "lv_count": int(row.get("lv_count") or 0),
            })
        return groups

    def _list_lvs(self) -> List[Dict[str, Any]]:
        if IS_WINDOWS:
            return list(MOCK_POOLS["lvm"]["logical_volumes"])
        rows = self._lvm_report("lvs", "lv_name,vg_name,lv_path,lv_size", "lv")
        flat = self._get_flat_block() if not IS_WINDOWS else []
        by_path = {f"/dev/{r.get('name')}": r for r in flat if r.get("name")}
        mapper_by_name = {r.get("name"): r for r in flat if r.get("name")}

        volumes: List[Dict[str, Any]] = []
        for row in rows:
            lv_path = row.get("lv_path") or ""
            mountpoint = None
            fstype = None
            for candidate in (lv_path, lv_path.replace("/dev/", "/dev/mapper/")):
                block = by_path.get(candidate)
                if not block:
                    base = os.path.basename(candidate)
                    block = mapper_by_name.get(base)
                if block:
                    mountpoint = block.get("mountpoint")
                    fstype = block.get("fstype")
                    break
            volumes.append({
                "lv_name": row.get("lv_name"),
                "vg_name": row.get("vg_name"),
                "lv_path": lv_path,
                "lv_size_bytes": self._parse_size(row.get("lv_size")),
                "mountpoint": mountpoint,
                "fstype": fstype,
            })
        return volumes

    def _list_pvs(self) -> List[Dict[str, Any]]:
        if IS_WINDOWS:
            return list(MOCK_POOLS["lvm"]["physical_volumes"])
        rows = self._lvm_report("pvs", "pv_name,vg_name,pv_size", "pv")
        return [
            {
                "pv_name": row.get("pv_name"),
                "vg_name": row.get("vg_name") or None,
                "pv_size_bytes": self._parse_size(row.get("pv_size")),
            }
            for row in rows
        ]

    def _parse_mdstat(self) -> List[Dict[str, Any]]:
        if IS_WINDOWS:
            return list(MOCK_POOLS["raid"]["arrays"])
        path = "/proc/mdstat"
        if not os.path.isfile(path):
            return []
        text = Path(path).read_text(encoding="utf-8", errors="ignore")
        arrays: List[Dict[str, Any]] = []
        lines = text.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if line.startswith("md") and " : " in line:
                head = line.split()
                name = head[0]
                state = head[2] if len(head) > 2 else "unknown"
                level = head[3] if len(head) > 3 else "unknown"
                devices: List[str] = []
                for token in head[4:]:
                    if token.endswith("]") and "[" in token:
                        dev_name = token.split("[", 1)[0]
                        if dev_name:
                            devices.append(f"/dev/{dev_name}")
                size_bytes = 0
                health = "unknown"
                if i + 1 < len(lines):
                    detail = lines[i + 1].strip()
                    m_size = re.search(r"(\d+)\s+blocks", detail)
                    if m_size:
                        size_bytes = int(m_size.group(1)) * 1024
                    if "[UU]" in detail or "[_" in detail:
                        health = "clean"
                    if "[_" in detail:
                        health = "degraded"
                arrays.append({
                    "name": name,
                    "path": f"/dev/{name}",
                    "level": level,
                    "state": state,
                    "size_bytes": size_bytes,
                    "devices": devices,
                    "health": health,
                })
            i += 1
        return arrays

    def list_pools(self) -> Dict[str, Any]:
        return {
            "lvm": {
                "available": bool(IS_WINDOWS or shutil.which("vgcreate")),
                "volume_groups": self._list_vgs(),
                "logical_volumes": self._list_lvs(),
                "physical_volumes": self._list_pvs(),
            },
            "raid": {
                "available": bool(IS_WINDOWS or shutil.which("mdadm")),
                "arrays": self._parse_mdstat(),
            },
        }

    def _device_used_in_lvm(self, device: str) -> bool:
        for pv in self._list_pvs():
            if pv.get("pv_name") == device:
                return True
        return False

    def _assert_raid_device(self, device: str) -> str:
        path, name = self._normalize_device(device)
        row = self._find_block(name)
        if not row:
            raise StorageManagerError(f"Device not found: {device}", code="device_not_found")
        if row.get("type") == "disk":
            disk = self._disk_record(name)
            if disk.get("is_system_disk"):
                raise StorageManagerError("Operation blocked on the system disk.", code="protected_disk")
            if any(p.get("mountpoint") for p in disk.get("partitions", [])):
                raise StorageManagerError("Disk has mounted partitions.", code="device_mounted")
        else:
            self._assert_partition_target(name)
        if self._device_used_in_lvm(path):
            raise StorageManagerError(f"Device already belongs to LVM: {path}", code="device_in_use")
        return path

    def _assert_vg_devices(self, devices: List[str]) -> List[str]:
        normalized: List[str] = []
        for device in devices:
            path, name = self._normalize_device(device.strip())
            row = self._find_block(name)
            if not row:
                raise StorageManagerError(f"Device not found: {device}", code="device_not_found")
            if row.get("type") == "disk":
                disk = self._disk_record(name)
                if disk.get("is_system_disk"):
                    raise StorageManagerError("Cannot use the system disk in a pool.", code="protected_disk")
                if any(p.get("mountpoint") for p in disk.get("partitions", [])):
                    raise StorageManagerError("Disk has mounted partitions.", code="device_mounted")
            else:
                self._assert_partition_target(name)
            if self._device_used_in_lvm(path):
                raise StorageManagerError(f"Device already belongs to LVM: {path}", code="device_in_use")
            normalized.append(path)
        return normalized

    def _next_md_device(self) -> str:
        used: set = set()
        if os.path.isfile("/proc/mdstat"):
            for line in Path("/proc/mdstat").read_text(encoding="utf-8", errors="ignore").splitlines():
                if line.startswith("md"):
                    used.add(line.split()[0])
        index = 0
        while f"md{index}" in used:
            index += 1
        return f"/dev/md{index}"

    def create_volume_group(self, vg_name: str, devices: List[str], confirm_token: str) -> Dict[str, Any]:
        if confirm_token != vg_name:
            raise StorageManagerError("Confirmation must match volume group name.", code="confirm_mismatch")
        device_paths = self._assert_vg_devices(devices)
        if IS_WINDOWS:
            return {"message": f"Mock VG {vg_name} created", "vg_name": vg_name, "devices": device_paths}

        self._require_linux_mutations()
        if not shutil.which("vgcreate"):
            raise StorageManagerError("LVM not installed. Install lvm2.", code="lvm_missing")
        self._run_ok(["vgcreate", vg_name, *device_paths], "Failed to create volume group", code="vgcreate_failed", timeout=120)
        return {"message": f"Volume group {vg_name} created", "vg_name": vg_name, "devices": device_paths}

    def create_logical_volume(self, vg_name: str, lv_name: str, size: str, confirm_token: str) -> Dict[str, Any]:
        expected = f"{vg_name}/{lv_name}"
        if confirm_token != expected:
            raise StorageManagerError("Confirmation must match VG/LV name.", code="confirm_mismatch")
        if IS_WINDOWS:
            return {"message": f"Mock LV {expected} created", "lv_path": f"/dev/{vg_name}/{lv_name}"}

        self._require_linux_mutations()
        if not shutil.which("lvcreate"):
            raise StorageManagerError("LVM not installed. Install lvm2.", code="lvm_missing")
        args = ["lvcreate", "-n", lv_name]
        if size.endswith("%FREE") or size == "100%FREE":
            args.extend(["-l", "100%FREE"])
        else:
            args.extend(["-L", size])
        args.append(vg_name)
        self._run_ok(args, "Failed to create logical volume", code="lvcreate_failed", timeout=120)
        return {
            "message": f"Logical volume {lv_name} created in {vg_name}",
            "lv_path": f"/dev/{vg_name}/{lv_name}",
            "size": size,
        }

    def _grow_filesystem(self, lv_path: str) -> Optional[str]:
        result = self._run(["blkid", "-o", "value", "-s", "TYPE", lv_path])
        fstype = (result.stdout or "").strip().lower()
        if not fstype:
            return None
        if fstype == "ext4":
            self._run_ok(["resize2fs", lv_path], "Failed to resize ext4 filesystem", code="resize_failed", timeout=300)
            return "ext4 resized"
        if fstype == "xfs":
            mountpoint = None
            for vol in self.list_volumes():
                dev = vol.get("device") or ""
                if dev == lv_path or lv_path.endswith(os.path.basename(dev)):
                    mountpoint = vol.get("mountpoint")
                    break
            if not mountpoint:
                for row in self._get_flat_block():
                    if row.get("mountpoint") and (row.get("name") or "") in lv_path:
                        mountpoint = row.get("mountpoint")
                        break
            if not mountpoint:
                raise StorageManagerError("XFS volume must be mounted to grow.", code="resize_failed")
            self._run_ok(["xfs_growfs", mountpoint], "Failed to grow XFS filesystem", code="resize_failed", timeout=300)
            return "xfs grown"
        return None

    def extend_logical_volume(
        self,
        vg_name: str,
        lv_name: str,
        size: str,
        grow_filesystem: bool,
        confirm_token: str,
    ) -> Dict[str, Any]:
        expected = f"{vg_name}/{lv_name}"
        if confirm_token != expected:
            raise StorageManagerError("Confirmation must match VG/LV name.", code="confirm_mismatch")
        lv_path = f"/dev/{vg_name}/{lv_name}"
        if IS_WINDOWS:
            return {"message": f"Mock extended {expected}", "lv_path": lv_path}

        self._require_linux_mutations()
        if not shutil.which("lvextend"):
            raise StorageManagerError("LVM not installed. Install lvm2.", code="lvm_missing")
        if size.endswith("%FREE") or size == "100%FREE":
            self._run_ok(["lvextend", "-l", "+100%FREE", lv_path], "Failed to extend LV", code="lvextend_failed", timeout=120)
        else:
            extend_size = size if size.startswith("+") else f"+{size}"
            self._run_ok(["lvextend", "-L", extend_size, lv_path], "Failed to extend LV", code="lvextend_failed", timeout=120)

        fs_action = None
        if grow_filesystem:
            fs_action = self._grow_filesystem(lv_path)
        return {
            "message": f"Extended {expected}",
            "lv_path": lv_path,
            "filesystem_action": fs_action,
        }

    def create_raid_array(
        self,
        level: int,
        devices: List[str],
        confirm_token: str,
        md_device: Optional[str] = None,
    ) -> Dict[str, Any]:
        if confirm_token != "CREATE-RAID":
            raise StorageManagerError('Confirmation must be exactly "CREATE-RAID".', code="confirm_mismatch")
        device_paths = [self._assert_raid_device(d) for d in devices]
        min_devices = {1: 2, 5: 3, 10: 4}.get(level, 2)
        if len(device_paths) < min_devices:
            raise StorageManagerError(f"RAID{level} requires at least {min_devices} devices.", code="invalid_target")

        target_md = md_device or self._next_md_device()
        if IS_WINDOWS:
            return {"message": f"Mock RAID{level} created", "md_device": target_md, "devices": device_paths}

        self._require_linux_mutations()
        mdadm = shutil.which("mdadm")
        if not mdadm:
            raise StorageManagerError("mdadm not installed.", code="mdadm_missing")
        cmd = [
            mdadm, "--create", target_md,
            "--level", str(level),
            "--raid-devices", str(len(device_paths)),
            *device_paths,
            "--run",
        ]
        self._run_ok(cmd, f"Failed to create RAID{level}", code="raid_create_failed", timeout=300)
        return {
            "message": f"RAID{level} array {target_md} created",
            "md_device": target_md,
            "level": level,
            "devices": device_paths,
        }

    # --- Phase 4: maintenance, scrub, SMART tests, alerts ---

    def _maintenance_state_path(self) -> Path:
        return Path(__file__).resolve().parent / "maintenance_state.json"

    def _load_maintenance_state(self) -> Dict[str, Any]:
        path = self._maintenance_state_path()
        if not path.is_file():
            return {"history": []}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data.setdefault("history", [])
                return data
        except (OSError, json.JSONDecodeError):
            pass
        return {"history": []}

    def _append_maintenance_event(self, action: str, target: str, result: str, ok: bool = True) -> None:
        state = self._load_maintenance_state()
        history = state.get("history") or []
        history.insert(0, {
            "action": action,
            "target": target,
            "result": result,
            "ok": ok,
            "at": int(time.time()),
        })
        state["history"] = history[:50]
        try:
            self._maintenance_state_path().write_text(json.dumps(state, indent=2), encoding="utf-8")
        except OSError:
            pass

    def get_maintenance_history(self) -> List[Dict[str, Any]]:
        return list(self._load_maintenance_state().get("history") or [])

    def get_storage_alerts(self) -> Dict[str, Any]:
        overview = self.get_overview()
        disks = self.list_disks()
        alerts: List[Dict[str, Any]] = []

        for issue in overview.get("issues") or []:
            level = "critical" if "critically" in issue.lower() or "failed" in issue.lower() else "warning"
            alerts.append({"level": level, "message": issue, "source": "volume"})

        for disk in disks:
            smart = disk.get("smart") or {}
            name = disk.get("name") or "disk"
            if smart.get("passed") is False:
                alerts.append({
                    "level": "critical",
                    "message": f"SMART health check failed on {name}",
                    "source": "smart",
                    "disk": name,
                })
            temp = smart.get("temperature_c")
            if isinstance(temp, (int, float)) and temp >= 55:
                alerts.append({
                    "level": "warning",
                    "message": f"Drive {name} temperature is {temp}°C",
                    "source": "smart",
                    "disk": name,
                })
            realloc = smart.get("reallocated_sectors")
            if isinstance(realloc, int) and realloc > 0:
                alerts.append({
                    "level": "warning",
                    "message": f"Drive {name} has {realloc} reallocated sectors",
                    "source": "smart",
                    "disk": name,
                })

        pools = self.list_pools()
        for raid in pools.get("raid", {}).get("arrays") or []:
            if raid.get("health") == "degraded":
                alerts.append({
                    "level": "critical",
                    "message": f"RAID array {raid.get('path')} is degraded",
                    "source": "raid",
                    "device": raid.get("path"),
                })

        health = overview.get("health") or "healthy"
        if alerts and health == "healthy":
            health = "critical" if any(a.get("level") == "critical" for a in alerts) else "warning"

        return {
            "health": health,
            "alert_count": len(alerts),
            "alerts": alerts[:12],
        }

    def list_maintenance_targets(self) -> Dict[str, Any]:
        disks = self.list_disks()
        volumes = self.list_volumes()
        pools = self.list_pools()
        fsck_partitions: List[Dict[str, Any]] = []
        for disk in disks:
            for part in disk.get("partitions") or []:
                fst = self._normalize_fstype(part.get("fstype"))
                if not fst or fst not in _FSCK_FSTYPES:
                    continue
                if part.get("mountpoint"):
                    continue
                fsck_partitions.append({
                    "path": part.get("path"),
                    "name": part.get("name"),
                    "fstype": fst,
                    "fstype_label": part.get("fstype_label") or _FSTYPE_LABELS.get(fst, fst),
                    "disk": disk.get("name"),
                    "is_system_disk": disk.get("is_system_disk", False),
                })
        return {
            "smart_disks": [
                {"name": d.get("name"), "model": d.get("model"), "is_system_disk": d.get("is_system_disk")}
                for d in disks
            ],
            "btrfs_volumes": [
                {"mountpoint": v.get("mountpoint"), "device": v.get("device")}
                for v in volumes
                if (v.get("fstype") or "").lower() == "btrfs"
            ],
            "raid_arrays": pools.get("raid", {}).get("arrays") or [],
            "fsck_partitions": fsck_partitions,
        }

    def run_smart_test(self, disk_name: str, test_type: str) -> Dict[str, Any]:
        disk = self._disk_record(disk_name)
        if IS_WINDOWS:
            msg = f"Mock SMART {test_type} test started on {disk_name}"
            self._append_maintenance_event("smart_test", disk_name, msg)
            return {"message": msg, "disk": disk_name, "test_type": test_type}

        self._require_linux_mutations()
        smartctl = self._smartctl_bin()
        if not smartctl:
            raise StorageManagerError("smartmontools not installed.", code="smartctl_missing")

        dev = f"/dev/{disk_name}"
        flag = "short" if test_type == "short" else "long"
        result = self._run([smartctl, "-t", flag, dev], timeout=30)
        output = (result.stdout or result.stderr or "").strip()
        if result.returncode not in (0, 1):
            raise StorageManagerError(output or "SMART test failed to start", code="smart_test_failed")

        msg = f"SMART {test_type} test started on {disk_name}"
        self._append_maintenance_event("smart_test", disk_name, msg)
        return {"message": msg, "disk": disk_name, "test_type": test_type, "output": output}

    def get_smart_test_status(self, disk_name: str) -> Dict[str, Any]:
        self._disk_record(disk_name)
        if IS_WINDOWS:
            return {"disk": disk_name, "status": "mock", "summary": "Mock SMART self-test idle"}

        smartctl = self._smartctl_bin()
        if not smartctl:
            raise StorageManagerError("smartmontools not installed.", code="smartctl_missing")
        dev = f"/dev/{disk_name}"
        result = self._run([smartctl, "-a", dev], timeout=30)
        text = (result.stdout or "") + (result.stderr or "")
        summary = "Unknown"
        for line in text.splitlines():
            lower = line.lower()
            if "self-test" in lower or "self test" in lower:
                summary = line.strip()
                break
        return {"disk": disk_name, "summary": summary, "raw_excerpt": "\n".join(text.splitlines()[-8:])}

    def start_btrfs_scrub(self, mountpoint: str) -> Dict[str, Any]:
        mountpoint = os.path.abspath((mountpoint or "").strip())
        volumes = self.list_volumes()
        match = next((v for v in volumes if v.get("mountpoint") == mountpoint), None)
        if not match:
            raise StorageManagerError("Mount point not found.", code="invalid_mountpoint")
        if (match.get("fstype") or "").lower() != "btrfs":
            raise StorageManagerError("Volume is not btrfs.", code="invalid_fstype")

        if IS_WINDOWS:
            msg = f"Mock btrfs scrub started on {mountpoint}"
            self._append_maintenance_event("btrfs_scrub", mountpoint, msg)
            return {"message": msg, "mountpoint": mountpoint}

        self._require_linux_mutations()
        if not shutil.which("btrfs"):
            raise StorageManagerError("btrfs-progs not installed.", code="btrfs_missing")
        self._run_ok(["btrfs", "scrub", "start", mountpoint], "Failed to start btrfs scrub", code="scrub_failed", timeout=60)
        status = self.get_btrfs_scrub_status(mountpoint)
        msg = f"Btrfs scrub started on {mountpoint}"
        self._append_maintenance_event("btrfs_scrub", mountpoint, msg)
        return {"message": msg, "mountpoint": mountpoint, "status": status}

    def get_btrfs_scrub_status(self, mountpoint: str) -> Dict[str, Any]:
        mountpoint = os.path.abspath((mountpoint or "").strip())
        if IS_WINDOWS:
            return {"mountpoint": mountpoint, "running": False, "summary": "mock idle"}
        if not shutil.which("btrfs"):
            return {"mountpoint": mountpoint, "running": False, "summary": "btrfs-progs not installed"}
        result = self._run(["btrfs", "scrub", "status", mountpoint], timeout=30)
        text = (result.stdout or result.stderr or "").strip()
        running = "running" in text.lower() or "in progress" in text.lower()
        return {"mountpoint": mountpoint, "running": running, "summary": text.splitlines()[0] if text else "idle", "raw": text}

    def start_mdadm_check(self, md_device: str) -> Dict[str, Any]:
        md_device = (md_device or "").strip()
        if not md_device.startswith("/dev/md"):
            raise StorageManagerError("Invalid RAID device.", code="invalid_device")
        name = md_device.replace("/dev/", "")
        pools = self.list_pools()
        known = {r.get("path") for r in pools.get("raid", {}).get("arrays") or []}
        if md_device not in known and not IS_WINDOWS:
            raise StorageManagerError("RAID array not found.", code="device_not_found")

        if IS_WINDOWS:
            msg = f"Mock RAID check started on {md_device}"
            self._append_maintenance_event("raid_check", md_device, msg)
            return {"message": msg, "md_device": md_device}

        self._require_linux_mutations()
        sync_action = Path(f"/sys/block/{name}/md/sync_action")
        if sync_action.is_file():
            try:
                sync_action.write_text("check", encoding="utf-8")
            except OSError as exc:
                raise StorageManagerError(f"Failed to start RAID check: {exc}", code="scrub_failed") from exc
        elif shutil.which("mdadm"):
            self._run_ok(["mdadm", "--action=check", md_device], "RAID check failed", code="scrub_failed", timeout=30)
        else:
            raise StorageManagerError("mdadm not available.", code="mdadm_missing")

        status = self.get_mdadm_check_status(md_device)
        msg = f"RAID check started on {md_device}"
        self._append_maintenance_event("raid_check", md_device, msg)
        return {"message": msg, "md_device": md_device, "status": status}

    def get_mdadm_check_status(self, md_device: str) -> Dict[str, Any]:
        md_device = (md_device or "").strip()
        name = md_device.replace("/dev/", "")
        if IS_WINDOWS:
            return {"md_device": md_device, "summary": "mock idle"}
        sync_action = Path(f"/sys/block/{name}/md/sync_action")
        sync_completed = Path(f"/sys/block/{name}/md/sync_completed")
        action = "idle"
        progress = None
        if sync_action.is_file():
            try:
                action = sync_action.read_text(encoding="utf-8").strip()
            except OSError:
                pass
        if sync_completed.is_file():
            try:
                parts = sync_completed.read_text(encoding="utf-8").strip().split()
                if len(parts) == 2 and parts[1] != "0":
                    progress = round(int(parts[0]) / int(parts[1]) * 100, 1)
            except (OSError, ValueError, ZeroDivisionError):
                pass
        return {
            "md_device": md_device,
            "action": action,
            "progress_percent": progress,
            "running": action == "check",
        }
