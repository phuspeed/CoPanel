/**
 * Live system metrics widget (CPU/Memory/Disk) backed by ``system_monitor``.
 */
import { useEffect, useState } from 'react';
import { api, PlatformError } from '../platform';
import Widget from './Widget';

interface Stats {
  cpu_percent: number;
  memory: { percent: number; used: number; total: number };
  disk: Array<{ mount: string; percent: number }> | { percent: number };
}

function bar(percent: number, hint?: string) {
  const pct = Math.max(0, Math.min(100, percent));
  let tint = 'bg-emerald-500';
  if (pct > 80) tint = 'bg-red-500';
  else if (pct > 60) tint = 'bg-amber-500';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{hint || ''}</span>
        <span className="font-mono">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div className={`h-full ${tint} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function SystemHealthWidget() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const data = await api<Stats>('/api/system_monitor/stats', { raw: true });
        if (!active) return;
        const normalized: Stats = {
          cpu_percent: (data as any).cpu_percent ?? (data as any).cpu?.percent ?? 0,
          memory: (data as any).memory ?? { percent: 0, used: 0, total: 0 },
          disk: (data as any).disk ?? { percent: 0 },
        };
        setStats(normalized);
        setError(null);
      } catch (err) {
        if (active) setError(err instanceof PlatformError ? err.message : 'Cannot reach system_monitor');
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  let status: 'ok' | 'warn' | 'error' = 'ok';
  if (stats) {
    const m = Math.max(stats.cpu_percent, stats.memory.percent);
    if (m > 85) status = 'error';
    else if (m > 65) status = 'warn';
  }

  const diskPct = (() => {
    if (!stats) return 0;
    if (Array.isArray(stats.disk)) {
      const root = stats.disk.find((d) => d.mount === '/') || stats.disk[0];
      return root?.percent ?? 0;
    }
    return (stats.disk as any).percent ?? 0;
  })();

  return (
    <Widget title="System Health" icon="Cpu" status={status} loading={!stats && !error}>
      {error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : stats ? (
        <div className="space-y-3">
          {bar(stats.cpu_percent, 'CPU')}
          {bar(stats.memory.percent, 'Memory')}
          {bar(diskPct, 'Disk')}
        </div>
      ) : null}
    </Widget>
  );
}
