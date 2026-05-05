/**
 * Task Center drawer - shows active and recent jobs from any module that
 * went through ``core.jobs``. Supports progress bars, retry/cancel actions,
 * and live updates via the SSE event hub.
 */
import { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { Job, jobsApi, useJobs } from '../platform';

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATUS_LABEL: Record<Job['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_BADGE: Record<Job['status'], string> = {
  queued: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  cancelled: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

function formatDuration(start?: number | null, end?: number | null) {
  if (!start) return '';
  const finish = end || Date.now() / 1000;
  const seconds = Math.max(0, Math.round(finish - start));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export default function TaskCenter({ open, onClose }: Props) {
  const { jobs } = useJobs();
  const [selected, setSelected] = useState<string | null>(null);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    if (open) {
      jobsApi.refresh().catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    jobsApi.get(selected).then((j) => {
      if (!cancelled) setLogs((j as any).logs || []);
    }).catch(() => {});
    const interval = setInterval(() => {
      jobsApi.get(selected).then((j) => {
        if (!cancelled) setLogs((j as any).logs || []);
      }).catch(() => {});
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selected]);

  if (!open) return null;

  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const recent = jobs.filter((j) => j.status === 'success' || j.status === 'failed' || j.status === 'cancelled').slice(0, 30);

  return (
    <div className="fixed inset-0 z-[200] flex" onClick={onClose}>
      <div className="flex-1 bg-black/30 backdrop-blur-[2px]" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-[440px] max-w-full h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Task Center</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{active.length} active / {jobs.length} total</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
            <Icons.X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <Section title="Active">
            {active.length === 0 ? (
              <div className="px-5 py-3 text-xs text-slate-500">No active jobs.</div>
            ) : (
              active.map((j) => (
                <JobRow key={j.id} job={j} active onSelect={() => setSelected(j.id)} />
              ))
            )}
          </Section>
          <Section title="Recent">
            {recent.length === 0 ? (
              <div className="px-5 py-3 text-xs text-slate-500">No recent jobs.</div>
            ) : (
              recent.map((j) => (
                <JobRow key={j.id} job={j} onSelect={() => setSelected(j.id)} />
              ))
            )}
          </Section>
        </div>

        {selected && (
          <div className="border-t border-slate-200 dark:border-slate-800 max-h-[40%] overflow-y-auto bg-slate-50 dark:bg-slate-950/40">
            <div className="flex items-center justify-between px-5 py-2">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Logs</p>
              <button
                onClick={() => setSelected(null)}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                <Icons.X className="w-3.5 h-3.5" />
              </button>
            </div>
            <pre className="px-5 pb-4 text-[11px] font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
              {logs.length === 0 ? 'No log entries yet.' : logs.map((l, i) => `${new Date(l.ts).toLocaleTimeString()}  ${l.line}`).join('\n')}
            </pre>
          </div>
        )}
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-2">
      <div className="px-5 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-400">{title}</div>
      <div>{children}</div>
    </section>
  );
}

function JobRow({ job, active, onSelect }: { job: Job; active?: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{job.title}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {job.module || 'platform'} · {STATUS_LABEL[job.status]} · {formatDuration(job.started_at, job.finished_at)}
          </p>
          {active && (
            <div className="mt-2 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${Math.min(100, Math.max(0, job.progress || 0))}%` }}
              />
            </div>
          )}
          {job.message && <p className="text-[11px] text-slate-500 mt-1 truncate">{job.message}</p>}
          {job.error && <p className="text-[11px] text-red-500 mt-1 truncate">{job.error}</p>}
        </div>
        <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[job.status]}`}>
          {STATUS_LABEL[job.status]}
        </span>
      </div>
      {active && (
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              jobsApi.cancel(job.id).catch(() => {});
            }}
            className="text-[10px] font-bold uppercase tracking-wider text-red-500 hover:text-red-400"
          >
            Cancel
          </button>
        </div>
      )}
    </button>
  );
}
