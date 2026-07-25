/**
 * Container status detail — metrics, ports, and lifecycle actions.
 */
import { useEffect, useMemo, useState } from 'react';
import WindowModal from '../../../core/shell/WindowModal';
import { apiFetch } from '../../../core/authHeaders';
import { cn } from '../../../lib/utils';
import * as Icons from 'lucide-react';
import OperationStatusBanner from './OperationStatusBanner';

export interface DetailContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  project?: string;
}

export interface DetailStats {
  id: string;
  name: string;
  cpu: string;
  mem_usage: string;
  mem_percent: string;
  net_io: string;
  block_io?: string;
  pids?: string;
}

interface Props {
  open: boolean;
  container: DetailContainer | null;
  stats?: DetailStats;
  busy: boolean;
  isDark: boolean;
  language: 'en' | 'vi';
  onClose: () => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onRemove: (id: string) => void;
  onLogs: (item: DetailContainer) => void;
}

export default function ContainerDetailModal({
  open,
  container,
  stats,
  busy,
  isDark,
  language,
  onClose,
  onStart,
  onStop,
  onRestart,
  onRemove,
  onLogs,
}: Props) {
  const [inspect, setInspect] = useState<Record<string, unknown> | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [liveStats, setLiveStats] = useState<DetailStats | undefined>(stats);

  const tr = useMemo(
    () =>
      ({
        en: {
          title: 'Container status',
          status: 'Status',
          project: 'Project',
          image: 'Image',
          id: 'ID',
          ports: 'Ports',
          cpu: 'CPU',
          mem: 'Memory',
          net: 'Network I/O',
          block: 'Block I/O',
          pids: 'PIDs',
          created: 'Created',
          started: 'Started',
          restartPolicy: 'Restart policy',
          platform: 'Platform',
          noStats: 'Stats unavailable (container not running)',
          start: 'Start',
          stop: 'Stop',
          restart: 'Restart',
          logs: 'Logs',
          remove: 'Remove',
          close: 'Close',
          loading: 'Loading details…',
        },
        vi: {
          title: 'Trạng thái container',
          status: 'Trạng thái',
          project: 'Project',
          image: 'Image',
          id: 'ID',
          ports: 'Cổng',
          cpu: 'CPU',
          mem: 'RAM',
          net: 'Network I/O',
          block: 'Block I/O',
          pids: 'PIDs',
          created: 'Tạo lúc',
          started: 'Khởi động',
          restartPolicy: 'Chính sách restart',
          platform: 'Nền tảng',
          noStats: 'Không có thống kê (container không chạy)',
          start: 'Khởi động',
          stop: 'Dừng',
          restart: 'Khởi động lại',
          logs: 'Logs',
          remove: 'Xóa',
          close: 'Đóng',
          loading: 'Đang tải chi tiết…',
        },
      })[language],
    [language],
  );

  useEffect(() => {
    setLiveStats(stats);
  }, [stats]);

  useEffect(() => {
    if (!open || !container) {
      setInspect(null);
      return;
    }
    let cancelled = false;
    setInspectLoading(true);
    apiFetch(`/api/docker_manager/containers/${encodeURIComponent(container.id)}/inspect`)
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        return data.data || null;
      })
      .then((data) => {
        if (!cancelled) setInspect(data);
      })
      .catch(() => {
        if (!cancelled) setInspect(null);
      })
      .finally(() => {
        if (!cancelled) setInspectLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, container?.id]);

  // Refresh single-container stats while detail is open.
  useEffect(() => {
    if (!open || !container) return;
    const isRunning = container.status.toLowerCase().includes('running');
    if (!isRunning) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await apiFetch(`/api/docker_manager/containers/${encodeURIComponent(container.id)}/stats`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.data && !cancelled) setLiveStats(data.data as DetailStats);
      } catch {
        // ignore
      }
    };
    tick();
    const timer = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, container?.id, container?.status]);

  if (!container) return null;

  const isRunning = container.status.toLowerCase().includes('running');
  const state = (inspect?.State as Record<string, unknown> | undefined) || undefined;
  const hostConfig = (inspect?.HostConfig as Record<string, unknown> | undefined) || undefined;
  const restartPolicy = (hostConfig?.RestartPolicy as Record<string, unknown> | undefined) || undefined;
  const created = typeof inspect?.Created === 'string' ? inspect.Created : undefined;
  const startedAt = typeof state?.StartedAt === 'string' ? state.StartedAt : undefined;
  const platform = typeof inspect?.Platform === 'string' ? inspect.Platform : undefined;

  const metric = (label: string, value: string, icon: typeof Icons.Cpu) => {
    const Icon = icon;
    return (
      <div
        className={cn(
          'rounded-xl border p-3 space-y-1',
          isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50',
        )}
      >
        <div className={cn('flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider', isDark ? 'text-slate-500' : 'text-slate-400')}>
          <Icon className="w-3 h-3" />
          {label}
        </div>
        <p className={cn('text-sm font-mono font-semibold break-all', isDark ? 'text-slate-100' : 'text-slate-800')}>{value}</p>
      </div>
    );
  };

  const fmtTime = (iso?: string) => {
    if (!iso || iso.startsWith('0001')) return '—';
    try {
      return new Date(iso).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US');
    } catch {
      return iso;
    }
  };

  return (
    <WindowModal
      open={open}
      onClose={onClose}
      title={`${tr.title}: ${container.name}`}
      maxWidth="2xl"
      className="max-w-2xl"
      closeOnBackdropClick={false}
    >
      <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
        <OperationStatusBanner isDark={isDark} language={language} containerIdFilter={container.id} />

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'px-2.5 py-1 text-xs font-semibold rounded-full border',
              isRunning
                ? 'bg-green-500/10 border-green-500/20 text-green-500'
                : isDark
                  ? 'bg-slate-800/60 border-slate-700 text-slate-400'
                  : 'bg-slate-100 border-slate-200 text-slate-600',
            )}
          >
            {container.status}
          </span>
          {busy && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-500">
              <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
              {language === 'vi' ? 'Đang xử lý' : 'Busy'}
            </span>
          )}
          {container.project && (
            <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-lg border', isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600')}>
              {tr.project}: {container.project}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <InfoRow label={tr.id} value={container.id} mono isDark={isDark} />
          <InfoRow label={tr.image} value={container.image} mono isDark={isDark} />
          <InfoRow label={tr.ports} value={container.ports || '—'} mono isDark={isDark} className="sm:col-span-2" />
        </div>

        {isRunning ? (
          <div className="grid grid-cols-2 gap-2">
            {metric(tr.cpu, liveStats?.cpu || '…', Icons.Cpu)}
            {metric(tr.mem, liveStats ? `${liveStats.mem_percent} · ${liveStats.mem_usage}` : '…', Icons.Database)}
            {metric(tr.net, liveStats?.net_io || '…', Icons.Activity)}
            {metric(
              tr.block,
              liveStats?.block_io || (liveStats?.pids ? `PIDs ${liveStats.pids}` : '…'),
              Icons.HardDrive,
            )}
          </div>
        ) : (
          <p className={cn('text-xs rounded-xl border px-3 py-2', isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500')}>
            {tr.noStats}
          </p>
        )}

        {(inspectLoading || inspect) && (
          <div className={cn('rounded-xl border p-3 space-y-2', isDark ? 'border-slate-800' : 'border-slate-200')}>
            {inspectLoading && !inspect ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                {tr.loading}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <InfoRow label={tr.created} value={fmtTime(created)} isDark={isDark} />
                <InfoRow label={tr.started} value={fmtTime(startedAt)} isDark={isDark} />
                <InfoRow
                  label={tr.restartPolicy}
                  value={String(restartPolicy?.Name || '—')}
                  isDark={isDark}
                />
                <InfoRow label={tr.platform} value={platform || '—'} isDark={isDark} />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-800">
          {isRunning ? (
            <ActionButton isDark={isDark} color="amber" disabled={busy} onClick={() => onStop(container.id)} icon={Icons.Square} label={tr.stop} />
          ) : (
            <ActionButton isDark={isDark} color="green" disabled={busy} onClick={() => onStart(container.id)} icon={Icons.Play} label={tr.start} />
          )}
          <ActionButton isDark={isDark} color="blue" disabled={busy} onClick={() => onRestart(container.id)} icon={Icons.RefreshCcw} label={tr.restart} />
          <ActionButton isDark={isDark} onClick={() => onLogs(container)} icon={Icons.FileText} label={tr.logs} />
          <ActionButton isDark={isDark} color="red" disabled={busy} onClick={() => onRemove(container.id)} icon={Icons.Trash2} label={tr.remove} />
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'ml-auto px-3 py-1.5 rounded-xl text-xs font-bold border',
              isDark ? 'border-slate-700 bg-slate-800 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600',
            )}
          >
            {tr.close}
          </button>
        </div>
      </div>
    </WindowModal>
  );
}

function InfoRow({
  label,
  value,
  mono,
  isDark,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  isDark: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className={cn('text-[10px] font-bold uppercase tracking-wider mb-0.5', isDark ? 'text-slate-500' : 'text-slate-400')}>{label}</p>
      <p className={cn('text-xs break-all', mono && 'font-mono', isDark ? 'text-slate-200' : 'text-slate-800')}>{value}</p>
    </div>
  );
}

function ActionButton({
  isDark,
  label,
  onClick,
  icon: Icon,
  color,
  disabled,
}: {
  isDark: boolean;
  label: string;
  onClick: () => void;
  icon: typeof Icons.Play;
  color?: 'green' | 'blue' | 'amber' | 'red';
  disabled?: boolean;
}) {
  const colorCls =
    color === 'green'
      ? 'text-green-500'
      : color === 'blue'
        ? 'text-blue-500'
        : color === 'amber'
          ? 'text-amber-500'
          : color === 'red'
            ? 'text-red-500'
            : isDark
              ? 'text-slate-300'
              : 'text-slate-600';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition disabled:opacity-40',
        isDark ? 'bg-slate-800 border-slate-700 hover:bg-slate-700' : 'bg-white border-slate-200 hover:bg-slate-50',
        colorCls,
      )}
    >
      {disabled ? <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}
