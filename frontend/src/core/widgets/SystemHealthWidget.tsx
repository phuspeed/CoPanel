/**
 * Live system metrics (CPU / RAM / disk) from ``system_monitor`` /stats.
 * Uses the standard API envelope (unwrap via ``api()`` — not ``raw``).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { api, PlatformError } from '../platform';
import { moduleRegistry } from '../registry';
import Widget from './Widget';

const STORAGE_MANAGER_PATH = '/storage-manager';
const hasStorageManager = () => Boolean(moduleRegistry.getByPath(STORAGE_MANAGER_PATH));

type Lang = 'en' | 'vi';

const I18N = {
  en: {
    title: 'System Health',
    details: 'Details',
    cpu: 'CPU',
    memory: 'Memory',
    disk: 'Disk',
    cores: 'cores',
    core: 'core',
    usedOf: '{used} / {total}',
    available: '{n} available',
    swapLine: 'Swap: {used} / {total} ({pct}%)',
    mount: 'Mount',
    noDisk: 'No disk data',
    loadError: 'Cannot reach system monitor',
    storageAlerts: '{n} storage alert(s)',
    storageCritical: 'Storage critical',
    storageWarn: 'Storage warning',
  },
  vi: {
    title: 'Sức khỏe hệ thống',
    details: 'Chi tiết',
    cpu: 'CPU',
    memory: 'RAM',
    disk: 'Ổ đĩa',
    cores: 'nhân',
    core: 'nhân',
    usedOf: '{used} / {total}',
    available: '{n} còn trống',
    swapLine: 'Swap: {used} / {total} ({pct}%)',
    mount: 'Gắn tại',
    noDisk: 'Không có dữ liệu ổ đĩa',
    loadError: 'Không lấy được dữ liệu giám sát',
    storageAlerts: '{n} cảnh báo lưu trữ',
    storageCritical: 'Lưu trữ nguy hiểm',
    storageWarn: 'Lưu trữ cảnh báo',
  },
} as const;

interface StorageAlertsPayload {
  health?: 'healthy' | 'warning' | 'critical';
  alert_count?: number;
  alerts?: Array<{ level: string; message: string }>;
}

interface StatsPayload {
  cpu?: { percent?: number; count?: number; error?: string; frequency?: { current: number; min: number; max: number } | null };
  memory?: {
    total?: number;
    used?: number;
    free?: number;
    percent?: number;
    available?: number;
    error?: string;
    swap?: { total: number; used: number; free: number; percent: number };
  };
  disk?: {
    partitions?: Array<{
      device: string;
      mountpoint: string;
      fstype: string;
      total: number;
      used: number;
      free: number;
      percent: number;
    }>;
    error?: string;
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatCpuFreq(mhz: number): string {
  if (!Number.isFinite(mhz) || mhz <= 0) return '';
  if (mhz >= 1000) return `${(mhz / 1000).toFixed(2)} GHz`;
  return `${mhz.toFixed(0)} MHz`;
}

function pickPrimaryPartition(
  parts: NonNullable<StatsPayload['disk']>['partitions'] | undefined,
) {
  if (!parts?.length) return null;
  const root = parts.find((p) => p.mountpoint === '/');
  if (root) return root;
  const skipFs = /^(tmpfs|devtmpfs|proc|sysfs|cgroup2?|rpc_pipefs)$/i;
  const candidates = parts.filter((p) => p.total > 0 && !skipFs.test(p.fstype || ''));
  const pool = candidates.length ? candidates : parts;
  return pool.reduce((best, p) => (p.total > best.total ? p : best), pool[0]);
}

function clampPct(n: number) {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

function barColor(pct: number) {
  if (pct > 85) return 'bg-red-500';
  if (pct > 65) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function interpolate(template: string, vars: Record<string, string | number>) {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), template);
}

export default function SystemHealthWidget() {
  const navigate = useNavigate();
  const outlet = useOutletContext<{ language?: Lang } | null>();
  const language: Lang = outlet?.language === 'vi' ? 'vi' : 'en';
  const tr = I18N[language];

  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [storageAlerts, setStorageAlerts] = useState<StorageAlertsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const data = await api<StatsPayload>('/api/system_monitor/stats');
        if (!active) return;
        setStats(data || {});
        setError(null);
      } catch (err) {
        if (active) setError(err instanceof PlatformError ? err.message : tr.loadError);
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [language]);

  useEffect(() => {
    if (!hasStorageManager()) {
      setStorageAlerts(null);
      return;
    }
    let active = true;
    const tick = async () => {
      if (!hasStorageManager()) {
        if (active) setStorageAlerts(null);
        return;
      }
      try {
        const data = await api<StorageAlertsPayload>('/api/storage_manager/alerts');
        if (active) setStorageAlerts(data || null);
      } catch {
        if (active) setStorageAlerts(null);
      }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [language]);

  const cpu = stats?.cpu;
  const mem = stats?.memory;
  const diskParts = stats?.disk?.partitions;
  const primaryDisk = pickPrimaryPartition(diskParts);

  const cpuPct = clampPct(cpu?.error ? 0 : cpu?.percent ?? 0);
  const memPct = clampPct(mem?.error ? 0 : mem?.percent ?? 0);
  const diskPct = primaryDisk ? clampPct(primaryDisk.percent) : 0;

  let status: 'ok' | 'warn' | 'error' = 'ok';
  if (stats) {
    const peak = Math.max(cpuPct, memPct, diskPct);
    if (peak > 85) status = 'error';
    else if (peak > 65) status = 'warn';
  }
  if (storageAlerts?.health === 'critical') status = 'error';
  else if (storageAlerts?.health === 'warning' && status === 'ok') status = 'warn';

  const storageFootnote = (() => {
    const count = storageAlerts?.alert_count ?? 0;
    if (!count) return null;
    if (storageAlerts?.health === 'critical') return tr.storageCritical;
    if (storageAlerts?.health === 'warning') return tr.storageWarn;
    return interpolate(tr.storageAlerts, { n: count });
  })();

  const cpuCount = cpu?.count;
  const cpuSubtitle = (() => {
    if (cpu?.error) return null;
    const parts: string[] = [];
    if (cpuCount != null && cpuCount > 0) {
      parts.push(`${cpuCount} ${cpuCount === 1 ? tr.core : tr.cores}`);
    }
    const cur = cpu?.frequency?.current;
    if (cur != null && cur > 0) {
      parts.push(formatCpuFreq(cur));
    }
    return parts.length ? parts.join(' · ') : null;
  })();

  const memSubtitle = (() => {
    if (mem?.error || mem?.total == null) return null;
    const lines: string[] = [];
    const used = mem.used ?? 0;
    const total = mem.total;
    lines.push(interpolate(tr.usedOf, { used: formatBytes(used), total: formatBytes(total) }));
    if (mem.available != null && mem.available > 0) {
      lines.push(interpolate(tr.available, { n: formatBytes(mem.available) }));
    }
    const sw = mem.swap;
    if (sw && sw.total > 0) {
      lines.push(
        interpolate(tr.swapLine, {
          used: formatBytes(sw.used),
          total: formatBytes(sw.total),
          pct: clampPct(sw.percent).toFixed(0),
        }),
      );
    }
    return lines.join(' · ');
  })();

  const diskSubtitle = (() => {
    if (!primaryDisk) return tr.noDisk;
    return [
      interpolate(tr.usedOf, {
        used: formatBytes(primaryDisk.used),
        total: formatBytes(primaryDisk.total),
      }),
      `${tr.mount}: ${primaryDisk.mountpoint}`,
    ].join(' · ');
  })();

  const MetricRow = ({
    icon: Icon,
    label,
    percent,
    subtitle,
    errorHint,
  }: {
    icon: typeof Icons.Cpu;
    label: string;
    percent: number;
    subtitle: string | null;
    errorHint?: string | null;
  }) => (
    <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-950/40 px-3 py-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-300 shrink-0">
            <Icon className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
            {subtitle && !errorHint && (
              <p className="text-[10px] text-slate-500 dark:text-slate-500 truncate" title={subtitle}>
                {subtitle}
              </p>
            )}
            {errorHint && <p className="text-[10px] text-red-500">{errorHint}</p>}
          </div>
        </div>
        <p className="text-lg font-extrabold tabular-nums text-slate-800 dark:text-slate-100 shrink-0">
          {errorHint ? '—' : `${percent.toFixed(1)}%`}
        </p>
      </div>
      <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ease-out ${errorHint ? 'bg-slate-400' : barColor(percent)}`}
          style={{ width: `${errorHint ? 0 : percent}%` }}
        />
      </div>
    </div>
  );

  return (
    <Widget
      title={tr.title}
      icon="Cpu"
      status={status}
      loading={!stats && !error}
      action={{
        label: tr.details,
        onClick: () => navigate(
          storageAlerts?.alert_count && hasStorageManager() ? STORAGE_MANAGER_PATH : '/system-monitor',
        ),
      }}
    >
      {error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : stats ? (
        <div className="space-y-2.5">
          <MetricRow
            icon={Icons.Cpu}
            label={tr.cpu}
            percent={cpuPct}
            subtitle={cpuSubtitle}
            errorHint={cpu?.error ?? null}
          />
          <MetricRow
            icon={Icons.MemoryStick}
            label={tr.memory}
            percent={memPct}
            subtitle={memSubtitle}
            errorHint={mem?.error ?? null}
          />
          <MetricRow
            icon={Icons.HardDrive}
            label={tr.disk}
            percent={diskPct}
            subtitle={diskSubtitle}
            errorHint={stats.disk?.error ?? (!primaryDisk ? tr.noDisk : null)}
          />
          {storageFootnote && (
            <button
              type="button"
              onClick={() => navigate(STORAGE_MANAGER_PATH)}
              className="w-full text-left text-[10px] font-semibold px-2 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300 hover:bg-amber-500/20 transition"
            >
              {storageFootnote}
            </button>
          )}
        </div>
      ) : null}
    </Widget>
  );
}
