/**
 * Recent tasks widget - taps the global jobs store so it auto-updates as
 * new jobs are submitted/completed. Acts as a quick view that complements
 * the full Task Center drawer.
 */
import { useEffect } from 'react';
import { jobsApi, useJobs } from '../platform';
import Widget from './Widget';

export default function RecentTasksWidget() {
  const { jobs } = useJobs();

  useEffect(() => {
    jobsApi.refresh(20).catch(() => {});
  }, []);

  const recent = jobs.slice(0, 6);

  let status: 'ok' | 'warn' | 'error' = 'ok';
  if (recent.some((j) => j.status === 'failed')) status = 'error';
  else if (recent.some((j) => j.status === 'running' || j.status === 'queued')) status = 'info' as any;

  return (
    <Widget title="Recent Tasks" icon="ListChecks" status={status as any}>
      {recent.length === 0 ? (
        <p className="text-xs text-slate-500">No recent tasks.</p>
      ) : (
        <ul className="space-y-1.5">
          {recent.map((j) => (
            <li key={j.id} className="flex items-center justify-between text-xs gap-2">
              <span className="truncate text-slate-700 dark:text-slate-200">{j.title}</span>
              <span
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  j.status === 'success'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : j.status === 'failed'
                      ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                      : j.status === 'running' || j.status === 'queued'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {j.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
