"""
Storage Manager Module Router — disks, volumes, SMART, and admin storage actions.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from core.audit import record_audit
from core.auth import require_admin, require_module

from .logic import StorageManagerError, StorageService
from .schemas import (
    BtrfsScrubRequest,
    CreateLvRequest,
    CreatePartitionRequest,
    CreateRaidRequest,
    CreateVgRequest,
    ExtendLvRequest,
    FormatRequest,
    MountRequest,
    RaidCheckRequest,
    SmartTestRequest,
    UnmountRequest,
)

router = APIRouter()
_service = StorageService()

_BAD_REQUEST_CODES = frozenset({
    "confirm_mismatch",
    "protected_disk",
    "protected_mount",
    "device_mounted",
    "invalid_device",
    "invalid_target",
    "invalid_mountpoint",
    "invalid_fstype",
    "fstab_conflict",
    "no_partition_table",
    "device_in_use",
    "smart_test_failed",
    "scrub_failed",
})


def _http_error(exc: StorageManagerError) -> HTTPException:
    code = exc.code
    if code == "disk_not_found" or code == "device_not_found":
        status = 404
    elif code in {"lsblk_missing", "lsblk_failed", "smartctl_missing", "parted_missing", "blkid_missing", "mkfs_missing", "lvm_missing", "mdadm_missing", "btrfs_missing", "volume_read_failed"}:
        status = 503
    elif code in _BAD_REQUEST_CODES:
        status = 400
    else:
        status = 500
    return HTTPException(status_code=status, detail=str(exc))


@router.get("/overview")
async def get_overview(_user: Dict[str, Any] = Depends(require_module("storage_manager"))) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": _service.get_overview()}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/disks")
async def list_disks(_user: Dict[str, Any] = Depends(require_module("storage_manager"))) -> Dict[str, Any]:
    try:
        disks = _service.list_disks()
        return {"status": "success", "data": disks}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/disks/{disk_name}/smart")
async def get_disk_smart(
    disk_name: str,
    _user: Dict[str, Any] = Depends(require_module("storage_manager")),
) -> Dict[str, Any]:
    try:
        data = _service.get_disk_smart(disk_name)
        return {"status": "success", "data": data}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/disks/{disk_name}/layout")
async def get_disk_layout(
    disk_name: str,
    _user: Dict[str, Any] = Depends(require_module("storage_manager")),
) -> Dict[str, Any]:
    try:
        data = _service.get_disk_layout(disk_name)
        return {"status": "success", "data": data}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/volumes")
async def list_volumes(_user: Dict[str, Any] = Depends(require_module("storage_manager"))) -> Dict[str, Any]:
    try:
        volumes = _service.list_volumes()
        return {"status": "success", "data": volumes}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/fstab")
async def read_fstab(_user: Dict[str, Any] = Depends(require_module("storage_manager"))) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": _service.read_fstab()}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/partitions/create")
async def create_partition(
    body: CreatePartitionRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.create_partition(
            body.disk_name,
            body.start,
            body.end,
            body.confirm_token,
            body.initialize_gpt,
        )
        record_audit(
            "storage.partition_create",
            module="storage_manager",
            target=body.disk_name,
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"start": body.start, "end": body.end, "initialize_gpt": body.initialize_gpt},
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/format")
async def format_device(
    body: FormatRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.format_device(body.device, body.fstype, body.label, body.confirm_token)
        record_audit(
            "storage.format",
            module="storage_manager",
            target=body.device,
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"fstype": body.fstype, "label": body.label},
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/mount")
async def mount_device(
    body: MountRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.mount_device(
            body.device,
            body.mountpoint,
            body.fstype,
            body.options,
            body.persist_fstab,
        )
        record_audit(
            "storage.mount",
            module="storage_manager",
            target=body.mountpoint,
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"device": body.device, "persist_fstab": body.persist_fstab},
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/pools")
async def list_pools(_user: Dict[str, Any] = Depends(require_module("storage_manager"))) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": _service.list_pools()}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/pools/lvm/vg/create")
async def create_volume_group(
    body: CreateVgRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.create_volume_group(body.vg_name, body.devices, body.confirm_token)
        record_audit(
            "storage.vg_create",
            module="storage_manager",
            target=body.vg_name,
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"devices": body.devices},
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/pools/lvm/lv/create")
async def create_logical_volume(
    body: CreateLvRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.create_logical_volume(body.vg_name, body.lv_name, body.size, body.confirm_token)
        record_audit(
            "storage.lv_create",
            module="storage_manager",
            target=f"{body.vg_name}/{body.lv_name}",
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"size": body.size},
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/pools/lvm/lv/extend")
async def extend_logical_volume(
    body: ExtendLvRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.extend_logical_volume(
            body.vg_name,
            body.lv_name,
            body.size,
            body.grow_filesystem,
            body.confirm_token,
        )
        record_audit(
            "storage.lv_extend",
            module="storage_manager",
            target=f"{body.vg_name}/{body.lv_name}",
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"size": body.size, "grow_filesystem": body.grow_filesystem},
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/pools/raid/create")
async def create_raid_array(
    body: CreateRaidRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.create_raid_array(body.level, body.devices, body.confirm_token, body.md_device)
        record_audit(
            "storage.raid_create",
            module="storage_manager",
            target=result.get("md_device"),
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"level": body.level, "devices": body.devices},
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/alerts")
async def get_storage_alerts(_user: Dict[str, Any] = Depends(require_module("storage_manager"))) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": _service.get_storage_alerts()}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/maintenance")
async def get_maintenance(_user: Dict[str, Any] = Depends(require_module("storage_manager"))) -> Dict[str, Any]:
    try:
        return {
            "status": "success",
            "data": {
                "targets": _service.list_maintenance_targets(),
                "history": _service.get_maintenance_history(),
            },
        }
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/maintenance/btrfs/{mountpoint:path}/status")
async def btrfs_scrub_status(
    mountpoint: str,
    _user: Dict[str, Any] = Depends(require_module("storage_manager")),
) -> Dict[str, Any]:
    try:
        mp = mountpoint if mountpoint.startswith("/") else f"/{mountpoint}"
        return {"status": "success", "data": _service.get_btrfs_scrub_status(mp)}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/maintenance/raid/status")
async def raid_check_status(
    md_device: str,
    _user: Dict[str, Any] = Depends(require_module("storage_manager")),
) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": _service.get_mdadm_check_status(md_device)}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/maintenance/smart/{disk_name}/status")
async def smart_test_status(
    disk_name: str,
    _user: Dict[str, Any] = Depends(require_module("storage_manager")),
) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": _service.get_smart_test_status(disk_name)}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/maintenance/smart-test")
async def run_smart_test(
    body: SmartTestRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.run_smart_test(body.disk_name, body.test_type)
        record_audit(
            "storage.smart_test",
            module="storage_manager",
            target=body.disk_name,
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"test_type": body.test_type},
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/maintenance/scrub/btrfs")
async def start_btrfs_scrub(
    body: BtrfsScrubRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.start_btrfs_scrub(body.mountpoint)
        record_audit(
            "storage.btrfs_scrub",
            module="storage_manager",
            target=body.mountpoint,
            actor=user.get("username"),
            actor_id=user.get("id"),
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/maintenance/scrub/raid")
async def start_raid_check(
    body: RaidCheckRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.start_mdadm_check(body.md_device)
        record_audit(
            "storage.raid_check",
            module="storage_manager",
            target=body.md_device,
            actor=user.get("username"),
            actor_id=user.get("id"),
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/unmount")
async def unmount_device(
    body: UnmountRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.unmount_device(body.mountpoint, body.remove_fstab)
        record_audit(
            "storage.unmount",
            module="storage_manager",
            target=body.mountpoint,
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"remove_fstab": body.remove_fstab},
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
