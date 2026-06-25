/**
 * Storage Manager — disk health, volumes, and admin storage actions.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';

type TabId = 'overview' | 'disks' | 'volumes' | 'pools' | 'maintenance' | 'manage';
type HealthLevel = 'healthy' | 'warning' | 'critical';

interface SmartInfo {
  available?: boolean;
  passed?: boolean | null;
  status?: string;
  temperature_c?: number | null;
  power_on_hours?: number | null;
  reallocated_sectors?: number | null;
  message?: string;
}

interface PartitionInfo {
  name: string;
  path: string;
  size_bytes: number;
  fstype?: string | null;
  mountpoint?: string | null;
}

interface DiskInfo {
  name: string;
  path: string;
  size_bytes: number;
  model: string;
  serial?: string | null;
  transport?: string | null;
  rotational?: boolean | null;
  removable: boolean;
  state: string;
  is_system_disk: boolean;
  partitions: PartitionInfo[];
  smart: SmartInfo;
}

interface VolumeInfo {
  device: string;
  mountpoint: string;
  fstype: string;
  total: number;
  used: number;
  free: number;
  percent: number;
}

interface OverviewData {
  health: HealthLevel;
  message: string;
  issues: string[];
  disk_count: number;
  volume_count: number;
  total_disk_bytes: number;
  mounted_used_bytes: number;
  mounted_free_bytes: number;
  smart_monitored: number;
  smart_passed: number;
  tools: { lsblk: boolean; smartctl: boolean; parted?: boolean; blkid?: boolean; lvm?: boolean; mdadm?: boolean };
}

interface VolumeGroupInfo {
  vg_name: string;
  vg_size_bytes: number;
  vg_free_bytes: number;
  pv_count: number;
  lv_count: number;
}

interface LogicalVolumeInfo {
  lv_name: string;
  vg_name: string;
  lv_path: string;
  lv_size_bytes: number;
  mountpoint?: string | null;
  fstype?: string | null;
}

interface PhysicalVolumeInfo {
  pv_name: string;
  vg_name?: string | null;
  pv_size_bytes: number;
}

interface RaidArrayInfo {
  name: string;
  path: string;
  level: string;
  state: string;
  size_bytes: number;
  devices: string[];
  health: string;
}

interface PoolsData {
  lvm: {
    available: boolean;
    volume_groups: VolumeGroupInfo[];
    logical_volumes: LogicalVolumeInfo[];
    physical_volumes: PhysicalVolumeInfo[];
  };
  raid: {
    available: boolean;
    arrays: RaidArrayInfo[];
  };
}

interface MaintenanceHistoryItem {
  action: string;
  target: string;
  result: string;
  ok: boolean;
  at: number;
}

interface MaintenanceTargets {
  smart_disks: Array<{ name: string; model: string; is_system_disk: boolean }>;
  btrfs_volumes: Array<{ mountpoint: string; device: string }>;
  raid_arrays: RaidArrayInfo[];
}

interface StorageAlert {
  level: string;
  message: string;
  source?: string;
  disk?: string;
  device?: string;
}

interface FstabEntry {
  spec: string;
  mountpoint: string;
  fstype: string;
  options: string;
  raw: string;
}

const PROTECTED_MOUNTS = ['/', '/boot', '/boot/efi', '/usr', '/var'];

function isProtectedMount(mountpoint: string): boolean {
  if (PROTECTED_MOUNTS.includes(mountpoint)) return true;
  if (mountpoint.startsWith('/opt/copanel')) return true;
  return false;
}

function formatBytes(bytes: number, language: 'en' | 'vi'): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = language === 'vi'
    ? ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    : ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 100 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

function healthStyles(level: HealthLevel, isDark: boolean) {
  if (level === 'critical') {
    return {
      ring: isDark ? 'border-red-500/40 bg-red-950/30' : 'border-red-200 bg-red-50',
      icon: isDark ? 'text-red-400' : 'text-red-600',
      text: isDark ? 'text-red-200' : 'text-red-800',
      badge: 'bg-red-500/15 border-red-500/30 text-red-500',
    };
  }
  if (level === 'warning') {
    return {
      ring: isDark ? 'border-amber-500/40 bg-amber-950/20' : 'border-amber-200 bg-amber-50',
      icon: isDark ? 'text-amber-400' : 'text-amber-600',
      text: isDark ? 'text-amber-100' : 'text-amber-900',
      badge: 'bg-amber-500/15 border-amber-500/30 text-amber-500',
    };
  }
  return {
    ring: isDark ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-emerald-200 bg-emerald-50',
    icon: isDark ? 'text-emerald-400' : 'text-emerald-600',
    text: isDark ? 'text-emerald-100' : 'text-emerald-900',
    badge: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500',
  };
}

function smartBadge(smart: SmartInfo | undefined, isDark: boolean): { label: string; cls: string } {
  const status = smart?.status || 'unknown';
  if (status === 'healthy' || smart?.passed === true) {
    return { label: 'Healthy', cls: isDark ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-emerald-700 bg-emerald-50 border-emerald-200' };
  }
  if (status === 'critical' || smart?.passed === false) {
    return { label: 'Critical', cls: isDark ? 'text-red-400 bg-red-500/10 border-red-500/20' : 'text-red-700 bg-red-50 border-red-200' };
  }
  return { label: 'Unknown', cls: isDark ? 'text-slate-400 bg-slate-800/60 border-slate-700' : 'text-slate-600 bg-slate-100 border-slate-200' };
}

export default function StorageManagerDashboard() {
  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';
  const token = localStorage.getItem('copanel_token');

  const [tab, setTab] = useState<TabId>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [expandedDisk, setExpandedDisk] = useState<string | null>(null);
  const [fstab, setFstab] = useState<FstabEntry[]>([]);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [partDisk, setPartDisk] = useState('');
  const [partStart, setPartStart] = useState('1MiB');
  const [partEnd, setPartEnd] = useState('100%');
  const [partInitGpt, setPartInitGpt] = useState(false);
  const [partConfirm, setPartConfirm] = useState('');

  const [formatDevice, setFormatDevice] = useState('');
  const [formatFs, setFormatFs] = useState<'ext4' | 'xfs' | 'btrfs'>('ext4');
  const [formatLabel, setFormatLabel] = useState('');
  const [formatConfirm, setFormatConfirm] = useState('');

  const [mountDevice, setMountDevice] = useState('');
  const [mountPoint, setMountPoint] = useState('/mnt/data');
  const [mountFs, setMountFs] = useState('ext4');
  const [mountOptions, setMountOptions] = useState('defaults');
  const [mountPersist, setMountPersist] = useState(true);

  const [unmountPoint, setUnmountPoint] = useState('');
  const [unmountRemoveFstab, setUnmountRemoveFstab] = useState(false);

  const [pools, setPools] = useState<PoolsData | null>(null);
  const [vgName, setVgName] = useState('data-vg');
  const [vgDevices, setVgDevices] = useState<string[]>([]);
  const [vgConfirm, setVgConfirm] = useState('');
  const [lvVg, setLvVg] = useState('');
  const [lvName, setLvName] = useState('data-lv');
  const [lvSize, setLvSize] = useState('100%FREE');
  const [lvConfirm, setLvConfirm] = useState('');
  const [extVg, setExtVg] = useState('');
  const [extLv, setExtLv] = useState('');
  const [extSize, setExtSize] = useState('100%FREE');
  const [extGrowFs, setExtGrowFs] = useState(true);
  const [extConfirm, setExtConfirm] = useState('');
  const [raidLevel, setRaidLevel] = useState<1 | 5 | 10>(1);
  const [raidDevices, setRaidDevices] = useState<string[]>([]);
  const [raidConfirm, setRaidConfirm] = useState('');

  const [maintenance, setMaintenance] = useState<{ targets: MaintenanceTargets; history: MaintenanceHistoryItem[] } | null>(null);
  const [alerts, setAlerts] = useState<StorageAlert[]>([]);
  const [smartDisk, setSmartDisk] = useState('');
  const [smartTestType, setSmartTestType] = useState<'short' | 'long'>('short');
  const [scrubMount, setScrubMount] = useState('');
  const [raidCheckDev, setRaidCheckDev] = useState('');

  const t = {
    en: {
      title: 'Storage Manager',
      desc: 'Monitor physical drives, mounted volumes, and SMART disk health on this server.',
      overview: 'Overview',
      disks: 'Disks',
      volumes: 'Volumes',
      healthy: 'Healthy',
      warning: 'Warning',
      critical: 'Critical',
      systemHealthy: 'System is healthy.',
      refresh: 'Refresh',
      loading: 'Loading storage data...',
      totalDisks: 'Physical disks',
      totalVolumes: 'Mounted volumes',
      totalCapacity: 'Raw disk capacity',
      smartMonitored: 'SMART monitored',
      volumeUsage: 'Volume usage',
      noVolumes: 'No mounted volumes detected.',
      noDisks: 'No physical block devices found.',
      diskName: 'Disk',
      model: 'Model',
      size: 'Size',
      transport: 'Bus',
      health: 'Health',
      systemDisk: 'System',
      partitions: 'Partitions',
      mount: 'Mount',
      fstype: 'Filesystem',
      used: 'Used',
      free: 'Free',
      temperature: 'Temperature',
      powerOn: 'Power-on hours',
      reallocated: 'Reallocated sectors',
      smartMsg: 'SMART message',
      toolsMissing: 'Optional tools not installed on this server:',
      lsblk: 'lsblk (util-linux)',
      smartctl: 'smartmontools (smartctl)',
      parted: 'parted',
      adminNote: 'Destructive actions require superadmin. System disks and mounts (/ , /boot, CoPanel) are protected.',
      manage: 'Manage',
      adminOnly: 'Superadmin only',
      createPartition: 'Create partition',
      formatPartition: 'Format partition',
      mountVolume: 'Mount volume',
      unmountVolume: 'Unmount volume',
      selectDisk: 'Select disk',
      selectPartition: 'Select partition',
      selectMount: 'Select mount point',
      start: 'Start',
      end: 'End',
      initGpt: 'Initialize GPT on empty disk',
      confirmDiskName: 'Type disk name to confirm',
      confirmPartName: 'Type partition name to confirm',
      labelOptional: 'Label (optional)',
      mountpoint: 'Mount point',
      options: 'Mount options',
      persistFstab: 'Add to /etc/fstab',
      removeFstab: 'Remove from /etc/fstab',
      runAction: 'Run',
      fstabTitle: '/etc/fstab entries',
      dataLossWarning: 'Formatting erases all data on the partition permanently.',
      success: 'Success',
      noCandidateDisk: 'No non-system disks available.',
      noCandidatePart: 'No unmounted partitions on data disks.',
      pools: 'Pools',
      lvmTitle: 'LVM storage pools',
      raidTitle: 'Software RAID (mdadm)',
      volumeGroups: 'Volume groups',
      logicalVolumes: 'Logical volumes',
      physicalVolumes: 'Physical volumes',
      raidArrays: 'RAID arrays',
      noVg: 'No volume groups yet.',
      noLv: 'No logical volumes yet.',
      noRaid: 'No RAID arrays detected.',
      createVg: 'Create volume group',
      createLv: 'Create logical volume',
      extendLv: 'Extend logical volume',
      createRaid: 'Create RAID array',
      vgName: 'Volume group name',
      lvName: 'Logical volume name',
      lvSize: 'Size (100G or 100%FREE)',
      selectDevices: 'Select devices',
      raidLevel: 'RAID level',
      confirmVgName: 'Type VG name to confirm',
      confirmLvPath: 'Type vg_name/lv_name to confirm',
      confirmRaid: 'Type CREATE-RAID to confirm',
      growFilesystem: 'Grow filesystem after extend',
      vgFree: 'free',
      raidConfirmWarning: 'Creating RAID will erase data on selected devices.',
      lvm: 'lvm2',
      mdadm: 'mdadm',
      maintenance: 'Maintenance',
      maintenanceTitle: 'Drive health checks & scrub',
      smartTest: 'SMART self-test',
      smartShort: 'Short test (~2 min)',
      smartLong: 'Long test (hours)',
      btrfsScrub: 'Btrfs scrub',
      raidCheck: 'RAID parity check',
      runTest: 'Start test',
      runScrub: 'Start scrub',
      runRaidCheck: 'Start check',
      maintenanceHistory: 'Recent maintenance',
      noHistory: 'No maintenance actions yet.',
      activeAlerts: 'Active alerts',
      noAlerts: 'No storage alerts.',
      selectDrive: 'Select drive',
    },
    vi: {
      title: 'Quản lý Lưu trữ',
      desc: 'Theo dõi ổ đĩa vật lý, volume đã mount và sức khỏe SMART trên máy chủ.',
      overview: 'Tổng quan',
      disks: 'Ổ đĩa',
      volumes: 'Volume',
      healthy: 'Khỏe mạnh',
      warning: 'Cảnh báo',
      critical: 'Nguy hiểm',
      systemHealthy: 'Hệ thống lưu trữ khỏe mạnh.',
      refresh: 'Làm mới',
      loading: 'Đang tải dữ liệu lưu trữ...',
      totalDisks: 'Ổ đĩa vật lý',
      totalVolumes: 'Volume đã mount',
      totalCapacity: 'Dung lượng ổ thô',
      smartMonitored: 'Đang giám sát SMART',
      volumeUsage: 'Dung lượng volume',
      noVolumes: 'Không phát hiện volume đã mount.',
      noDisks: 'Không tìm thấy block device vật lý.',
      diskName: 'Ổ đĩa',
      model: 'Model',
      size: 'Dung lượng',
      transport: 'Bus',
      health: 'Sức khỏe',
      systemDisk: 'Hệ thống',
      partitions: 'Phân vùng',
      mount: 'Mount',
      fstype: 'Hệ thống tệp',
      used: 'Đã dùng',
      free: 'Còn trống',
      temperature: 'Nhiệt độ',
      powerOn: 'Giờ hoạt động',
      reallocated: 'Sector tái phân bổ',
      smartMsg: 'Thông báo SMART',
      toolsMissing: 'Thiếu công cụ tùy chọn trên máy chủ:',
      lsblk: 'lsblk (util-linux)',
      smartctl: 'smartmontools (smartctl)',
      parted: 'parted',
      adminNote: 'Thao tac pha hoai can superadmin. O he thong va mount (/ , /boot, CoPanel) duoc bao ve.',
      manage: 'Quan ly',
      adminOnly: 'Chi superadmin',
      createPartition: 'Tao phan vung',
      formatPartition: 'Dinh dang phan vung',
      mountVolume: 'Mount volume',
      unmountVolume: 'Gỡ mount',
      selectDisk: 'Chon o dia',
      selectPartition: 'Chon phan vung',
      selectMount: 'Chon diem mount',
      start: 'Bat dau',
      end: 'Ket thuc',
      initGpt: 'Khoi tao GPT cho o moi',
      confirmDiskName: 'Nhap ten o de xac nhan',
      confirmPartName: 'Nhap ten phan vung de xac nhan',
      labelOptional: 'Nhan (tuy chon)',
      mountpoint: 'Diem mount',
      options: 'Tuy chon mount',
      persistFstab: 'Them vao /etc/fstab',
      removeFstab: 'Xoa khoi /etc/fstab',
      runAction: 'Thuc hien',
      fstabTitle: 'Muc /etc/fstab',
      dataLossWarning: 'Dinh dang se xoa vinh vien moi du lieu tren phan vung.',
      success: 'Thanh cong',
      noCandidateDisk: 'Khong co o du lieu kha dung.',
      noCandidatePart: 'Khong co phan vung chua mount tren o du lieu.',
      pools: 'Pool',
      lvmTitle: 'Pool luu tru LVM',
      raidTitle: 'RAID phan mem (mdadm)',
      volumeGroups: 'Volume group',
      logicalVolumes: 'Logical volume',
      physicalVolumes: 'Physical volume',
      raidArrays: 'Mang RAID',
      noVg: 'Chua co volume group.',
      noLv: 'Chua co logical volume.',
      noRaid: 'Khong phat hien mang RAID.',
      createVg: 'Tao volume group',
      createLv: 'Tao logical volume',
      extendLv: 'Mo rong logical volume',
      createRaid: 'Tao mang RAID',
      vgName: 'Ten volume group',
      lvName: 'Ten logical volume',
      lvSize: 'Dung luong (100G hoac 100%FREE)',
      selectDevices: 'Chon thiet bi',
      raidLevel: 'Cap RAID',
      confirmVgName: 'Nhap ten VG de xac nhan',
      confirmLvPath: 'Nhap vg_name/lv_name de xac nhan',
      confirmRaid: 'Nhap CREATE-RAID de xac nhan',
      growFilesystem: 'Mo rong filesystem sau extend',
      vgFree: 'con trong',
      raidConfirmWarning: 'Tao RAID se xoa du lieu tren cac thiet bi da chon.',
      lvm: 'lvm2',
      mdadm: 'mdadm',
      maintenance: 'Bảo trì',
      maintenanceTitle: 'Kiem tra suc khoe o & scrub',
      smartTest: 'SMART self-test',
      smartShort: 'Test ngan (~2 phut)',
      smartLong: 'Test dai (nhieu gio)',
      btrfsScrub: 'Btrfs scrub',
      raidCheck: 'Kiem tra RAID',
      runTest: 'Bat dau test',
      runScrub: 'Bat dau scrub',
      runRaidCheck: 'Bat dau kiem tra',
      maintenanceHistory: 'Bao tri gan day',
      noHistory: 'Chua co thao tac bao tri.',
      activeAlerts: 'Canh bao dang hoat dong',
      noAlerts: 'Khong co canh bao luu tru.',
      selectDrive: 'Chon o dia',
    },
  };

  const tr = t[language || 'en'];

  const authHeaders = useMemo(() => {
    const h: Record<string, string> = {};
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

  const fetchJson = useCallback(async <T,>(path: string): Promise<T> => {
    const res = await fetch(path, { headers: authHeaders });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.detail || body.message || `HTTP ${res.status}`);
    }
    return body.data as T;
  }, [authHeaders]);

  const postJson = useCallback(async <T,>(path: string, payload: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.detail || body.message || `HTTP ${res.status}`);
    }
    return body.data as T;
  }, [authHeaders]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, dk, vol, fst, poolData, maint, alertData] = await Promise.all([
        fetchJson<OverviewData>('/api/storage_manager/overview'),
        fetchJson<DiskInfo[]>('/api/storage_manager/disks'),
        fetchJson<VolumeInfo[]>('/api/storage_manager/volumes'),
        fetchJson<FstabEntry[]>('/api/storage_manager/fstab').catch(() => []),
        fetchJson<PoolsData>('/api/storage_manager/pools').catch(() => null),
        fetchJson<{ targets: MaintenanceTargets; history: MaintenanceHistoryItem[] }>('/api/storage_manager/maintenance').catch(() => null),
        fetchJson<{ alerts: StorageAlert[] }>('/api/storage_manager/alerts').catch(() => ({ alerts: [] })),
      ]);
      setOverview(ov);
      setDisks(dk);
      setVolumes(vol);
      setFstab(fst);
      setPools(poolData);
      setMaintenance(maint);
      setAlerts(alertData?.alerts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load storage data');
    } finally {
      setLoading(false);
    }
  }, [fetchJson]);

  useEffect(() => {
    loadAll();
  }, [loadAll, language]);

  const health = overview?.health || 'healthy';
  const hs = healthStyles(health, isDark);
  const healthLabel = health === 'critical' ? tr.critical : health === 'warning' ? tr.warning : tr.healthy;

  const tabs: { id: TabId; label: string; icon: typeof Icons.LayoutDashboard }[] = [
    { id: 'overview', label: tr.overview, icon: Icons.LayoutDashboard },
    { id: 'disks', label: tr.disks, icon: Icons.HardDrive },
    { id: 'volumes', label: tr.volumes, icon: Icons.Database },
    { id: 'pools', label: tr.pools, icon: Icons.Layers },
    { id: 'maintenance', label: tr.maintenance, icon: Icons.Stethoscope },
    { id: 'manage', label: tr.manage, icon: Icons.Settings2 },
  ];

  const usedPvPaths = useMemo(
    () => new Set((pools?.lvm.physical_volumes || []).map((p) => p.pv_name)),
    [pools],
  );

  const togglePoolDevice = (path: string, list: string[], setter: (v: string[]) => void) => {
    setter(list.includes(path) ? list.filter((p) => p !== path) : [...list, path]);
  };

  const dataDisks = useMemo(() => disks.filter((d) => !d.is_system_disk), [disks]);
  const formatCandidates = useMemo(() => {
    return dataDisks.flatMap((d) =>
      d.partitions
        .filter((p) => !p.mountpoint)
        .map((p) => ({ ...p, diskName: d.name })),
    );
  }, [dataDisks]);

  const poolDeviceCandidates = useMemo(
    () => formatCandidates.filter((p) => !usedPvPaths.has(p.path)),
    [formatCandidates, usedPvPaths],
  );

  const unmountCandidates = useMemo(
    () => volumes.filter((v) => !isProtectedMount(v.mountpoint)),
    [volumes],
  );

  const runAction = async (fn: () => Promise<{ message?: string }>) => {
    setActionLoading(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const result = await fn();
      setActionMsg(result.message || tr.success);
      await loadAll();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const missingTools = overview
    ? [
        !overview.tools.lsblk ? tr.lsblk : null,
        !overview.tools.smartctl ? tr.smartctl : null,
        overview.tools.parted === false ? tr.parted : null,
        overview.tools.lvm === false ? tr.lvm : null,
        overview.tools.mdadm === false ? tr.mdadm : null,
      ].filter(Boolean) as string[]
    : [];

  return (
    <div className={`p-4 md:p-8 max-w-7xl mx-auto space-y-6 select-none ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      <div className={`relative overflow-hidden border p-6 rounded-2xl shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-4 ${
        isDark ? 'bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 border-slate-800' : 'bg-gradient-to-br from-white via-slate-50 to-white border-slate-200'
      }`}>
        <div className="space-y-2 min-w-0">
          <h1 className={`text-2xl font-extrabold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-800'}`}>
            <Icons.HardDrive className={`w-7 h-7 ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`} />
            {tr.title}
          </h1>
          <p className={`text-xs md:text-sm max-w-2xl ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{tr.desc}</p>
          <p className={`text-[11px] ${isDark ? 'text-amber-400/90' : 'text-amber-700'}`}>{tr.adminNote}</p>
        </div>
        <button
          onClick={loadAll}
          disabled={loading}
          className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition ${
            isDark ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Icons.RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {tr.refresh}
        </button>
      </div>

      <div className={`flex flex-wrap gap-2 p-1 rounded-xl border ${isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-slate-100 border-slate-200'}`}>
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
                active
                  ? isDark ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/30' : 'bg-white text-cyan-700 border border-cyan-200 shadow-sm'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className={`p-4 rounded-xl border text-xs flex items-center gap-2 ${isDark ? 'bg-red-950/30 border-red-800/50 text-red-300' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <Icons.AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && !overview ? (
        <div className={`flex flex-col items-center justify-center h-48 border rounded-2xl ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
          <Icons.Loader2 className="w-8 h-8 animate-spin text-cyan-500 mb-2" />
          <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.loading}</p>
        </div>
      ) : (
        <>
          {tab === 'overview' && overview && (
            <div className="space-y-6">
              <div className={`rounded-2xl border p-6 flex flex-col md:flex-row md:items-center gap-4 ${hs.ring}`}>
                <div className={`w-16 h-16 rounded-full border-4 flex items-center justify-center shrink-0 ${
                  health === 'healthy'
                    ? isDark ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-emerald-400 bg-emerald-100'
                    : health === 'warning'
                      ? isDark ? 'border-amber-500/50 bg-amber-500/10' : 'border-amber-400 bg-amber-100'
                      : isDark ? 'border-red-500/50 bg-red-500/10' : 'border-red-400 bg-red-100'
                }`}>
                  {health === 'healthy' ? (
                    <Icons.CheckCircle2 className={`w-8 h-8 ${hs.icon}`} />
                  ) : (
                    <Icons.AlertTriangle className={`w-8 h-8 ${hs.icon}`} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className={`text-xl font-extrabold ${hs.text}`}>{healthLabel}</h2>
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${hs.badge}`}>{health}</span>
                  </div>
                  <p className={`text-sm mt-1 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                    {overview.message || tr.systemHealthy}
                  </p>
                  {overview.issues.length > 0 && (
                    <ul className={`mt-2 text-xs space-y-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {overview.issues.map((issue) => (
                        <li key={issue} className="flex items-start gap-1.5">
                          <span className="shrink-0 mt-0.5">•</span>
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: tr.totalDisks, value: String(overview.disk_count), icon: Icons.HardDrive },
                  { label: tr.totalVolumes, value: String(overview.volume_count), icon: Icons.FolderOpen },
                  { label: tr.totalCapacity, value: formatBytes(overview.total_disk_bytes, language || 'en'), icon: Icons.Layers },
                  { label: tr.smartMonitored, value: `${overview.smart_passed}/${overview.smart_monitored}`, icon: Icons.Activity },
                ].map((card) => {
                  const Icon = card.icon;
                  return (
                    <div key={card.label} className={`rounded-xl border p-4 ${isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <p className={`text-[10px] uppercase font-bold tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{card.label}</p>
                        <Icon className={`w-4 h-4 ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`} />
                      </div>
                      <p className={`text-lg font-extrabold ${isDark ? 'text-white' : 'text-slate-800'}`}>{card.value}</p>
                    </div>
                  );
                })}
              </div>

              {missingTools.length > 0 && (
                <div className={`rounded-xl border p-4 text-xs ${isDark ? 'border-amber-800/40 bg-amber-950/20 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                  <p className="font-bold mb-1">{tr.toolsMissing}</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {missingTools.map((tool) => <li key={tool}>{tool}</li>)}
                  </ul>
                </div>
              )}

              <div>
                <h3 className={`text-sm font-bold mb-3 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{tr.volumeUsage}</h3>
                {volumes.length === 0 ? (
                  <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.noVolumes}</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {volumes.map((vol) => (
                      <div key={`${vol.device}-${vol.mountpoint}`} className={`rounded-xl border p-4 space-y-3 ${isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className={`font-bold text-sm truncate ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{vol.mountpoint}</p>
                            <p className={`text-[11px] font-mono truncate ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{vol.device} · {vol.fstype}</p>
                          </div>
                          <Icons.CheckCircle2 className={`w-5 h-5 shrink-0 ${vol.percent >= 95 ? 'text-red-500' : vol.percent >= 85 ? 'text-amber-500' : isDark ? 'text-emerald-400' : 'text-emerald-600'}`} />
                        </div>
                        <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                          <div
                            className={`h-full rounded-full transition-all ${vol.percent >= 95 ? 'bg-red-500' : vol.percent >= 85 ? 'bg-amber-500' : 'bg-cyan-500'}`}
                            style={{ width: `${Math.min(100, vol.percent)}%` }}
                          />
                        </div>
                        <div className={`flex justify-between text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                          <span>{formatBytes(vol.used, language || 'en')} {tr.used}</span>
                          <span>{formatBytes(vol.free, language || 'en')} {tr.free}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'disks' && (
            <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white shadow-sm'}`}>
              {disks.length === 0 ? (
                <p className={`p-8 text-center text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.noDisks}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className={`uppercase tracking-wider text-[10px] font-bold ${isDark ? 'bg-slate-950/70 text-slate-400' : 'bg-slate-50 text-slate-500'}`}>
                      <tr>
                        <th className="p-3">{tr.diskName}</th>
                        <th className="p-3">{tr.model}</th>
                        <th className="p-3">{tr.size}</th>
                        <th className="p-3">{tr.transport}</th>
                        <th className="p-3">{tr.health}</th>
                        <th className="p-3 text-center">{tr.partitions}</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-100'}`}>
                      {disks.map((disk) => {
                        const badge = smartBadge(disk.smart, isDark);
                        const open = expandedDisk === disk.name;
                        return (
                          <Fragment key={disk.name}>
                            <tr
                              onClick={() => setExpandedDisk(open ? null : disk.name)}
                              className={`cursor-pointer transition ${isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}
                            >
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  {open ? <Icons.ChevronDown className="w-3.5 h-3.5" /> : <Icons.ChevronRight className="w-3.5 h-3.5" />}
                                  <span className="font-mono font-bold">{disk.name}</span>
                                  {disk.is_system_disk && (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${isDark ? 'border-blue-500/30 text-blue-300 bg-blue-500/10' : 'border-blue-200 text-blue-700 bg-blue-50'}`}>
                                      {tr.systemDisk}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className={`p-3 max-w-[12rem] truncate ${isDark ? 'text-slate-300' : 'text-slate-700'}`} title={disk.model}>{disk.model}</td>
                              <td className="p-3 font-mono">{formatBytes(disk.size_bytes, language || 'en')}</td>
                              <td className={`p-3 uppercase ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{disk.transport || (disk.rotational ? 'hdd' : 'ssd')}</td>
                              <td className="p-3">
                                <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
                              </td>
                              <td className="p-3 text-center">{disk.partitions.length}</td>
                            </tr>
                            {open && (
                              <tr className={isDark ? 'bg-slate-950/50' : 'bg-slate-50/80'}>
                                <td colSpan={6} className="p-4">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className={`rounded-xl border p-3 space-y-2 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                                      <p className="font-bold text-[11px] uppercase tracking-wider opacity-70">SMART</p>
                                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                                        <div><span className="opacity-60">{tr.temperature}:</span> {disk.smart.temperature_c != null ? `${disk.smart.temperature_c}°C` : '—'}</div>
                                        <div><span className="opacity-60">{tr.powerOn}:</span> {disk.smart.power_on_hours != null ? disk.smart.power_on_hours : '—'}</div>
                                        <div><span className="opacity-60">{tr.reallocated}:</span> {disk.smart.reallocated_sectors != null ? disk.smart.reallocated_sectors : '—'}</div>
                                        <div className="col-span-2"><span className="opacity-60">{tr.smartMsg}:</span> {disk.smart.message || '—'}</div>
                                      </div>
                                    </div>
                                    <div className={`rounded-xl border p-3 space-y-2 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                                      <p className="font-bold text-[11px] uppercase tracking-wider opacity-70">{tr.partitions}</p>
                                      {disk.partitions.length === 0 ? (
                                        <p className="text-[11px] opacity-60">—</p>
                                      ) : (
                                        <div className="space-y-1.5">
                                          {disk.partitions.map((part) => (
                                            <div key={part.name} className={`flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                                              <span>{part.name}</span>
                                              <span>{formatBytes(part.size_bytes, language || 'en')}</span>
                                              <span>{part.fstype || '—'}</span>
                                              <span>{part.mountpoint || '—'}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'volumes' && (
            <div className={`rounded-2xl border overflow-hidden ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white shadow-sm'}`}>
              {volumes.length === 0 ? (
                <p className={`p-8 text-center text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.noVolumes}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className={`uppercase tracking-wider text-[10px] font-bold ${isDark ? 'bg-slate-950/70 text-slate-400' : 'bg-slate-50 text-slate-500'}`}>
                      <tr>
                        <th className="p-3">{tr.mount}</th>
                        <th className="p-3">{tr.diskName}</th>
                        <th className="p-3">{tr.fstype}</th>
                        <th className="p-3">{tr.used}</th>
                        <th className="p-3">{tr.free}</th>
                        <th className="p-3">%</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-100'}`}>
                      {volumes.map((vol) => (
                        <tr key={`${vol.device}-${vol.mountpoint}`} className={isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}>
                          <td className={`p-3 font-bold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{vol.mountpoint}</td>
                          <td className="p-3 font-mono">{vol.device}</td>
                          <td className="p-3">{vol.fstype}</td>
                          <td className="p-3 font-mono">{formatBytes(vol.used, language || 'en')}</td>
                          <td className="p-3 font-mono">{formatBytes(vol.free, language || 'en')}</td>
                          <td className="p-3">
                            <span className={`font-bold ${vol.percent >= 95 ? 'text-red-500' : vol.percent >= 85 ? 'text-amber-500' : isDark ? 'text-cyan-400' : 'text-cyan-700'}`}>
                              {vol.percent.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'pools' && (
            <div className="space-y-4">
              {!pools ? (
                <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.loading}</p>
              ) : (
              <>
              {(actionMsg || actionErr) && (
                <div className={`p-3 rounded-xl border text-xs ${actionErr
                  ? isDark ? 'bg-red-950/30 border-red-800 text-red-300' : 'bg-red-50 border-red-200 text-red-700'
                  : isDark ? 'bg-emerald-950/30 border-emerald-800 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}>
                  {actionErr || actionMsg}
                </div>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className={`rounded-2xl border p-4 space-y-4 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                  <h3 className="text-sm font-bold flex items-center gap-2"><Icons.Layers className="w-4 h-4" />{tr.lvmTitle}</h3>

                  <div>
                    <p className="text-[11px] font-bold uppercase opacity-60 mb-2">{tr.volumeGroups}</p>
                    {pools.lvm.volume_groups.length === 0 ? (
                      <p className="text-xs opacity-60">{tr.noVg}</p>
                    ) : (
                      <div className="space-y-2">
                        {pools.lvm.volume_groups.map((vg) => (
                          <div key={vg.vg_name} className={`rounded-lg border px-3 py-2 text-xs ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                            <div className="font-bold">{vg.vg_name}</div>
                            <div className={`font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                              {formatBytes(vg.vg_size_bytes, language || 'en')} · {tr.vgFree} {formatBytes(vg.vg_free_bytes, language || 'en')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-[11px] font-bold uppercase opacity-60 mb-2">{tr.logicalVolumes}</p>
                    {pools.lvm.logical_volumes.length === 0 ? (
                      <p className="text-xs opacity-60">{tr.noLv}</p>
                    ) : (
                      <div className="space-y-2">
                        {pools.lvm.logical_volumes.map((lv) => (
                          <div key={lv.lv_path} className={`rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                            <div className="font-bold">{lv.vg_name}/{lv.lv_name}</div>
                            <div className="opacity-70">{formatBytes(lv.lv_size_bytes, language || 'en')} · {lv.mountpoint || '—'} · {lv.fstype || '—'}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className={`rounded-2xl border p-4 space-y-4 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                  <h3 className="text-sm font-bold flex items-center gap-2"><Icons.Shield className="w-4 h-4" />{tr.raidTitle}</h3>
                  {pools.raid.arrays.length === 0 ? (
                    <p className="text-xs opacity-60">{tr.noRaid}</p>
                  ) : (
                    <div className="space-y-2">
                      {pools.raid.arrays.map((raid) => (
                        <div key={raid.path} className={`rounded-lg border px-3 py-2 text-xs ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
                          <div className="font-bold font-mono">{raid.path} · {raid.level}</div>
                          <div className="opacity-70">{raid.state} · {raid.health} · {formatBytes(raid.size_bytes, language || 'en')}</div>
                          <div className="font-mono opacity-60 mt-1">{raid.devices.join(', ')}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className={`rounded-2xl border p-4 space-y-3 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                  <h4 className="text-xs font-bold">{tr.createVg}</h4>
                  <input value={vgName} onChange={(e) => setVgName(e.target.value)} placeholder={tr.vgName} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                  <p className="text-[11px] opacity-60">{tr.selectDevices}</p>
                  <div className="max-h-28 overflow-y-auto space-y-1">
                    {poolDeviceCandidates.map((p) => (
                      <label key={p.path} className="flex items-center gap-2 text-xs font-mono">
                        <input type="checkbox" checked={vgDevices.includes(p.path)} onChange={() => togglePoolDevice(p.path, vgDevices, setVgDevices)} />
                        {p.path}
                      </label>
                    ))}
                  </div>
                  <input value={vgConfirm} onChange={(e) => setVgConfirm(e.target.value)} placeholder={tr.confirmVgName} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                  <button disabled={actionLoading || !vgName || vgDevices.length === 0 || vgConfirm !== vgName} onClick={() => runAction(() => postJson('/api/storage_manager/pools/lvm/vg/create', { vg_name: vgName, devices: vgDevices, confirm_token: vgConfirm }))} className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-xl">{tr.runAction}</button>
                </div>

                <div className={`rounded-2xl border p-4 space-y-3 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                  <h4 className="text-xs font-bold">{tr.createLv}</h4>
                  <select value={lvVg} onChange={(e) => setLvVg(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                    <option value="">{tr.vgName}</option>
                    {pools.lvm.volume_groups.map((vg) => <option key={vg.vg_name} value={vg.vg_name}>{vg.vg_name}</option>)}
                  </select>
                  <input value={lvName} onChange={(e) => setLvName(e.target.value)} placeholder={tr.lvName} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                  <input value={lvSize} onChange={(e) => setLvSize(e.target.value)} placeholder={tr.lvSize} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                  <input value={lvConfirm} onChange={(e) => setLvConfirm(e.target.value)} placeholder={tr.confirmLvPath} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                  <button disabled={actionLoading || !lvVg || !lvName || lvConfirm !== `${lvVg}/${lvName}`} onClick={() => runAction(() => postJson('/api/storage_manager/pools/lvm/lv/create', { vg_name: lvVg, lv_name: lvName, size: lvSize, confirm_token: lvConfirm }))} className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-xl">{tr.runAction}</button>
                </div>

                <div className={`rounded-2xl border p-4 space-y-3 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                  <h4 className="text-xs font-bold">{tr.extendLv}</h4>
                  <select value={extVg} onChange={(e) => setExtVg(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                    <option value="">{tr.vgName}</option>
                    {pools.lvm.volume_groups.map((vg) => <option key={vg.vg_name} value={vg.vg_name}>{vg.vg_name}</option>)}
                  </select>
                  <select value={extLv} onChange={(e) => setExtLv(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                    <option value="">{tr.lvName}</option>
                    {pools.lvm.logical_volumes.filter((lv) => !extVg || lv.vg_name === extVg).map((lv) => (
                      <option key={lv.lv_path} value={lv.lv_name}>{lv.lv_name}</option>
                    ))}
                  </select>
                  <input value={extSize} onChange={(e) => setExtSize(e.target.value)} placeholder={tr.lvSize} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={extGrowFs} onChange={(e) => setExtGrowFs(e.target.checked)} />{tr.growFilesystem}</label>
                  <input value={extConfirm} onChange={(e) => setExtConfirm(e.target.value)} placeholder={tr.confirmLvPath} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                  <button disabled={actionLoading || !extVg || !extLv || extConfirm !== `${extVg}/${extLv}`} onClick={() => runAction(() => postJson('/api/storage_manager/pools/lvm/lv/extend', { vg_name: extVg, lv_name: extLv, size: extSize, grow_filesystem: extGrowFs, confirm_token: extConfirm }))} className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-xl">{tr.runAction}</button>
                </div>

                <div className={`rounded-2xl border p-4 space-y-3 ${isDark ? 'border-red-900/40 bg-red-950/10' : 'border-red-200 bg-red-50/40'}`}>
                  <h4 className="text-xs font-bold text-red-500">{tr.createRaid}</h4>
                  <p className="text-[11px] text-red-500">{tr.raidConfirmWarning}</p>
                  <select value={raidLevel} onChange={(e) => setRaidLevel(Number(e.target.value) as 1 | 5 | 10)} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                    <option value={1}>RAID 1 (mirror)</option>
                    <option value={5}>RAID 5</option>
                    <option value={10}>RAID 10</option>
                  </select>
                  <div className="max-h-28 overflow-y-auto space-y-1">
                    {poolDeviceCandidates.map((p) => (
                      <label key={`raid-${p.path}`} className="flex items-center gap-2 text-xs font-mono">
                        <input type="checkbox" checked={raidDevices.includes(p.path)} onChange={() => togglePoolDevice(p.path, raidDevices, setRaidDevices)} />
                        {p.path}
                      </label>
                    ))}
                  </div>
                  <input value={raidConfirm} onChange={(e) => setRaidConfirm(e.target.value)} placeholder={tr.confirmRaid} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                  <button disabled={actionLoading || raidDevices.length < 2 || raidConfirm !== 'CREATE-RAID'} onClick={() => runAction(() => postJson('/api/storage_manager/pools/raid/create', { level: raidLevel, devices: raidDevices, confirm_token: raidConfirm }))} className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-xl">{tr.runAction}</button>
                </div>
              </div>
              </>
              )}
            </div>
          )}

          {tab === 'maintenance' && (
            <div className="space-y-4">
              {(actionMsg || actionErr) && (
                <div className={`p-3 rounded-xl border text-xs ${actionErr
                  ? isDark ? 'bg-red-950/30 border-red-800 text-red-300' : 'bg-red-50 border-red-200 text-red-700'
                  : isDark ? 'bg-emerald-950/30 border-emerald-800 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}>
                  {actionErr || actionMsg}
                </div>
              )}

              <div className={`rounded-2xl border p-4 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                <h3 className="text-sm font-bold mb-2">{tr.activeAlerts}</h3>
                {alerts.length === 0 ? (
                  <p className="text-xs opacity-60">{tr.noAlerts}</p>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {alerts.map((a, i) => (
                      <li key={`${a.message}-${i}`} className={`flex gap-2 ${a.level === 'critical' ? 'text-red-500' : 'text-amber-500'}`}>
                        <Icons.AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{a.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.maintenanceTitle}</p>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className={`rounded-2xl border p-4 space-y-3 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                  <h4 className="text-xs font-bold">{tr.smartTest}</h4>
                  <select value={smartDisk} onChange={(e) => setSmartDisk(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                    <option value="">{tr.selectDrive}</option>
                    {(maintenance?.targets.smart_disks || []).map((d) => (
                      <option key={d.name} value={d.name}>{d.name} — {d.model}</option>
                    ))}
                  </select>
                  <select value={smartTestType} onChange={(e) => setSmartTestType(e.target.value as 'short' | 'long')} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                    <option value="short">{tr.smartShort}</option>
                    <option value="long">{tr.smartLong}</option>
                  </select>
                  <button
                    disabled={actionLoading || !smartDisk}
                    onClick={() => runAction(() => postJson('/api/storage_manager/maintenance/smart-test', { disk_name: smartDisk, test_type: smartTestType }))}
                    className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-xl"
                  >
                    {tr.runTest}
                  </button>
                </div>

                <div className={`rounded-2xl border p-4 space-y-3 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                  <h4 className="text-xs font-bold">{tr.btrfsScrub}</h4>
                  <select value={scrubMount} onChange={(e) => setScrubMount(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                    <option value="">{tr.mount}</option>
                    {(maintenance?.targets.btrfs_volumes || []).map((v) => (
                      <option key={v.mountpoint} value={v.mountpoint}>{v.mountpoint}</option>
                    ))}
                  </select>
                  <button
                    disabled={actionLoading || !scrubMount}
                    onClick={() => runAction(() => postJson('/api/storage_manager/maintenance/scrub/btrfs', { mountpoint: scrubMount }))}
                    className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-xl"
                  >
                    {tr.runScrub}
                  </button>
                </div>

                <div className={`rounded-2xl border p-4 space-y-3 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                  <h4 className="text-xs font-bold">{tr.raidCheck}</h4>
                  <select value={raidCheckDev} onChange={(e) => setRaidCheckDev(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                    <option value="">RAID</option>
                    {(maintenance?.targets.raid_arrays || []).map((r) => (
                      <option key={r.path} value={r.path}>{r.path} ({r.level})</option>
                    ))}
                  </select>
                  <button
                    disabled={actionLoading || !raidCheckDev}
                    onClick={() => runAction(() => postJson('/api/storage_manager/maintenance/scrub/raid', { md_device: raidCheckDev }))}
                    className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-xl"
                  >
                    {tr.runRaidCheck}
                  </button>
                </div>
              </div>

              <div className={`rounded-2xl border p-4 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                <h4 className="text-sm font-bold mb-3">{tr.maintenanceHistory}</h4>
                {!maintenance?.history?.length ? (
                  <p className="text-xs opacity-60">{tr.noHistory}</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {maintenance.history.map((item, idx) => (
                      <div key={`${item.at}-${idx}`} className={`text-[11px] font-mono border-b pb-2 ${isDark ? 'border-slate-800 text-slate-400' : 'border-slate-100 text-slate-600'}`}>
                        <span className="font-bold">{item.action}</span> · {item.target} — {item.result}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'manage' && (
            <div className="space-y-4">
              {(actionMsg || actionErr) && (
                <div className={`p-3 rounded-xl border text-xs ${actionErr
                  ? isDark ? 'bg-red-950/30 border-red-800 text-red-300' : 'bg-red-50 border-red-200 text-red-700'
                  : isDark ? 'bg-emerald-950/30 border-emerald-800 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}>
                  {actionErr || actionMsg}
                </div>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className={`rounded-2xl border p-4 space-y-3 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                  <h3 className="text-sm font-bold flex items-center gap-2"><Icons.Plus className="w-4 h-4" />{tr.createPartition}</h3>
                  <p className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.adminOnly}</p>
                  {dataDisks.length === 0 ? (
                    <p className="text-xs opacity-60">{tr.noCandidateDisk}</p>
                  ) : (
                    <>
                      <select value={partDisk} onChange={(e) => setPartDisk(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                        <option value="">{tr.selectDisk}</option>
                        {dataDisks.map((d) => <option key={d.name} value={d.name}>{d.name} — {d.model}</option>)}
                      </select>
                      <div className="grid grid-cols-2 gap-2">
                        <input value={partStart} onChange={(e) => setPartStart(e.target.value)} placeholder={tr.start} className={`rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                        <input value={partEnd} onChange={(e) => setPartEnd(e.target.value)} placeholder={tr.end} className={`rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                      </div>
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={partInitGpt} onChange={(e) => setPartInitGpt(e.target.checked)} />
                        {tr.initGpt}
                      </label>
                      <input value={partConfirm} onChange={(e) => setPartConfirm(e.target.value)} placeholder={tr.confirmDiskName} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                      <button
                        disabled={actionLoading || !partDisk || partConfirm !== partDisk}
                        onClick={() => runAction(() => postJson('/api/storage_manager/partitions/create', {
                          disk_name: partDisk,
                          start: partStart,
                          end: partEnd,
                          initialize_gpt: partInitGpt,
                          confirm_token: partConfirm,
                        }))}
                        className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-xl"
                      >
                        {tr.runAction}
                      </button>
                    </>
                  )}
                </div>

                <div className={`rounded-2xl border p-4 space-y-3 ${isDark ? 'border-red-900/40 bg-red-950/10' : 'border-red-200 bg-red-50/40'}`}>
                  <h3 className="text-sm font-bold flex items-center gap-2 text-red-500"><Icons.Eraser className="w-4 h-4" />{tr.formatPartition}</h3>
                  <p className="text-[11px] text-red-500">{tr.dataLossWarning}</p>
                  {formatCandidates.length === 0 ? (
                    <p className="text-xs opacity-60">{tr.noCandidatePart}</p>
                  ) : (
                    <>
                      <select value={formatDevice} onChange={(e) => setFormatDevice(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                        <option value="">{tr.selectPartition}</option>
                        {formatCandidates.map((p) => <option key={p.path} value={p.path}>{p.path}</option>)}
                      </select>
                      <select value={formatFs} onChange={(e) => setFormatFs(e.target.value as 'ext4' | 'xfs' | 'btrfs')} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                        <option value="ext4">ext4</option>
                        <option value="xfs">xfs</option>
                        <option value="btrfs">btrfs</option>
                      </select>
                      <input value={formatLabel} onChange={(e) => setFormatLabel(e.target.value)} placeholder={tr.labelOptional} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                      <input value={formatConfirm} onChange={(e) => setFormatConfirm(e.target.value)} placeholder={tr.confirmPartName} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                      <button
                        disabled={actionLoading || !formatDevice || formatConfirm !== formatDevice.replace('/dev/', '')}
                        onClick={() => runAction(() => postJson('/api/storage_manager/format', {
                          device: formatDevice,
                          fstype: formatFs,
                          label: formatLabel || null,
                          confirm_token: formatConfirm,
                        }))}
                        className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-xl"
                      >
                        {tr.runAction}
                      </button>
                    </>
                  )}
                </div>

                <div className={`rounded-2xl border p-4 space-y-3 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                  <h3 className="text-sm font-bold flex items-center gap-2"><Icons.FolderInput className="w-4 h-4" />{tr.mountVolume}</h3>
                  <input value={mountDevice} onChange={(e) => setMountDevice(e.target.value)} placeholder="/dev/sdb1" className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                  <input value={mountPoint} onChange={(e) => setMountPoint(e.target.value)} placeholder={tr.mountpoint} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                  <input value={mountFs} onChange={(e) => setMountFs(e.target.value)} placeholder={tr.fstype} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                  <input value={mountOptions} onChange={(e) => setMountOptions(e.target.value)} placeholder={tr.options} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`} />
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={mountPersist} onChange={(e) => setMountPersist(e.target.checked)} />
                    {tr.persistFstab}
                  </label>
                  <button
                    disabled={actionLoading || !mountDevice || !mountPoint}
                    onClick={() => runAction(() => postJson('/api/storage_manager/mount', {
                      device: mountDevice,
                      mountpoint: mountPoint,
                      fstype: mountFs || null,
                      options: mountOptions,
                      persist_fstab: mountPersist,
                    }))}
                    className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-xl"
                  >
                    {tr.runAction}
                  </button>
                </div>

                <div className={`rounded-2xl border p-4 space-y-3 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                  <h3 className="text-sm font-bold flex items-center gap-2"><Icons.FolderOutput className="w-4 h-4" />{tr.unmountVolume}</h3>
                  {unmountCandidates.length === 0 ? (
                    <p className="text-xs opacity-60">{tr.noVolumes}</p>
                  ) : (
                    <select value={unmountPoint} onChange={(e) => setUnmountPoint(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                      <option value="">{tr.selectMount}</option>
                      {unmountCandidates.map((v) => <option key={v.mountpoint} value={v.mountpoint}>{v.mountpoint} ({v.device})</option>)}
                    </select>
                  )}
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={unmountRemoveFstab} onChange={(e) => setUnmountRemoveFstab(e.target.checked)} />
                    {tr.removeFstab}
                  </label>
                  <button
                    disabled={actionLoading || !unmountPoint}
                    onClick={() => runAction(() => postJson('/api/storage_manager/unmount', {
                      mountpoint: unmountPoint,
                      remove_fstab: unmountRemoveFstab,
                    }))}
                    className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-xl"
                  >
                    {tr.runAction}
                  </button>
                </div>
              </div>

              <div className={`rounded-2xl border p-4 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                <h3 className="text-sm font-bold mb-3">{tr.fstabTitle}</h3>
                {fstab.length === 0 ? (
                  <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>—</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] font-mono">
                      <thead className={isDark ? 'text-slate-500' : 'text-slate-400'}>
                        <tr><th className="p-2">spec</th><th className="p-2">mount</th><th className="p-2">fstype</th><th className="p-2">options</th></tr>
                      </thead>
                      <tbody>
                        {fstab.map((row) => (
                          <tr key={row.raw} className={isDark ? 'border-t border-slate-800' : 'border-t border-slate-100'}>
                            <td className="p-2">{row.spec}</td>
                            <td className="p-2">{row.mountpoint}</td>
                            <td className="p-2">{row.fstype}</td>
                            <td className="p-2">{row.options}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
