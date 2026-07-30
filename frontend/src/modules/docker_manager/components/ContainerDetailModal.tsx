/**
 * Container status detail — metrics, ports, restart policy, and lifecycle actions.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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

type RestartPolicyName = 'no' | 'on-failure' | 'always' | 'unless-stopped';

const RESTART_OPTIONS: RestartPolicyName[] = ['no', 'on-failure', 'always', 'unless-stopped'];

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
  const [policy, setPolicy] = useState<RestartPolicyName>('no');
  const [retryCount, setRetryCount] = useState(0);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyMsg, setPolicyMsg] = useState<{ text: string; ok: boolean } | null>(null);

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
          savePolicy: 'Apply',
          saving: 'Saving…',
          policySaved: 'Restart policy updated.',
          policyFailed: 'Failed to update restart policy.',
          retryCount: 'Max retries',
          policyHint: 'Auto-restart when the container exits unexpectedly.',
          policyNo: 'No (manual only)',
          policyOnFailure: 'On failure',
          policyAlways: 'Always',
          policyUnlessStopped: 'Unless stopped',
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
          savePolicy: 'Áp dụng',
          saving: 'Đang lưu…',
          policySaved: 'Đã cập nhật chính sách restart.',
          policyFailed: 'Không cập nhật được chính sách restart.',
          retryCount: 'Số lần thử lại tối đa',
          policyHint: 'Tự khởi động lại khi container thoát ngoài ý muốn.',
          policyNo: 'Không (chỉ thủ công)',
          policyOnFailure: 'Khi lỗi',
          policyAlways: 'Luôn luôn',
          policyUnlessStopped: 'Trừ khi dừng thủ công',
        },
      })[language],
    [language],
  );

  const policyLabels: Record<RestartPolicyName, string> = {
    no: tr.policyNo,
    'on-failure': tr.policyOnFailure,
    always: tr.policyAlways,
    'unless-stopped': tr.policyUnlessStopped,
  };

  const reloadInspect = useCallback(async () => {
    if (!container) return;
    setInspectLoading(true);
    try {
      const res = await apiFetch(`/api/docker_manager/containers/${encodeURIComponent(container.id)}/inspect`);
      if (!res.ok) return;
      const data = await res.json();
      const payload = (data.data || null) as Record<string, unknown> | null;
      setInspect(payload);
      const hostConfig = (payload?.HostConfig as Record<string, unknown> | undefined) || undefined;
      const rp = (hostConfig?.RestartPolicy as Record<string, unknown> | undefined) || undefined;
      const name = String(rp?.Name || 'no').toLowerCase() as RestartPolicyName;
      setPolicy(RESTART_OPTIONS.includes(name) ? name : 'no');
      setRetryCount(typeof rp?.MaximumRetryCount === 'number' ? rp.MaximumRetryCount : 0);
    } catch {
      setInspect(null);
    } finally {
      setInspectLoading(false);
    }
  }, [container]);

  useEffect(() => {
    setLiveStats(stats);
  }, [stats]);

  useEffect(() => {
    if (!open || !container) {
      setInspect(null);
      setPolicyMsg(null);
      return;
    }
    void reloadInspect();
  }, [open, container?.id, reloadInspect]);

  useEffect(() => {
    if (!open || !container) return;
    const running = container.status.toLowerCase().includes('running');
    if (!running) return;
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

  const handleSavePolicy = async () => {
    if (!container) return;
    setSavingPolicy(true);
    setPolicyMsg(null);
    try {
      const res = await apiFetch('/api/docker_manager/containers/restart-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          container_id: container.id,
          policy,
          maximum_retry_count: policy === 'on-failure' ? retryCount : 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data?.detail;
        throw new Error(typeof detail === 'string' ? detail : detail?.message || tr.policyFailed);
      }
      setPolicyMsg({ text: data.message || tr.policySaved, ok: true });
      await reloadInspect();
    } catch (err) {
      setPolicyMsg({ text: err instanceof Error ? err.message : tr.policyFailed, ok: false });
    } finally {
      setSavingPolicy(false);
    }
  };

  if (!container) return null;

  const isRunning = container.status.toLowerCase().includes('running');
  const state = (inspect?.State as Record<string, unknown> | undefined) || undefined;
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
          <div className={cn('rounded-xl border p-3 space-y-3', isDark ? 'border-slate-800' : 'border-slate-200')}>
            {inspectLoading && !inspect ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                {tr.loading}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <InfoRow label={tr.created} value={fmtTime(created)} isDark={isDark} />
                  <InfoRow label={tr.started} value={fmtTime(startedAt)} isDark={isDark} />
                  <InfoRow label={tr.platform} value={platform || '—'} isDark={isDark} />
                </div>

                <div className="space-y-2">
                  <div>
                    <p className={cn('text-[10px] font-bold uppercase tracking-wider', isDark ? 'text-slate-500' : 'text-slate-400')}>
                      {tr.restartPolicy}
                    </p>
                    <p className={cn('text-[10px] mt-0.5', isDark ? 'text-slate-500' : 'text-slate-400')}>{tr.policyHint}</p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <select
                      value={policy}
                      onChange={(e) => setPolicy(e.target.value as RestartPolicyName)}
                      disabled={savingPolicy || busy}
                      className={cn(
                        'flex-1 rounded-xl border px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50',
                        isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-200 bg-white text-slate-800',
                      )}
                    >
                      {RESTART_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {policyLabels[opt]}
                        </option>
                      ))}
                    </select>
                    {policy === 'on-failure' && (
                      <label className="flex items-center gap-2 shrink-0">
                        <span className={cn('text-[10px] font-bold uppercase', isDark ? 'text-slate-500' : 'text-slate-400')}>{tr.retryCount}</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={retryCount}
                          onChange={(e) => setRetryCount(Math.max(0, Number(e.target.value) || 0))}
                          disabled={savingPolicy || busy}
                          className={cn(
                            'w-16 rounded-xl border px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50',
                            isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-200 bg-white text-slate-800',
                          )}
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleSavePolicy()}
                      disabled={savingPolicy || busy}
                      className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 transition"
                    >
                      {savingPolicy ? <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icons.Save className="w-3.5 h-3.5" />}
                      {savingPolicy ? tr.saving : tr.savePolicy}
                    </button>
                  </div>
                  {policyMsg && (
                    <p className={cn('text-[11px] flex items-center gap-1.5', policyMsg.ok ? 'text-emerald-500' : 'text-red-400')}>
                      {policyMsg.ok ? <Icons.CheckCircle2 className="w-3.5 h-3.5" /> : <Icons.AlertCircle className="w-3.5 h-3.5" />}
                      {policyMsg.text}
                    </p>
                  )}
                </div>
              </>
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
