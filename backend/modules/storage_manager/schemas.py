"""Request schemas for storage mutations."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class CreatePartitionRequest(BaseModel):
    disk_name: str = Field(..., min_length=1, max_length=32)
    start: str = Field("1MiB", description="parted start, e.g. 1MiB or 50%")
    end: str = Field("100%", description="parted end, e.g. 100% or 100%")
    initialize_gpt: bool = Field(False, description="Legacy: create GPT on empty disks (prefer /disks/{name}/initialize)")
    confirm_token: str = Field(..., min_length=1, max_length=32)


class InitializeDiskRequest(BaseModel):
    disk_name: str = Field(..., min_length=1, max_length=32)
    table_type: Literal["gpt", "msdos", "mbr"] = Field("gpt", description="Partition table: gpt (UEFI) or msdos/mbr (legacy BIOS)")
    confirm_token: str = Field(..., min_length=1, max_length=32)


class FormatRequest(BaseModel):
    device: str = Field(..., description="e.g. /dev/sdb1")
    fstype: Literal["ext4", "xfs", "btrfs", "vfat", "exfat", "ntfs", "hfsplus"] = "ext4"
    label: Optional[str] = Field(None, max_length=32)
    confirm_token: str = Field(..., min_length=1, max_length=32)


class MountRequest(BaseModel):
    device: str
    mountpoint: str
    fstype: Optional[str] = None
    options: str = "defaults"
    persist_fstab: bool = True


class UnmountRequest(BaseModel):
    mountpoint: str
    remove_fstab: bool = False


class CreateVgRequest(BaseModel):
    vg_name: str = Field(..., min_length=1, max_length=32, pattern=r"^[a-zA-Z0-9_-]+$")
    devices: list[str] = Field(..., min_length=1)
    confirm_token: str = Field(..., min_length=1, max_length=32)


class CreateLvRequest(BaseModel):
    vg_name: str = Field(..., min_length=1, max_length=32)
    lv_name: str = Field(..., min_length=1, max_length=32, pattern=r"^[a-zA-Z0-9_-]+$")
    size: str = Field("100%FREE", description="e.g. 100G or 100%FREE")
    confirm_token: str = Field(..., min_length=1, max_length=64)


class ExtendLvRequest(BaseModel):
    vg_name: str = Field(..., min_length=1, max_length=32)
    lv_name: str = Field(..., min_length=1, max_length=32)
    size: str = Field("100%FREE", description="e.g. 50G or 100%FREE")
    grow_filesystem: bool = True
    confirm_token: str = Field(..., min_length=1, max_length=64)


class CreateRaidRequest(BaseModel):
    level: Literal[1, 5, 10] = 1
    devices: list[str] = Field(..., min_length=2)
    md_device: Optional[str] = None
    confirm_token: str = Field(..., min_length=1, max_length=32)


class SmartTestRequest(BaseModel):
    disk_name: str = Field(..., min_length=1, max_length=32)
    test_type: Literal["short", "long"] = "short"


class BtrfsScrubRequest(BaseModel):
    mountpoint: str


class RaidCheckRequest(BaseModel):
    md_device: str = Field(..., description="e.g. /dev/md0")


class FsckRequest(BaseModel):
    device: str = Field(..., description="e.g. /dev/sdb1")
    repair: bool = Field(False, description="Attempt automatic repair (fsck -y / xfs_repair)")
    confirm_token: str = Field(..., min_length=1, max_length=32)


class DiskBenchmarkRequest(BaseModel):
    profile: Literal["quick", "standard"] = "standard"


class DeletePartitionRequest(BaseModel):
    device: str = Field(..., description="e.g. /dev/sdb1")
    confirm_token: str = Field(..., min_length=1, max_length=64)
    partition_number: Optional[int] = Field(None, ge=1, le=128, description="From wizard layout; optional hint")


class ResizePartitionRequest(BaseModel):
    device: str
    end: str = Field(..., description="New end position, e.g. 100% or 500GiB")
    grow_filesystem: bool = Field(True, description="Grow filesystem after extending partition")
    confirm_token: str = Field(..., min_length=1, max_length=64)


class PartitionLabelRequest(BaseModel):
    device: str
    label: str = Field(..., min_length=1, max_length=32)
    confirm_token: str = Field(..., min_length=1, max_length=64)


class PartitionBootRequest(BaseModel):
    device: str
    active: bool = True
    confirm_token: str = Field(..., min_length=1, max_length=64)
    partition_number: Optional[int] = Field(None, ge=1, le=128)
