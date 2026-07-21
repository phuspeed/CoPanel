/**
 * Cron Manager — Desktop sidebar shell + Classic full-page (dual UI).
 */
import { useEffect, useState } from 'react';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import * as Icons from 'lucide-react';
import { api } from '../../core/platform';
import ModuleViewport from '../../core/shell/ModuleViewport';
import ModuleSidebarLayout from '../../core/shell/ModuleSidebarLayout';
import WindowModal from '../../core/shell/WindowModal';

interface Job {
  id?: string;
  minute: string;
  hour: string;
  day: string;
  month: string;
  weekday: string;
  command: string;
  managed: boolean;
  is_active?: boolean;
}

const EMPTY: Job = {
  minute: '*',
  hour: '*',
  day: '*',
  month: '*',
  weekday: '*',
  command: '',
  managed: true,
};

type Tab = 'create' | 'jobs';
type ScheduleMode = 'every_x_minutes' | 'hourly' | 'daily' | 'weekly' | 'weekdays' | 'weekends' | 'monthly' | 'custom';

interface BuilderState {
  mode: ScheduleMode;
  intervalMinutes: number;
  minute: number;
  hour: number;
  weekday: number;
  dayOfMonth: number;
}

const DEFAULT_BUILDER: BuilderState = {
  mode: 'daily',
  intervalMinutes: 5,
  minute: 0,
  hour: 2,
  weekday: 1,
  dayOfMonth: 1,
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const COPY = {
  en: {
    category: 'Automation',
    title: 'Cron Manager',
    subtitle: 'Schedule recurring tasks. Entries created here are tagged — we never touch crontab lines you authored manually.',
    tabCreate: 'Create Job',
    tabJobs: 'Jobs',
    cronNotReady: 'System cron is not ready',
    cronDaemonStopped: 'Cron daemon is not running',
    cronHint:
      'Cron Manager is a UI only — jobs run via the OS cron daemon, not CoPanel. Crontab lines alone are not enough; enable systemctl enable --now cron.',
    installCron: 'Install cron & sync',
    removeConfirm: 'Remove this cron job?',
    cancel: 'Cancel',
    remove: 'Remove',
    pause: 'Pause',
    start: 'Start',
    manual: 'manual',
    noJobs: 'No cron jobs.',
    commandRequired: 'command (required)',
    add: 'Add',
    schedulePreview: 'Schedule preview',
    nextRun: 'Next run',
    unavailable: 'Unavailable for this pattern',
    loadFailed: 'Failed to load cron jobs',
    installFailed: 'Install cron failed',
    addFailed: 'Failed to add cron job',
    removeFailed: 'Failed to remove cron job',
    stateFailed: 'Failed to update cron job state',
    storePath: 'Managed jobs store: /opt/copanel/config/cron_manager.db',
    modes: {
      every_x_minutes: 'Every X min',
      hourly: 'Hourly',
      daily: 'Daily',
      weekly: 'Weekly',
      weekdays: 'Weekdays',
      weekends: 'Weekends',
      monthly: 'Monthly',
      custom: 'Custom cron',
    },
  },
  vi: {
    category: 'Tự động hóa',
    title: 'Quản lý Cron',
    subtitle: 'Lên lịch tác vụ định kỳ. Job tạo tại đây được gắn tag — không đụng dòng crontab bạn tự viết.',
    tabCreate: 'Tạo Job',
    tabJobs: 'Danh sách',
    cronNotReady: 'Cron hệ thống chưa sẵn sàng',
    cronDaemonStopped: 'Daemon cron chưa chạy',
    cronHint:
      'Cron Manager chỉ là giao diện — job chạy qua daemon cron của OS. Cần systemctl enable --now cron.',
    installCron: 'Cài cron & sync',
    removeConfirm: 'Xóa cron job này?',
    cancel: 'Hủy',
    remove: 'Xóa',
    pause: 'Tạm dừng',
    start: 'Bật',
    manual: 'thủ công',
    noJobs: 'Chưa có cron job.',
    commandRequired: 'lệnh (bắt buộc)',
    add: 'Thêm',
    schedulePreview: 'Xem trước lịch',
    nextRun: 'Chạy tiếp',
    unavailable: 'Không tính được với mẫu này',
    loadFailed: 'Không tải được cron jobs',
    installFailed: 'Cài cron thất bại',
    addFailed: 'Thêm cron job thất bại',
    removeFailed: 'Xóa cron job thất bại',
    stateFailed: 'Cập nhật trạng thái thất bại',
    storePath: 'Lưu job: /opt/copanel/config/cron_manager.db',
    modes: {
      every_x_minutes: 'Mỗi X phút',
      hourly: 'Hàng giờ',
      daily: 'Hàng ngày',
      weekly: 'Hàng tuần',
      weekdays: 'Ngày thường',
      weekends: 'Cuối tuần',
      monthly: 'Hàng tháng',
      custom: 'Cron tùy chỉnh',
    },
  },
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function buildScheduleFromBuilder(builder: BuilderState): Pick<Job, 'minute' | 'hour' | 'day' | 'month' | 'weekday'> {
  const minute = String(clamp(builder.minute, 0, 59));
  const hour = String(clamp(builder.hour, 0, 23));
  switch (builder.mode) {
    case 'every_x_minutes': {
      const interval = clamp(builder.intervalMinutes, 1, 59);
      return { minute: `*/${interval}`, hour: '*', day: '*', month: '*', weekday: '*' };
    }
    case 'hourly':
      return { minute, hour: '*', day: '*', month: '*', weekday: '*' };
    case 'daily':
      return { minute, hour, day: '*', month: '*', weekday: '*' };
    case 'weekly':
      return { minute, hour, day: '*', month: '*', weekday: String(clamp(builder.weekday, 0, 6)) };
    case 'monthly':
      return { minute, hour, day: String(clamp(builder.dayOfMonth, 1, 31)), month: '*', weekday: '*' };
    case 'weekdays':
      return { minute, hour, day: '*', month: '*', weekday: '1-5' };
    case 'weekends':
      return { minute, hour, day: '*', month: '*', weekday: '0,6' };
    case 'custom':
    default:
      return { minute: '*', hour: '*', day: '*', month: '*', weekday: '*' };
  }
}

function parseSimpleCronPart(value: string, min: number, max: number): Set<number> | null {
  const raw = (value || '').trim();
  if (!raw || raw === '*') return null;
  const out = new Set<number>();
  const segments = raw.split(',');
  for (const seg0 of segments) {
    const seg = seg0.trim();
    if (!seg) continue;
    if (seg.includes('/')) {
      const [base, stepStr] = seg.split('/');
      const step = Number(stepStr);
      if (!Number.isFinite(step) || step <= 0) return null;
      let start = min;
      let end = max;
      if (base && base !== '*') {
        if (base.includes('-')) {
          const [a, b] = base.split('-').map(Number);
          if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
          start = clamp(a, min, max);
          end = clamp(b, min, max);
        } else {
          const n = Number(base);
          if (!Number.isFinite(n)) return null;
          start = clamp(n, min, max);
        }
      }
      for (let i = start; i <= end; i += step) out.add(i);
      continue;
    }
    if (seg.includes('-')) {
      const [a, b] = seg.split('-').map(Number);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      for (let i = clamp(a, min, max); i <= clamp(b, min, max); i++) out.add(i);
      continue;
    }
    const n = Number(seg);
    if (!Number.isFinite(n)) return null;
    out.add(clamp(n, min, max));
  }
  return out.size ? out : null;
}

function getNextRunTime(job: Pick<Job, 'minute' | 'hour' | 'day' | 'month' | 'weekday'>): Date | null {
  const minutes = parseSimpleCronPart(job.minute, 0, 59);
  const hours = parseSimpleCronPart(job.hour, 0, 23);
  const days = parseSimpleCronPart(job.day, 1, 31);
  const months = parseSimpleCronPart(job.month, 1, 12);
  const weekdays = parseSimpleCronPart(job.weekday, 0, 6);
  const now = new Date();
  const probe = new Date(now.getTime());
  probe.setSeconds(0, 0);
  probe.setMinutes(probe.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 400; i++) {
    const m = probe.getMinutes();
    const h = probe.getHours();
    const d = probe.getDate();
    const mo = probe.getMonth() + 1;
    const w = probe.getDay();
    const ok =
      (!minutes || minutes.has(m)) &&
      (!hours || hours.has(h)) &&
      (!days || days.has(d)) &&
      (!months || months.has(mo)) &&
      (!weekdays || weekdays.has(w));
    if (ok) return new Date(probe.getTime());
    probe.setMinutes(probe.getMinutes() + 1);
  }
  return null;
}

export default function CronManager() {
  const { theme, language } = useAppShellContext();
  const isDark = theme === 'dark';
  const t = COPY[language === 'vi' ? 'vi' : 'en'];

  const [tab, setTab] = useState<Tab>('create');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [draft, setDraft] = useState<Job>({ ...EMPTY });
  const [builder, setBuilder] = useState<BuilderState>({ ...DEFAULT_BUILDER });
  const [error, setError] = useState<string | null>(null);
  const [system, setSystem] = useState<{
    crontab_available?: boolean;
    cron_service_active?: boolean;
    install_hint?: string;
    cron_daemon?: { service?: string | null; active?: boolean };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const panel = isDark ? 'bg-slate-900/60 border-slate-700' : 'bg-white border-slate-200';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const inputCls = isDark
    ? 'bg-slate-950/40 border-slate-700 text-slate-100'
    : 'bg-white border-slate-200 text-slate-900';
  const btnSecondary = isDark
    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200';

  const loadSystem = async () => {
    try {
      const st = await api<{
        crontab_available: boolean;
        cron_service_active?: boolean;
        install_hint?: string;
        cron_daemon?: { service?: string | null; active?: boolean };
      }>('/api/cron_manager/system');
      setSystem(st);
    } catch {
      setSystem(null);
    }
  };

  const refresh = async () => {
    try {
      const list = await api<Job[]>('/api/cron_manager/jobs');
      setJobs(list || []);
      setError(null);
      await loadSystem();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.loadFailed);
    }
  };

  const installCron = async () => {
    setBusy(true);
    try {
      await api('/api/cron_manager/system/ensure-cron', { method: 'POST' });
      await refresh();
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.installFailed);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (builder.mode === 'custom') return;
    const schedule = buildScheduleFromBuilder(builder);
    setDraft((prev) => ({ ...prev, ...schedule }));
  }, [builder]);

  async function add() {
    if (!draft.command.trim()) return;
    try {
      await api('/api/cron_manager/jobs', { method: 'POST', body: draft });
      setDraft({ ...EMPTY });
      setTab('jobs');
      refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.addFailed);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/api/cron_manager/jobs/${id}`, { method: 'DELETE' });
      refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.removeFailed);
    } finally {
      setBusy(false);
      setRemoveId(null);
    }
  }

  async function setActive(id: string | undefined, active: boolean) {
    if (!id) return;
    try {
      await api(`/api/cron_manager/jobs/${id}/state`, { method: 'POST', body: { active } });
      refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.stateFailed);
    }
  }

  function scheduleSummary(job: Pick<Job, 'minute' | 'hour' | 'day' | 'month' | 'weekday'>): string {
    if (job.minute.startsWith('*/') && job.hour === '*' && job.day === '*' && job.month === '*' && job.weekday === '*') {
      return `Every ${job.minute.slice(2)} minutes`;
    }
    if (job.hour === '*' && job.day === '*' && job.month === '*' && job.weekday === '*') {
      return `Hourly at minute ${job.minute}`;
    }
    if (job.day === '*' && job.month === '*' && job.weekday === '*') {
      return `Daily at ${job.hour.padStart(2, '0')}:${job.minute.padStart(2, '0')}`;
    }
    if (job.day === '*' && job.month === '*' && /^\d$/.test(job.weekday)) {
      const wd = Number(job.weekday);
      return `Weekly on ${WEEKDAY_LABELS[wd] || job.weekday} at ${job.hour.padStart(2, '0')}:${job.minute.padStart(2, '0')}`;
    }
    if (job.month === '*' && job.weekday === '*') {
      return `Monthly on day ${job.day} at ${job.hour.padStart(2, '0')}:${job.minute.padStart(2, '0')}`;
    }
    if (job.day === '*' && job.month === '*' && job.weekday === '1-5') {
      return `Every weekday at ${job.hour.padStart(2, '0')}:${job.minute.padStart(2, '0')}`;
    }
    if (job.day === '*' && job.month === '*' && job.weekday === '0,6') {
      return `Weekends only at ${job.hour.padStart(2, '0')}:${job.minute.padStart(2, '0')}`;
    }
    return 'Custom schedule';
  }

  const tabs: { id: Tab; label: string; icon: keyof typeof Icons }[] = [
    { id: 'create', label: t.tabCreate, icon: 'PlusCircle' },
    { id: 'jobs', label: `${t.tabJobs} (${jobs.length})`, icon: 'List' },
  ];

  return (
    <ModuleViewport constrained>
      <div className={`flex flex-col h-full min-h-0 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
        <header
          className={`shrink-0 px-4 py-3 border-b flex items-center justify-between gap-4 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}
        >
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-blue-500 font-bold">{t.category}</p>
            <h1 className="text-lg font-semibold truncate">{t.title}</h1>
            <p className={`text-xs mt-0.5 line-clamp-2 ${muted}`}>{t.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => refresh()}
            className={`shrink-0 p-2 rounded-lg border ${btnSecondary}`}
            title="Refresh"
          >
            <Icons.RefreshCw className="w-4 h-4" />
          </button>
        </header>

        {error && (
          <div className="shrink-0 mx-4 mt-2 rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 px-4 py-3 text-sm text-red-600 dark:text-red-300 flex justify-between gap-2">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              <Icons.X className="w-4 h-4" />
            </button>
          </div>
        )}

        {system && (!system.crontab_available || (system.crontab_available && system.cron_service_active === false)) && (
          <div className="shrink-0 mx-4 mt-2 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-4 text-sm text-amber-900 dark:text-amber-200">
            <p className="font-semibold">{!system.crontab_available ? t.cronNotReady : t.cronDaemonStopped}</p>
            <p className="text-xs mt-1 opacity-90">
              {t.cronHint} {system.install_hint}
            </p>
            <button
              type="button"
              onClick={installCron}
              disabled={busy}
              className="mt-3 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold disabled:opacity-50"
            >
              {t.installCron}
            </button>
          </div>
        )}

        <ModuleSidebarLayout
          isDark={isDark}
          mobileTitle={t.title}
          sidebar={
          <aside
            className={`h-full w-44 shrink-0 border-r flex flex-col ${isDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}
          >
            <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {tabs.map((item) => {
                const Icon = Icons[item.icon] as React.ComponentType<{ className?: string }>;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition ${
                      tab === item.id
                        ? isDark
                          ? 'bg-blue-600/25 text-blue-300 font-semibold'
                          : 'bg-blue-50 text-blue-700 font-semibold'
                        : `${muted} ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <p className={`shrink-0 p-2 text-[10px] font-mono ${muted}`}>{t.storePath}</p>
          </aside>
          }
        >
          <main className="flex-1 min-h-0 overflow-y-auto p-4">
            {tab === 'create' && (
              <section className={`rounded-2xl border p-4 space-y-4 ${panel}`}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {(
                    [
                      'every_x_minutes',
                      'hourly',
                      'daily',
                      'weekly',
                      'weekdays',
                      'weekends',
                      'monthly',
                      'custom',
                    ] as ScheduleMode[]
                  ).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setBuilder((prev) => ({ ...prev, mode }))}
                      className={`rounded-xl border px-3 py-2 text-xs font-bold ${
                        builder.mode === mode
                          ? 'bg-blue-500/10 border-blue-500 text-blue-600 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      {t.modes[mode]}
                    </button>
                  ))}
                </div>

                {builder.mode === 'every_x_minutes' && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {[5, 10, 15, 30].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setBuilder((prev) => ({ ...prev, intervalMinutes: n }))}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                            builder.intervalMinutes === n
                              ? 'bg-blue-500/10 border-blue-500 text-blue-600 dark:text-blue-300'
                              : 'border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          Every {n} min
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={59}
                      value={builder.intervalMinutes}
                      onChange={(e) =>
                        setBuilder((prev) => ({ ...prev, intervalMinutes: clamp(Number(e.target.value) || 1, 1, 59) }))
                      }
                      className={`rounded-xl border px-3 py-2 text-sm font-mono w-full max-w-xs ${inputCls}`}
                    />
                  </div>
                )}

                {builder.mode === 'hourly' && (
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={builder.minute}
                    onChange={(e) => setBuilder((prev) => ({ ...prev, minute: clamp(Number(e.target.value) || 0, 0, 59) }))}
                    className={`rounded-xl border px-3 py-2 text-sm font-mono w-full max-w-xs ${inputCls}`}
                  />
                )}

                {(builder.mode === 'daily' ||
                  builder.mode === 'weekly' ||
                  builder.mode === 'weekdays' ||
                  builder.mode === 'weekends' ||
                  builder.mode === 'monthly') && (
                  <div className="grid grid-cols-2 gap-2 max-w-md">
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={builder.hour}
                      onChange={(e) => setBuilder((prev) => ({ ...prev, hour: clamp(Number(e.target.value) || 0, 0, 23) }))}
                      className={`rounded-xl border px-3 py-2 text-sm font-mono ${inputCls}`}
                      placeholder="Hour"
                    />
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={builder.minute}
                      onChange={(e) => setBuilder((prev) => ({ ...prev, minute: clamp(Number(e.target.value) || 0, 0, 59) }))}
                      className={`rounded-xl border px-3 py-2 text-sm font-mono ${inputCls}`}
                      placeholder="Minute"
                    />
                  </div>
                )}

                {builder.mode === 'weekly' && (
                  <select
                    value={builder.weekday}
                    onChange={(e) => setBuilder((prev) => ({ ...prev, weekday: Number(e.target.value) }))}
                    className={`rounded-xl border px-3 py-2 text-sm max-w-xs ${inputCls}`}
                  >
                    {WEEKDAY_LABELS.map((label, idx) => (
                      <option key={label} value={idx}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}

                {builder.mode === 'monthly' && (
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={builder.dayOfMonth}
                    onChange={(e) =>
                      setBuilder((prev) => ({ ...prev, dayOfMonth: clamp(Number(e.target.value) || 1, 1, 31) }))
                    }
                    className={`rounded-xl border px-3 py-2 text-sm font-mono max-w-xs ${inputCls}`}
                  />
                )}

                {builder.mode === 'custom' && (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {(['minute', 'hour', 'day', 'month', 'weekday'] as const).map((field) => (
                      <input
                        key={field}
                        value={draft[field]}
                        onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                        placeholder={field}
                        className={`rounded-xl border px-3 py-2 text-sm font-mono ${inputCls}`}
                      />
                    ))}
                  </div>
                )}

                <div className={`rounded-xl border px-3 py-2 ${isDark ? 'border-slate-800 bg-slate-950/40' : 'border-slate-200 bg-slate-50'}`}>
                  <p className={`text-[11px] ${muted}`}>{t.schedulePreview}</p>
                  <p className="text-xs font-semibold">{scheduleSummary(draft)}</p>
                  <p className={`text-[11px] font-mono mt-1 ${muted}`}>
                    {draft.minute} {draft.hour} {draft.day} {draft.month} {draft.weekday}
                  </p>
                  <p className={`text-[11px] mt-1 ${muted}`}>
                    {t.nextRun}:{' '}
                    <span className="font-semibold">
                      {(() => {
                        const next = getNextRunTime(draft);
                        return next ? next.toLocaleString() : t.unavailable;
                      })()}
                    </span>
                  </p>
                </div>

                <div className="flex gap-2">
                  <input
                    value={draft.command}
                    onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                    placeholder={t.commandRequired}
                    className={`flex-1 rounded-xl border px-3 py-2 text-sm font-mono ${inputCls}`}
                  />
                  <button
                    type="button"
                    onClick={add}
                    className="shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-4"
                  >
                    {t.add}
                  </button>
                </div>
              </section>
            )}

            {tab === 'jobs' && (
              <section className={`rounded-2xl border divide-y divide-slate-100 dark:divide-slate-800 ${panel}`}>
                {jobs.length === 0 ? (
                  <p className={`px-4 py-6 text-xs text-center ${muted}`}>{t.noJobs}</p>
                ) : (
                  jobs.map((j, i) => (
                    <div key={j.id || i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm font-mono">
                      <span className={`text-xs ${muted}`}>
                        {j.minute} {j.hour} {j.day} {j.month} {j.weekday}
                      </span>
                      <span className="flex-1 truncate">{j.command}</span>
                      {j.managed ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setActive(j.id, !(j.is_active ?? true))}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold ${
                              (j.is_active ?? true)
                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                                : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                            }`}
                          >
                            {(j.is_active ?? true) ? t.pause : t.start}
                          </button>
                          <button
                            type="button"
                            onClick={() => j.id && setRemoveId(j.id)}
                            className="text-slate-400 hover:text-red-500"
                          >
                            <Icons.Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <span className={`text-[10px] uppercase ${muted}`}>{t.manual}</span>
                      )}
                    </div>
                  ))
                )}
              </section>
            )}
          </main>
        </ModuleSidebarLayout>
      </div>

      <WindowModal open={removeId !== null} onClose={() => setRemoveId(null)} title={t.remove} maxWidth="sm">
        <p className={`text-sm mb-4 ${muted}`}>{t.removeConfirm}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setRemoveId(null)} className={`px-4 py-2 rounded-xl text-xs font-bold border ${btnSecondary}`}>
            {t.cancel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => removeId && remove(removeId)}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
          >
            {t.remove}
          </button>
        </div>
      </WindowModal>
    </ModuleViewport>
  );
}
