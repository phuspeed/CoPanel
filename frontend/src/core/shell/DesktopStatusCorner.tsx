/**
 * Compact system status widget — top-right on desktop wallpaper.
 */
import { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../lib/utils';
import { api } from '../platform';
import { openModuleWindow } from './openModuleWindow';

type Lang = 'en' | 'vi';

const I18N = {
  en: {
    cpu: 'CPU',
    ram: 'RAM',
    disk: 'Disk',
    openMonitor: 'Open System Monitor',
    loadError: 'Monitor unavailable',
  },
  vi: {
    cpu: 'CPU',
    ram: 'RAM',
    disk: 'Ổ đĩa',
    openMonitor: 'Mở Giám sát hệ thống',
    loadError: 'Không lấy được dữ liệu',
  },
} as const;

interface StatsPayload {
  cpu?: { percent?: number; error?: string };
  memory?: { percent?: number; error?: string };
  disk?: {
    partitions?: DiskPart[];
    error?: string;
  };
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

function barTone(pct: number) {
  if (pct > 85) return 'bg-red-500';
  if (pct > 65) return 'bg-amber-500';
  return 'bg-emerald-500';
}

interface DiskPart {
  mountpoint: string;
  total: number;
  percent: number;
  fstype?: string;
}

function pickDisk(parts: DiskPart[] | undefined) {
  if (!parts?.length) return null;
  const root = parts.find((p) => p.mountpoint === '/');
  if (root) return root;
  const skip = /^(tmpfs|devtmpfs|proc|sysfs|cgroup2?)$/i;
  const pool = parts.filter((p) => p.total > 0 && !skip.test(p.fstype || ''));
  return (pool.length ? pool : parts).reduce((a, b) => (b.total > a.total ? b : a));
}

interface Props {
  isDark: boolean;
  language: Lang;
}

export default function DesktopStatusCorner({ isDark, language }: Props) {
  const tr = I18N[language === 'vi' ? 'vi' : 'en'];
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const data = await api<StatsPayload>('/api/system_monitor/stats');
        if (active) {
          setStats(data || {});
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const cpu = clamp(stats?.cpu?.error ? 0 : stats?.cpu?.percent ?? 0);
  const ram = clamp(stats?.memory?.error ? 0 : stats?.memory?.percent ?? 0);
  const diskPart = pickDisk(stats?.disk?.partitions);
  const disk = diskPart ? clamp(diskPart.percent) : 0;
  const peak = Math.max(cpu, ram, disk);

  const MiniBar = ({ label, pct }: { label: string; pct: number }) => (
    <div className="flex items-center gap-2">
      <span className={cn('w-7 text-[9px] font-bold uppercase', isDark ? 'text-slate-400' : 'text-slate-500')}>
        {label}
      </span>
      <div className={cn('h-1.5 flex-1 overflow-hidden rounded-full', isDark ? 'bg-slate-700/80' : 'bg-slate-200')}>
        <div className={cn('h-full transition-all duration-500', barTone(pct))} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('w-8 text-right text-[10px] font-bold tabular-nums', isDark ? 'text-slate-200' : 'text-slate-700')}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );

  return (
    <div
      className="absolute right-3 top-3 z-20 md:right-4 md:top-4"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <button
        type="button"
        onClick={() => openModuleWindow('/system-monitor')}
        title={tr.openMonitor}
        className={cn(
          'flex items-center gap-2 rounded-2xl border px-3 py-2 backdrop-blur-md transition-all',
          isDark
            ? 'border-white/10 bg-slate-900/70 text-slate-200 hover:bg-slate-900/90'
            : 'border-slate-200/80 bg-white/75 text-slate-800 hover:bg-white/90 shadow-sm',
          expanded && 'rounded-2xl',
        )}
      >
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            peak > 85 ? 'bg-red-500' : peak > 65 ? 'bg-amber-500' : 'bg-emerald-500',
          )}
        />
        <span className="text-[10px] font-bold tabular-nums">
          {error ? '—' : `${cpu.toFixed(0)}% · ${ram.toFixed(0)}%`}
        </span>
        <Icons.ChevronDown
          className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180', isDark ? 'text-slate-500' : 'text-slate-400')}
        />
      </button>

      {expanded && (
        <div
          className={cn(
            'mt-2 w-52 space-y-2 rounded-2xl border p-3 backdrop-blur-xl',
            isDark ? 'border-white/10 bg-slate-900/90' : 'border-slate-200 bg-white/95 shadow-lg',
          )}
        >
          {error ? (
            <p className="text-[10px] text-red-400">{tr.loadError}</p>
          ) : (
            <>
              <MiniBar label={tr.cpu} pct={cpu} />
              <MiniBar label={tr.ram} pct={ram} />
              <MiniBar label={tr.disk} pct={disk} />
            </>
          )}
          <button
            type="button"
            onClick={() => openModuleWindow('/system-monitor')}
            className={cn(
              'flex w-full items-center justify-center gap-1.5 rounded-xl py-1.5 text-[10px] font-bold',
              isDark ? 'bg-blue-600/30 text-blue-300 hover:bg-blue-600/40' : 'bg-blue-50 text-blue-700 hover:bg-blue-100',
            )}
          >
            <Icons.Activity className="h-3 w-3" />
            {tr.openMonitor}
          </button>
        </div>
      )}
    </div>
  );
}
