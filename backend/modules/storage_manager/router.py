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
    InitializeDiskRequest,
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
    FsckRequest,
    DiskBenchmarkRequest,
    DeletePartitionRequest,
    ResizePartitionRequest,
    PartitionLabelRequest,
    PartitionBootRequest,
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
    "no_free_space",
    "device_in_use",
    "smart_test_failed",
    "scrub_failed",
    "fsck_failed",
    "partition_not_found",
})


def _http_error(exc: StorageManagerError) -> HTTPException:
    code = exc.code
    if code == "disk_not_found" or code == "device_not_found":
        status = 404
    elif code in {"lsblk_missing", "lsblk_failed", "smartctl_missing", "parted_missing", "parted_failed", "blkid_missing", "mkfs_missing", "lvm_missing", "mdadm_missing", "btrfs_missing", "volume_read_failed", "fsck_missing", "label_failed"}:
        status = 503
    elif code in _BAD_REQUEST_CODES:
        status = 400
    else:
        status = 500
    return HTTPException(status_code=status, detail=str(exc))


@router.get("/version")
async def get_module_version(
    _user: Dict[str, Any] = Depends(require_module("storage_manager")),
) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": _service.get_module_version()}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


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


@router.post("/disks/{disk_name}/benchmark")
async def start_disk_benchmark(
    disk_name: str,
    body: DiskBenchmarkRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.start_disk_benchmark(disk_name, body.profile)
        record_audit(
            "storage.disk_benchmark",
            module="storage_manager",
            target=disk_name,
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"profile": body.profile},
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/disks/{disk_name}/benchmark")
async def get_disk_benchmark_status(
    disk_name: str,
    _user: Dict[str, Any] = Depends(require_module("storage_manager")),
) -> Dict[str, Any]:
    try:
        return {"status": "success", "data": _service.get_disk_benchmark_status(disk_name)}
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


@router.get("/disks/{disk_name}/partitions")
async def get_disk_partitions_detail(
    disk_name: str,
    _user: Dict[str, Any] = Depends(require_module("storage_manager")),
) -> Dict[str, Any]:
    try:
        data = _service.get_disk_partitions_detail(disk_name)
        return {"status": "success", "data": data}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/partitions/delete")
async def delete_partition(
    body: DeletePartitionRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.delete_partition(body.device, body.confirm_token, body.partition_number)
        record_audit(
            "storage.partition_delete",
            module="storage_manager",
            target=body.device,
            actor=user.get("username"),
            actor_id=user.get("id"),
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/partitions/resize")
async def resize_partition(
    body: ResizePartitionRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.resize_partition(
            body.device,
            body.end,
            body.grow_filesystem,
            body.confirm_token,
        )
        record_audit(
            "storage.partition_resize",
            module="storage_manager",
            target=body.device,
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"end": body.end, "grow_filesystem": body.grow_filesystem},
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/partitions/label")
async def change_partition_label(
    body: PartitionLabelRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.change_partition_label(body.device, body.label, body.confirm_token)
        record_audit(
            "storage.partition_label",
            module="storage_manager",
            target=body.device,
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"label": body.label},
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/partitions/boot")
async def set_partition_boot(
    body: PartitionBootRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.set_partition_boot(body.device, body.active, body.confirm_token)
        record_audit(
            "storage.partition_boot",
            module="storage_manager",
            target=body.device,
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"active": body.active},
        )
        return {"status": "success", "data": result}
    except StorageManagerError as exc:
        raise _http_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/disks/{disk_name}/initialize")
async def initialize_disk(
    disk_name: str,
    body: InitializeDiskRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    if body.disk_name != disk_name:
        raise HTTPException(status_code=400, detail="disk_name in URL and body must match.")
    try:
        result = _service.initialize_disk(disk_name, body.table_type, body.confirm_token)
        record_audit(
            "storage.disk_initialize",
            module="storage_manager",
            target=disk_name,
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"table_type": body.table_type},
        )
        return {"status": "success", "data": result}
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


@router.post("/maintenance/fsck")
async def run_filesystem_check(
    body: FsckRequest,
    user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    try:
        result = _service.check_filesystem(body.device, body.repair, body.confirm_token)
        record_audit(
            "storage.fsck",
            module="storage_manager",
            target=body.device,
            actor=user.get("username"),
            actor_id=user.get("id"),
            meta={"repair": body.repair},
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
