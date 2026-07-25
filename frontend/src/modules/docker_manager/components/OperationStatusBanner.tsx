/**
 * Shows active docker_manager jobs (deploy / stop / restart / …) with progress.
 */
import { useMemo } from 'react';
import { cn } from '../../../lib/utils';
import * as Icons from 'lucide-react';
import { useJobs, type Job } from '../../../core/platform';

interface Props {
  isDark: boolean;
  language: 'en' | 'vi';
  pathFilter?: string;
  containerIdFilter?: string;
}

export default function OperationStatusBanner({ isDark, language, pathFilter, containerIdFilter }: Props) {
  const { jobs } = useJobs();

  const active = useMemo(() => {
    return jobs.filter((j) => {
      if (j.module !== 'docker_manager') return false;
      if (j.status !== 'queued' && j.status !== 'running') return false;
      if (pathFilter && j.payload?.path !== pathFilter) return false;
      if (containerIdFilter) {
        const cid = String(j.payload?.container_id || '');
        if (cid !== containerIdFilter && !cid.startsWith(containerIdFilter) && !containerIdFilter.startsWith(cid)) {
          return false;
        }
      }
      return true;
    });
  }, [jobs, pathFilter, containerIdFilter]);

  if (active.length === 0) return null;

  const label = language === 'vi' ? 'Đang xử lý' : 'In progress';

  return (
    <div className="space-y-2">
      {active.map((job) => (
        <JobRow key={job.id} job={job} isDark={isDark} label={label} />
      ))}
    </div>
  );
}

function JobRow({ job, isDark, label }: { job: Job; isDark: boolean; label: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2.5 flex flex-col gap-1.5',
        isDark ? 'bg-blue-950/30 border-blue-500/25' : 'bg-blue-50 border-blue-200',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icons.Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 shrink-0" />
          <span className={cn('text-xs font-bold truncate', isDark ? 'text-slate-100' : 'text-slate-800')}>{job.title}</span>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500 shrink-0">
          {label} · {job.progress ?? 0}%
        </span>
      </div>
      {job.message && (
        <p className={cn('text-[11px] truncate', isDark ? 'text-slate-400' : 'text-slate-600')}>{job.message}</p>
      )}
      <div className={cn('h-1.5 rounded-full overflow-hidden', isDark ? 'bg-slate-800' : 'bg-blue-100')}>
        <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${job.progress || 0}%` }} />
      </div>
    </div>
  );
}

/** Returns container IDs currently targeted by an active docker_manager job. */
export function useBusyContainerIds(): Set<string> {
  const { jobs } = useJobs();
  return useMemo(() => {
    const ids = new Set<string>();
    for (const j of jobs) {
      if (j.module !== 'docker_manager') continue;
      if (j.status !== 'queued' && j.status !== 'running') continue;
      const cid = j.payload?.container_id;
      if (typeof cid === 'string' && cid) ids.add(cid);
    }
    return ids;
  }, [jobs]);
}

/** Returns compose paths currently targeted by an active docker_manager job. */
export function useBusyComposePaths(): Set<string> {
  const { jobs } = useJobs();
  return useMemo(() => {
    const paths = new Set<string>();
    for (const j of jobs) {
      if (j.module !== 'docker_manager') continue;
      if (j.status !== 'queued' && j.status !== 'running') continue;
      const path = j.payload?.path;
      if (typeof path === 'string' && path) paths.add(path);
    }
    return paths;
  }, [jobs]);
}
