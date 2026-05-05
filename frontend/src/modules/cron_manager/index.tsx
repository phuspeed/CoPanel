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

export default function CronManager() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [draft, setDraft] = useState<Job>({ ...EMPTY });
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
    await api(`/api/cron_manager/jobs/${id}`, { method: 'DELETE' });
    refresh();
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

      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 grid grid-cols-2 md:grid-cols-7 gap-2">
        {(['minute', 'hour', 'day', 'month', 'weekday'] as const).map((field) => (
          <input
            key={field}
            value={(draft as any)[field]}
            onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
            placeholder={field}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm font-mono"
          />
        ))}
        <input
          value={draft.command}
          onChange={(e) => setDraft({ ...draft, command: e.target.value })}
          placeholder="command"
          className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm font-mono col-span-2 md:col-span-1"
        />
        <button onClick={add} className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold col-span-2 md:col-span-1">
          Add
        </button>
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
