/**
 * Cron Manager UI - list / add / remove cron jobs. Auto-managed jobs are
 * tagged so the UI never edits user-authored lines.
 */
import { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { api } from '../../core/platform';

interface Job {
  id?: string;
  minute: string;
  hour: string;
  day: string;
  month: string;
  weekday: string;
  command: string;
  managed: boolean;
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

type ScheduleMode = 'every_x_minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

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
    case 'custom':
    default:
      return { minute: '*', hour: '*', day: '*', month: '*', weekday: '*' };
  }
}

export default function CronManager() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [draft, setDraft] = useState<Job>({ ...EMPTY });
  const [builder, setBuilder] = useState<BuilderState>({ ...DEFAULT_BUILDER });
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const list = await api<Job[]>('/api/cron_manager/jobs');
      setJobs(list || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load cron jobs');
    }
  };

  useEffect(() => {
    refresh();
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
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to add cron job');
    }
  }

  async function remove(id?: string) {
    if (!id) return;
    if (!confirm('Remove this cron job?')) return;
    try {
      await api(`/api/cron_manager/jobs/${id}`, { method: 'DELETE' });
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to remove cron job');
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
    return 'Custom schedule';
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-widest text-blue-500 font-bold">Automation</p>
        <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">Cron Manager</h1>
        <p className="text-xs text-slate-500 mt-2 max-w-xl">
          Schedule recurring tasks. Entries created here are tagged so we never touch crontab lines you
          authored manually.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          {([
            { id: 'every_x_minutes', label: 'Every X min' },
            { id: 'hourly', label: 'Hourly' },
            { id: 'daily', label: 'Daily' },
            { id: 'weekly', label: 'Weekly' },
            { id: 'monthly', label: 'Monthly' },
            { id: 'custom', label: 'Custom cron' },
          ] as Array<{ id: ScheduleMode; label: string }>).map((m) => (
            <button
              key={m.id}
              onClick={() => setBuilder((prev) => ({ ...prev, mode: m.id }))}
              className={`rounded-xl border px-3 py-2 text-xs font-bold ${
                builder.mode === m.id
                  ? 'bg-blue-500/10 border-blue-500 text-blue-600 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {builder.mode === 'every_x_minutes' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <label className="text-xs text-slate-500 flex items-center">Interval (minutes)</label>
            <input
              type="number"
              min={1}
              max={59}
              value={builder.intervalMinutes}
              onChange={(e) => setBuilder((prev) => ({ ...prev, intervalMinutes: clamp(Number(e.target.value) || 1, 1, 59) }))}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm font-mono"
            />
          </div>
        )}

        {builder.mode === 'hourly' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <label className="text-xs text-slate-500 flex items-center">Minute</label>
            <input
              type="number"
              min={0}
              max={59}
              value={builder.minute}
              onChange={(e) => setBuilder((prev) => ({ ...prev, minute: clamp(Number(e.target.value) || 0, 0, 59) }))}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm font-mono"
            />
          </div>
        )}

        {(builder.mode === 'daily' || builder.mode === 'weekly' || builder.mode === 'monthly') && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <label className="text-xs text-slate-500 flex items-center">Hour</label>
            <input
              type="number"
              min={0}
              max={23}
              value={builder.hour}
              onChange={(e) => setBuilder((prev) => ({ ...prev, hour: clamp(Number(e.target.value) || 0, 0, 23) }))}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm font-mono"
            />
            <label className="text-xs text-slate-500 flex items-center">Minute</label>
            <input
              type="number"
              min={0}
              max={59}
              value={builder.minute}
              onChange={(e) => setBuilder((prev) => ({ ...prev, minute: clamp(Number(e.target.value) || 0, 0, 59) }))}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm font-mono"
            />
          </div>
        )}

        {builder.mode === 'weekly' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <label className="text-xs text-slate-500 flex items-center">Weekday</label>
            <select
              value={builder.weekday}
              onChange={(e) => setBuilder((prev) => ({ ...prev, weekday: Number(e.target.value) }))}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
            >
              {WEEKDAY_LABELS.map((label, idx) => (
                <option key={label} value={idx}>{label}</option>
              ))}
            </select>
          </div>
        )}

        {builder.mode === 'monthly' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <label className="text-xs text-slate-500 flex items-center">Day of month</label>
            <input
              type="number"
              min={1}
              max={31}
              value={builder.dayOfMonth}
              onChange={(e) => setBuilder((prev) => ({ ...prev, dayOfMonth: clamp(Number(e.target.value) || 1, 1, 31) }))}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm font-mono"
            />
          </div>
        )}

        {builder.mode === 'custom' && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {(['minute', 'hour', 'day', 'month', 'weekday'] as const).map((field) => (
              <input
                key={field}
                value={draft[field]}
                onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                placeholder={field}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm font-mono"
              />
            ))}
          </div>
        )}

        <div className="rounded-xl bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 px-3 py-2">
          <p className="text-[11px] text-slate-500">Schedule preview</p>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{scheduleSummary(draft)}</p>
          <p className="text-[11px] font-mono text-slate-500 mt-1">
            {draft.minute} {draft.hour} {draft.day} {draft.month} {draft.weekday}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        <input
          value={draft.command}
          onChange={(e) => setDraft({ ...draft, command: e.target.value })}
          placeholder="command (required)"
          className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm font-mono md:col-span-5"
        />
        <button onClick={add} className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold md:col-span-1">
          Add
        </button>
        </div>
      </section>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 divide-y divide-slate-100 dark:divide-slate-800">
        {jobs.length === 0 ? (
          <p className="px-4 py-3 text-xs text-slate-500">No cron jobs.</p>
        ) : (
          jobs.map((j, i) => (
            <div key={j.id || i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm font-mono">
              <span className="text-slate-500">
                {j.minute} {j.hour} {j.day} {j.month} {j.weekday}
              </span>
              <span className="flex-1 truncate text-slate-700 dark:text-slate-200">{j.command}</span>
              {j.managed ? (
                <button onClick={() => remove(j.id)} className="text-slate-400 hover:text-red-500">
                  <Icons.Trash2 className="w-4 h-4" />
                </button>
              ) : (
                <span className="text-[10px] uppercase tracking-wider text-slate-400">manual</span>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
