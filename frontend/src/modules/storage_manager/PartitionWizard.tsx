/**
 * MiniTool Partition Wizard–style disk map + partition table + action panel.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Icons from 'lucide-react';

type FormatFsType = 'ext4' | 'xfs' | 'btrfs' | 'vfat' | 'exfat' | 'ntfs' | 'hfsplus';

const FORMAT_FS_OPTIONS: { value: FormatFsType; label: string }[] = [
  { value: 'ext4', label: 'ext4' },
  { value: 'xfs', label: 'XFS' },
  { value: 'btrfs', label: 'Btrfs' },
  { value: 'vfat', label: 'FAT32' },
  { value: 'exfat', label: 'exFAT' },
  { value: 'ntfs', label: 'NTFS' },
  { value: 'hfsplus', label: 'HFS+' },
];

const FS_COLORS: Record<string, string> = {
  ext4: 'bg-emerald-500',
  xfs: 'bg-teal-500',
  btrfs: 'bg-lime-500',
  vfat: 'bg-sky-500',
  exfat: 'bg-blue-500',
  ntfs: 'bg-indigo-500',
  hfsplus: 'bg-violet-500',
  swap: 'bg-purple-500',
  lvm2: 'bg-amber-500',
  unknown: 'bg-slate-500',
};

export interface WizardPartition {
  number: number;
  name?: string | null;
  path?: string | null;
  start_mib?: number | null;
  end_mib?: number | null;
  size_bytes?: number | null;
  fstype?: string | null;
  fstype_label?: string | null;
  mountpoint?: string | null;
  flags?: string[];
  is_boot?: boolean;
  label?: string | null;
  used_percent?: number | null;
  used_bytes?: number | null;
  free_bytes?: number | null;
  is_mounted?: boolean;
}

export interface DiskPartitionDetail {
  disk: string;
  is_system_disk: boolean;
  size_bytes: number;
  model?: string;
  partition_table?: string;
  partitions: WizardPartition[];
  unallocated: Array<{ start_mib: number; end_mib: number; size_mib: number }>;
}

interface DiskPartitionSummary {
  name: string;
  path: string;
  size_bytes: number;
  fstype?: string | null;
  fstype_label?: string | null;
  mountpoint?: string | null;
}

interface DiskSummary {
  name: string;
  path: string;
  size_bytes: number;
  model: string;
  is_system_disk: boolean;
  partitions?: DiskPartitionSummary[];
}

interface VolumeUsage {
  device: string;
  percent: number;
  used: number;
  free: number;
}

export interface PartitionWizardStrings {
  diskMap: string;
  partitionList: string;
  operations: string;
  unallocated: string;
  selectPartition: string;
  capacity: string;
  unused: string;
  type: string;
  status: string;
  mounted: string;
  unmounted: string;
  boot: string;
  createPartition: string;
  formatPartition: string;
  deletePartition: string;
  resizePartition: string;
  changeLabel: string;
  setBoot: string;
  clearBoot: string;
  mountVolume: string;
  unmountVolume: string;
  properties: string;
  partitionTable: string;
  confirmPartName: string;
  dataLossWarning: string;
  deleteWarning: string;
  resizeHint: string;
  growFilesystem: string;
  runAction: string;
  cancel: string;
  labelOptional: string;
  initGpt: string;
  start: string;
  end: string;
  noDisks: string;
  loadingLayout: string;
  systemDisk: string;
  protectedNote: string;
  selectDisk: string;
  mountpoint: string;
  persistFstab: string;
  removeFstab: string;
}

interface PartitionWizardProps {
  disks: DiskSummary[];
  volumes: VolumeUsage[];
  language: 'en' | 'vi';
  isDark: boolean;
  actionLoading: boolean;
  formatBytes: (bytes: number, language: 'en' | 'vi') => string;
  fetchJson: <T>(path: string) => Promise<T>;
  runAction: (fn: () => Promise<{ message?: string }>) => Promise<void>;
  postJson: <T>(path: string, payload: unknown) => Promise<T>;
  tr: PartitionWizardStrings;
}

type ModalKind = 'create' | 'format' | 'delete' | 'resize' | 'label' | 'boot' | 'mount' | 'unmount' | null;

function fsColor(fstype?: string | null): string {
  const key = (fstype || 'unknown').toLowerCase();
  return FS_COLORS[key] || FS_COLORS.unknown;
}

function buildLayoutFromDisks(
  diskName: string,
  disks: DiskSummary[],
  volumes: VolumeUsage[],
): DiskPartitionDetail | null {
  const disk = disks.find((d) => d.name === diskName);
  if (!disk) return null;
  const parts = disk.partitions || [];
  let cursor = 1.0;
  const partitions: WizardPartition[] = parts.map((part, idx) => {
    const usage = volumes.find((v) => v.device === part.path);
    const sizeMib = part.size_bytes / (1024 * 1024);
    const start = cursor;
    const end = start + sizeMib;
    cursor = end;
    return {
      number: idx + 1,
      name: part.name,
      path: part.path,
      start_mib: start,
      end_mib: end,
      size_bytes: part.size_bytes,
      fstype: part.fstype,
      fstype_label: part.fstype_label,
      mountpoint: part.mountpoint,
      flags: [],
      is_boot: false,
      label: null,
      used_percent: usage?.percent ?? null,
      used_bytes: usage?.used ?? null,
      free_bytes: usage?.free ?? null,
      is_mounted: Boolean(part.mountpoint),
    };
  });
  const diskMib = disk.size_bytes / (1024 * 1024);
  const unallocated: DiskPartitionDetail['unallocated'] = [];
  if (cursor < diskMib - 1) {
    unallocated.push({ start_mib: cursor, end_mib: diskMib, size_mib: diskMib - cursor });
  }
  return {
    disk: diskName,
    is_system_disk: disk.is_system_disk,
    size_bytes: disk.size_bytes,
    model: disk.model,
    partition_table: undefined,
    partitions,
    unallocated,
  };
}

function isPartitionsApiMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg === 'Not Found' || msg.includes('404') || msg.toLowerCase().includes('not found');
}

function displayName(part: WizardPartition): string {
  if (part.label) return part.label;
  if (part.mountpoint) return part.mountpoint;
  if (part.name) return part.name;
  return `#${part.number}`;
}

export default function PartitionWizard({
  disks,
  volumes,
  language,
  isDark,
  actionLoading,
  formatBytes,
  fetchJson,
  runAction,
  postJson,
  tr,
}: PartitionWizardProps) {
  const [activeDisk, setActiveDisk] = useState('');
  const [layout, setLayout] = useState<DiskPartitionDetail | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [layoutErr, setLayoutErr] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);

  const [partStart, setPartStart] = useState('1MiB');
  const [partEnd, setPartEnd] = useState('100%');
  const [partInitGpt, setPartInitGpt] = useState(false);
  const [partConfirm, setPartConfirm] = useState('');

  const [formatFs, setFormatFs] = useState<FormatFsType>('ext4');
  const [formatLabel, setFormatLabel] = useState('');
  const [formatConfirm, setFormatConfirm] = useState('');

  const [resizeEnd, setResizeEnd] = useState('100%');
  const [resizeGrowFs, setResizeGrowFs] = useState(true);
  const [resizeConfirm, setResizeConfirm] = useState('');

  const [labelText, setLabelText] = useState('');
  const [labelConfirm, setLabelConfirm] = useState('');

  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [bootConfirm, setBootConfirm] = useState('');

  const [mountPoint, setMountPoint] = useState('/mnt/data');
  const [mountPersist, setMountPersist] = useState(true);

  useEffect(() => {
    if (!activeDisk && disks.length > 0) {
      setActiveDisk(disks[0].name);
    }
  }, [disks, activeDisk]);

  const loadLayout = useCallback(async (diskName: string) => {
    if (!diskName) return;
    setLayoutLoading(true);
    setLayoutErr(null);
    try {
      const data = await fetchJson<DiskPartitionDetail>(
        `/api/storage_manager/disks/${encodeURIComponent(diskName)}/partitions`,
      );
      setLayout(data);
    } catch (err) {
      if (isPartitionsApiMissing(err)) {
        const fallback = buildLayoutFromDisks(diskName, disks, volumes);
        if (fallback) {
          setLayout(fallback);
          return;
        }
      }
      setLayout(null);
      setLayoutErr(err instanceof Error ? err.message : 'Failed to load layout');
    } finally {
      setLayoutLoading(false);
    }
  }, [fetchJson, disks, volumes]);

  useEffect(() => {
    if (activeDisk) {
      setSelectedPath(null);
      loadLayout(activeDisk);
    }
  }, [activeDisk, loadLayout]);

  const selected = useMemo(
    () => layout?.partitions.find((p) => p.path === selectedPath) ?? null,
    [layout, selectedPath],
  );

  const diskMeta = useMemo(
    () => disks.find((d) => d.name === activeDisk),
    [disks, activeDisk],
  );

  const canMutate = layout && !layout.is_system_disk;
  const hasSelection = Boolean(selected?.path && selected?.name);

  const openModal = (kind: ModalKind) => {
    if (!canMutate && kind !== 'mount' && kind !== 'unmount') return;
    if (kind !== 'create' && !hasSelection) return;
    setModal(kind);
    if (selected?.name) {
      setFormatConfirm('');
      setDeleteConfirm('');
      setResizeConfirm('');
      setLabelConfirm('');
      setBootConfirm('');
      setResizeEnd('100%');
      setLabelText(selected.label || '');
    }
    if (kind === 'create') {
      setPartConfirm(activeDisk);
      setPartStart('1MiB');
      setPartEnd('100%');
    }
  };

  const closeModal = () => setModal(null);

  const refreshAfter = async (fn: () => Promise<{ message?: string }>) => {
    await runAction(async () => {
      const result = await fn();
      await loadLayout(activeDisk);
      return result;
    });
    closeModal();
  };

  const mapSegments = useMemo(() => {
    if (!layout || !layout.size_bytes) return [];
    const total = layout.size_bytes;
    type Seg = {
      key: string;
      kind: 'part' | 'free';
      start: number;
      widthPct: number;
      part?: WizardPartition;
      label: string;
    };
    const raw: Seg[] = [];

    for (const part of layout.partitions) {
      const size = part.size_bytes || 0;
      raw.push({
        key: part.path || `p${part.number}`,
        kind: 'part',
        start: part.start_mib ?? 0,
        widthPct: Math.max(0.5, (size / total) * 100),
        part,
        label: displayName(part),
      });
    }
    for (const gap of layout.unallocated || []) {
      const gapBytes = gap.size_mib * 1024 * 1024;
      raw.push({
        key: `free-${gap.start_mib}`,
        kind: 'free',
        start: gap.start_mib,
        widthPct: Math.max(0.5, (gapBytes / total) * 100),
        label: tr.unallocated,
      });
    }
    return raw.sort((a, b) => a.start - b.start);
  }, [layout, tr.unallocated]);

  const actionBtn = (
    icon: ReactNode,
    label: string,
    onClick: () => void,
    disabled?: boolean,
    danger?: boolean,
  ) => (
    <button
      type="button"
      disabled={disabled || actionLoading}
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-[11px] font-semibold transition border ${
        disabled
          ? isDark ? 'opacity-40 border-slate-800 text-slate-500' : 'opacity-40 border-slate-100 text-slate-400'
          : danger
            ? isDark
              ? 'border-red-900/50 text-red-300 hover:bg-red-950/40'
              : 'border-red-200 text-red-700 hover:bg-red-50'
            : isDark
              ? 'border-slate-700 text-slate-200 hover:bg-slate-800'
              : 'border-slate-200 text-slate-700 hover:bg-slate-50'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  if (disks.length === 0) {
    return (
      <p className={`p-8 text-center text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.noDisks}</p>
    );
  }

  return (
    <div className="flex flex-col gap-0">
      {/* Disk tabs */}
      <div className={`flex flex-wrap gap-1 p-2 border-b ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
        {disks.map((disk) => {
          const active = disk.name === activeDisk;
          return (
            <button
              key={disk.name}
              type="button"
              onClick={() => setActiveDisk(disk.name)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${
                active
                  ? isDark ? 'bg-cyan-600 text-white' : 'bg-cyan-600 text-white'
                  : isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-600 hover:bg-white'
              }`}
            >
              <span className="font-mono">{disk.name}</span>
              <span className="opacity-70 ml-1.5 font-normal">
                {formatBytes(disk.size_bytes, language)}
              </span>
              {disk.is_system_disk && (
                <span className={`ml-1 text-[9px] px-1 rounded ${active ? 'bg-white/20' : isDark ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                  {tr.systemDisk}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col lg:flex-row min-h-[420px]">
        {/* Action panel */}
        <aside className={`w-full lg:w-52 shrink-0 border-b lg:border-b-0 lg:border-r p-3 space-y-1 ${isDark ? 'border-slate-800 bg-slate-950/30' : 'border-slate-200 bg-slate-50/80'}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
            {tr.operations}
          </p>
          {actionBtn(<Icons.Plus className="w-3.5 h-3.5" />, tr.createPartition, () => openModal('create'), !canMutate)}
          {actionBtn(<Icons.Eraser className="w-3.5 h-3.5" />, tr.formatPartition, () => openModal('format'), !canMutate || !hasSelection || selected?.is_mounted)}
          {actionBtn(<Icons.Trash2 className="w-3.5 h-3.5" />, tr.deletePartition, () => openModal('delete'), !canMutate || !hasSelection || selected?.is_mounted, true)}
          {actionBtn(<Icons.MoveHorizontal className="w-3.5 h-3.5" />, tr.resizePartition, () => openModal('resize'), !canMutate || !hasSelection)}
          {actionBtn(<Icons.Tag className="w-3.5 h-3.5" />, tr.changeLabel, () => openModal('label'), !canMutate || !hasSelection || !selected?.fstype)}
          {actionBtn(<Icons.Flag className="w-3.5 h-3.5" />, tr.setBoot, () => openModal('boot'), !canMutate || !hasSelection)}
          {actionBtn(<Icons.FolderOpen className="w-3.5 h-3.5" />, tr.mountVolume, () => openModal('mount'), !hasSelection || selected?.is_mounted || !selected?.fstype)}
          {actionBtn(<Icons.FolderMinus className="w-3.5 h-3.5" />, tr.unmountVolume, () => openModal('unmount'), !hasSelection || !selected?.is_mounted)}
          {layout?.is_system_disk && (
            <p className={`text-[10px] mt-3 px-1 ${isDark ? 'text-amber-400/80' : 'text-amber-700'}`}>{tr.protectedNote}</p>
          )}
        </aside>

        {/* Main: disk map + table */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Disk map */}
          <div className={`p-4 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                {tr.diskMap}
              </p>
              {diskMeta && (
                <span className={`text-[10px] truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  {diskMeta.model} · {layout?.partition_table?.toUpperCase() || '—'}
                </span>
              )}
            </div>
            {layoutLoading ? (
              <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.loadingLayout}</p>
            ) : layoutErr ? (
              <p className="text-xs text-red-500">{layoutErr}</p>
            ) : (
              <div className={`rounded-xl border p-2 ${isDark ? 'border-slate-700 bg-slate-950' : 'border-slate-300 bg-white'}`}>
                <div className="flex h-16 gap-0.5 overflow-hidden rounded-lg">
                  {mapSegments.map((seg) => {
                    if (seg.kind === 'free') {
                      return (
                        <div
                          key={seg.key}
                          style={{ width: `${seg.widthPct}%` }}
                          className={`relative min-w-[2px] h-full flex items-center justify-center text-[9px] font-bold border border-dashed ${
                            isDark ? 'bg-slate-900 border-slate-600 text-slate-500' : 'bg-slate-100 border-slate-300 text-slate-400'
                          }`}
                          title={tr.unallocated}
                        >
                          <span className="truncate px-0.5 hidden sm:inline">{tr.unallocated}</span>
                        </div>
                      );
                    }
                    const part = seg.part!;
                    const selectedHere = part.path === selectedPath;
                    const used = part.used_percent ?? 0;
                    return (
                      <button
                        key={seg.key}
                        type="button"
                        onClick={() => setSelectedPath(part.path || null)}
                        style={{ width: `${seg.widthPct}%` }}
                        className={`relative min-w-[24px] h-full text-left overflow-hidden transition ring-2 ${
                          selectedHere
                            ? 'ring-amber-400 z-10'
                            : 'ring-transparent hover:ring-cyan-500/50'
                        } ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}
                        title={`${displayName(part)} · ${part.fstype_label || part.fstype || '—'}`}
                      >
                        <div className={`absolute inset-x-0 bottom-0 h-1.5 ${fsColor(part.fstype)} opacity-80`} />
                        <div
                          className="absolute inset-x-0 bottom-1.5 h-2 bg-cyan-500/70"
                          style={{ width: `${Math.min(100, used)}%` }}
                        />
                        <div className="relative p-1 h-full flex flex-col justify-between">
                          <span className={`text-[9px] font-bold truncate leading-tight ${isDark ? 'text-white' : 'text-slate-800'}`}>
                            {displayName(part)}
                          </span>
                          <span className={`text-[8px] font-mono truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                            {part.fstype_label || part.fstype || '—'}
                            {part.size_bytes ? ` · ${formatBytes(part.size_bytes, language)}` : ''}
                          </span>
                          {part.is_boot && (
                            <Icons.Flag className="absolute top-1 right-1 w-2.5 h-2.5 text-amber-400" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className={`mt-1.5 text-[9px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  {diskMeta?.path} · {formatBytes(layout?.size_bytes || 0, language)}
                </div>
              </div>
            )}
          </div>

          {/* Partition table */}
          <div className="flex-1 overflow-x-auto">
            <p className={`px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
              {tr.partitionList}
            </p>
            <table className="w-full text-left text-xs">
              <thead className={`uppercase tracking-wider text-[10px] font-bold ${isDark ? 'bg-slate-950/70 text-slate-400' : 'bg-slate-50 text-slate-500'}`}>
                <tr>
                  <th className="p-2 pl-4">#</th>
                  <th className="p-2">{tr.capacity}</th>
                  <th className="p-2">{tr.unused}</th>
                  <th className="p-2">FS</th>
                  <th className="p-2">{tr.type}</th>
                  <th className="p-2">{tr.status}</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-100'}`}>
                {(layout?.partitions || []).map((part) => {
                  const rowSel = part.path === selectedPath;
                  const usedPct = part.used_percent;
                  return (
                    <tr
                      key={part.path || part.number}
                      onClick={() => setSelectedPath(part.path || null)}
                      className={`cursor-pointer transition ${
                        rowSel
                          ? isDark ? 'bg-cyan-950/40' : 'bg-cyan-50'
                          : isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="p-2 pl-4 font-mono font-bold">
                        {part.label || part.name || part.number}
                        {part.mountpoint && (
                          <span className={`block text-[9px] font-normal ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                            {part.mountpoint}
                          </span>
                        )}
                      </td>
                      <td className="p-2 font-mono">{formatBytes(part.size_bytes || 0, language)}</td>
                      <td className="p-2">
                        {usedPct != null ? (
                          <div className="flex items-center gap-2">
                            <div className={`w-16 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                              <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${100 - usedPct}%` }} />
                            </div>
                            <span className="font-mono text-[10px]">{100 - usedPct}%</span>
                          </div>
                        ) : '—'}
                      </td>
                      <td className="p-2">{part.fstype_label || part.fstype || '—'}</td>
                      <td className="p-2 text-[10px]">
                        {(part.flags || []).join(', ') || '—'}
                        {part.is_boot && <span className="ml-1 text-amber-500">{tr.boot}</span>}
                      </td>
                      <td className="p-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${
                          part.is_mounted
                            ? isDark ? 'border-emerald-500/30 text-emerald-400' : 'border-emerald-200 text-emerald-700'
                            : isDark ? 'border-slate-600 text-slate-400' : 'border-slate-200 text-slate-500'
                        }`}>
                          {part.is_mounted ? tr.mounted : tr.unmounted}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!layoutLoading && (layout?.partitions.length || 0) === 0 && (
              <p className={`p-4 text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{tr.selectPartition}</p>
            )}
          </div>

          {/* Properties strip */}
          {selected && (
            <div className={`px-4 py-3 border-t text-[11px] grid grid-cols-2 md:grid-cols-4 gap-2 ${isDark ? 'border-slate-800 bg-slate-950/40' : 'border-slate-200 bg-slate-50/50'}`}>
              <div><span className="opacity-60">{tr.properties}:</span> <span className="font-mono">{selected.path}</span></div>
              <div><span className="opacity-60">{tr.partitionTable}:</span> {layout?.partition_table || '—'}</div>
              <div><span className="opacity-60">{tr.capacity}:</span> {formatBytes(selected.size_bytes || 0, language)}</div>
              <div><span className="opacity-60">Label:</span> {selected.label || '—'}</div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={closeModal}>
          <div
            className={`w-full max-w-md rounded-2xl border p-5 space-y-4 shadow-2xl ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {modal === 'create' && (
              <>
                <h3 className="font-bold">{tr.createPartition}</h3>
                <p className="text-[11px] opacity-70">{tr.selectDisk}: <span className="font-mono">{activeDisk}</span></p>
                <label className="block text-[11px] space-y-1">
                  {tr.start}
                  <input value={partStart} onChange={(e) => setPartStart(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'border-slate-200'}`} />
                </label>
                <label className="block text-[11px] space-y-1">
                  {tr.end}
                  <input value={partEnd} onChange={(e) => setPartEnd(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'border-slate-200'}`} />
                </label>
                <label className="flex items-center gap-2 text-[11px]">
                  <input type="checkbox" checked={partInitGpt} onChange={(e) => setPartInitGpt(e.target.checked)} />
                  {tr.initGpt}
                </label>
                <label className="block text-[11px] space-y-1">
                  {tr.confirmPartName}
                  <input value={partConfirm} onChange={(e) => setPartConfirm(e.target.value)} placeholder={activeDisk} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'border-slate-200'}`} />
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={closeModal} className={`flex-1 py-2 rounded-xl text-xs font-bold border ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>{tr.cancel}</button>
                  <button
                    type="button"
                    disabled={actionLoading || partConfirm !== activeDisk}
                    onClick={() => refreshAfter(() => postJson('/api/storage_manager/partitions/create', {
                      disk_name: activeDisk,
                      start: partStart,
                      end: partEnd,
                      initialize_gpt: partInitGpt,
                      confirm_token: partConfirm,
                    }))}
                    className="flex-1 py-2 rounded-xl text-xs font-bold bg-cyan-600 text-white disabled:opacity-50"
                  >
                    {tr.runAction}
                  </button>
                </div>
              </>
            )}

            {modal === 'format' && selected && (
              <>
                <h3 className="font-bold">{tr.formatPartition}</h3>
                <p className="text-[11px] text-red-500">{tr.dataLossWarning}</p>
                <p className="text-[11px] font-mono">{selected.path}</p>
                <select value={formatFs} onChange={(e) => setFormatFs(e.target.value as FormatFsType)} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'border-slate-200'}`}>
                  {FORMAT_FS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input value={formatLabel} onChange={(e) => setFormatLabel(e.target.value)} placeholder={tr.labelOptional} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'border-slate-200'}`} />
                <input value={formatConfirm} onChange={(e) => setFormatConfirm(e.target.value)} placeholder={tr.confirmPartName} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'border-slate-200'}`} />
                <div className="flex gap-2">
                  <button type="button" onClick={closeModal} className={`flex-1 py-2 rounded-xl text-xs font-bold border ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>{tr.cancel}</button>
                  <button
                    type="button"
                    disabled={actionLoading || formatConfirm !== selected.name}
                    onClick={() => refreshAfter(() => postJson('/api/storage_manager/format', {
                      device: selected.path,
                      fstype: formatFs,
                      label: formatLabel || undefined,
                      confirm_token: formatConfirm,
                    }))}
                    className="flex-1 py-2 rounded-xl text-xs font-bold bg-red-600 text-white disabled:opacity-50"
                  >
                    {tr.runAction}
                  </button>
                </div>
              </>
            )}

            {modal === 'delete' && selected && (
              <>
                <h3 className="font-bold text-red-500">{tr.deletePartition}</h3>
                <p className="text-[11px]">{tr.deleteWarning}</p>
                <p className="text-[11px] font-mono">{selected.path}</p>
                <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={tr.confirmPartName} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'border-slate-200'}`} />
                <div className="flex gap-2">
                  <button type="button" onClick={closeModal} className={`flex-1 py-2 rounded-xl text-xs font-bold border ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>{tr.cancel}</button>
                  <button
                    type="button"
                    disabled={actionLoading || deleteConfirm !== selected.name}
                    onClick={() => refreshAfter(() => postJson('/api/storage_manager/partitions/delete', {
                      device: selected.path,
                      confirm_token: deleteConfirm,
                    }))}
                    className="flex-1 py-2 rounded-xl text-xs font-bold bg-red-600 text-white disabled:opacity-50"
                  >
                    {tr.runAction}
                  </button>
                </div>
              </>
            )}

            {modal === 'resize' && selected && (
              <>
                <h3 className="font-bold">{tr.resizePartition}</h3>
                <p className="text-[11px] opacity-70">{tr.resizeHint}</p>
                <p className="text-[11px] font-mono">{selected.path}</p>
                <label className="block text-[11px] space-y-1">
                  {tr.end}
                  <input value={resizeEnd} onChange={(e) => setResizeEnd(e.target.value)} placeholder="100%" className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'border-slate-200'}`} />
                </label>
                <label className="flex items-center gap-2 text-[11px]">
                  <input type="checkbox" checked={resizeGrowFs} onChange={(e) => setResizeGrowFs(e.target.checked)} />
                  {tr.growFilesystem}
                </label>
                <input value={resizeConfirm} onChange={(e) => setResizeConfirm(e.target.value)} placeholder={tr.confirmPartName} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'border-slate-200'}`} />
                <div className="flex gap-2">
                  <button type="button" onClick={closeModal} className={`flex-1 py-2 rounded-xl text-xs font-bold border ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>{tr.cancel}</button>
                  <button
                    type="button"
                    disabled={actionLoading || resizeConfirm !== selected.name}
                    onClick={() => refreshAfter(() => postJson('/api/storage_manager/partitions/resize', {
                      device: selected.path,
                      end: resizeEnd,
                      grow_filesystem: resizeGrowFs,
                      confirm_token: resizeConfirm,
                    }))}
                    className="flex-1 py-2 rounded-xl text-xs font-bold bg-cyan-600 text-white disabled:opacity-50"
                  >
                    {tr.runAction}
                  </button>
                </div>
              </>
            )}

            {modal === 'label' && selected && (
              <>
                <h3 className="font-bold">{tr.changeLabel}</h3>
                <p className="text-[11px] font-mono">{selected.path}</p>
                <input value={labelText} onChange={(e) => setLabelText(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-xs ${isDark ? 'bg-slate-950 border-slate-700' : 'border-slate-200'}`} />
                <input value={labelConfirm} onChange={(e) => setLabelConfirm(e.target.value)} placeholder={tr.confirmPartName} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'border-slate-200'}`} />
                <div className="flex gap-2">
                  <button type="button" onClick={closeModal} className={`flex-1 py-2 rounded-xl text-xs font-bold border ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>{tr.cancel}</button>
                  <button
                    type="button"
                    disabled={actionLoading || labelConfirm !== selected.name || !labelText.trim()}
                    onClick={() => refreshAfter(() => postJson('/api/storage_manager/partitions/label', {
                      device: selected.path,
                      label: labelText.trim(),
                      confirm_token: labelConfirm,
                    }))}
                    className="flex-1 py-2 rounded-xl text-xs font-bold bg-cyan-600 text-white disabled:opacity-50"
                  >
                    {tr.runAction}
                  </button>
                </div>
              </>
            )}

            {modal === 'boot' && selected && (
              <>
                <h3 className="font-bold">{tr.setBoot}</h3>
                <p className="text-[11px] font-mono">{selected.path}</p>
                <input value={bootConfirm} onChange={(e) => setBootConfirm(e.target.value)} placeholder={tr.confirmPartName} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'border-slate-200'}`} />
                <div className="flex gap-2">
                  <button type="button" onClick={closeModal} className={`flex-1 py-2 rounded-xl text-xs font-bold border ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>{tr.cancel}</button>
                  <button
                    type="button"
                    disabled={actionLoading || bootConfirm !== selected.name}
                    onClick={() => refreshAfter(() => postJson('/api/storage_manager/partitions/boot', {
                      device: selected.path,
                      active: true,
                      confirm_token: bootConfirm,
                    }))}
                    className="flex-1 py-2 rounded-xl text-xs font-bold bg-cyan-600 text-white disabled:opacity-50"
                  >
                    {tr.runAction}
                  </button>
                </div>
              </>
            )}

            {modal === 'mount' && selected && (
              <>
                <h3 className="font-bold">{tr.mountVolume}</h3>
                <p className="text-[11px] font-mono">{selected.path}</p>
                <input value={mountPoint} onChange={(e) => setMountPoint(e.target.value)} placeholder={tr.mountpoint} className={`w-full rounded-lg border px-3 py-2 text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-700' : 'border-slate-200'}`} />
                <label className="flex items-center gap-2 text-[11px]">
                  <input type="checkbox" checked={mountPersist} onChange={(e) => setMountPersist(e.target.checked)} />
                  {tr.persistFstab}
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={closeModal} className={`flex-1 py-2 rounded-xl text-xs font-bold border ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>{tr.cancel}</button>
                  <button
                    type="button"
                    disabled={actionLoading || !mountPoint.trim()}
                    onClick={() => refreshAfter(() => postJson('/api/storage_manager/mount', {
                      device: selected.path,
                      mountpoint: mountPoint,
                      fstype: selected.fstype || undefined,
                      options: 'defaults',
                      persist_fstab: mountPersist,
                    }))}
                    className="flex-1 py-2 rounded-xl text-xs font-bold bg-cyan-600 text-white disabled:opacity-50"
                  >
                    {tr.runAction}
                  </button>
                </div>
              </>
            )}

            {modal === 'unmount' && selected?.mountpoint && (
              <>
                <h3 className="font-bold">{tr.unmountVolume}</h3>
                <p className="text-[11px] font-mono">{selected.mountpoint}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={closeModal} className={`flex-1 py-2 rounded-xl text-xs font-bold border ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>{tr.cancel}</button>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => refreshAfter(() => postJson('/api/storage_manager/unmount', {
                      mountpoint: selected.mountpoint,
                      remove_fstab: false,
                    }))}
                    className="flex-1 py-2 rounded-xl text-xs font-bold bg-cyan-600 text-white disabled:opacity-50"
                  >
                    {tr.runAction}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
