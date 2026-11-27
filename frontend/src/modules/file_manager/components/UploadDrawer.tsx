import { useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatSize } from '../utils';
import type { FileManagerState } from '../hooks/useFileManager';
import type { UploadStatus } from '../types';

const ACTIVE: UploadStatus[] = ['queued', 'uploading'];

/** Bottom-right upload queue with per-file progress, cancel and retry. */
export default function UploadDrawer({ fm }: { fm: FileManagerState }) {
  const { isDark, tr, uploads } = fm;
  const [collapsed, setCollapsed] = useState(false);
  if (!uploads.length) return null;

  const total = uploads.length;
  const finished = uploads.filter((u) => !ACTIVE.includes(u.status)).length;
  const active = total - finished;
  const bytesTotal = uploads.reduce((s, u) => s + u.file.size, 0) || 1;
  const bytesDone = uploads.reduce((s, u) => s + (ACTIVE.includes(u.status) ? u.loaded : u.file.size), 0);
  const pct = Math.round((bytesDone / bytesTotal) * 100);
  const errors = uploads.filter((u) => u.status === 'error').length;

  const statusLabel = (s: UploadStatus) =>
    ({ queued: tr.stQueued, uploading: tr.stUploading, done: tr.stDone, skipped: tr.stSkipped, error: tr.stError, canceled: tr.stCanceled })[s];

  return (
    <div
      data-testid="fm-uploads"
      className={cn(
        'absolute bottom-3 right-3 z-30 w-[min(360px,calc(100%-1.5rem))] overflow-hidden rounded-xl border shadow-2xl',
        isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white',
      )}
    >
      <div className={cn('flex items-center gap-2 border-b px-3 py-2 text-xs', isDark ? 'border-slate-800' : 'border-slate-100')}>
        {active > 0 ? (
          <Icons.Loader className="h-3.5 w-3.5 animate-spin text-sky-500" />
        ) : errors ? (
          <Icons.AlertCircle className="h-3.5 w-3.5 text-red-500" />
        ) : (
          <Icons.CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        )}
        <span className="flex-1 font-semibold" data-testid="fm-uploads-summary">
          {tr.uploadsTitle} · {tr.uploadsSummary(finished, total)}
        </span>
        <button type="button" title={collapsed ? tr.expand : tr.minimize} onClick={() => setCollapsed((c) => !c)} className="rounded p-1 opacity-70 hover:opacity-100">
          {collapsed ? <Icons.ChevronUp className="h-3.5 w-3.5" /> : <Icons.ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {active === 0 && (
          <button type="button" title={tr.close} onClick={fm.clearFinishedUploads} className="rounded p-1 opacity-70 hover:opacity-100" data-testid="fm-uploads-close">
            <Icons.X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className={cn('h-1', isDark ? 'bg-slate-800' : 'bg-slate-100')}>
        <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      {!collapsed && (
        <ul className="max-h-56 overflow-y-auto py-1 text-[11px]">
          {uploads.map((u) => {
            const p = u.file.size ? Math.round((u.loaded / u.file.size) * 100) : u.status === 'done' ? 100 : 0;
            const label = u.relPath || u.file.name;
            return (
              <li key={u.id} className="flex items-center gap-2 px-3 py-1.5" title={u.error || label}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{label}</span>
                    <span
                      className={cn(
                        'shrink-0 text-[10px]',
                        u.status === 'error' ? 'text-red-500' : u.status === 'done' ? 'text-emerald-500' : 'opacity-60',
                      )}
                    >
                      {u.status === 'uploading' ? `${p}%` : statusLabel(u.status)}
                    </span>
                  </div>
                  {u.status === 'uploading' ? (
                    <div className={cn('mt-1 h-1 overflow-hidden rounded-full', isDark ? 'bg-slate-800' : 'bg-slate-100')}>
                      <div className="h-full bg-sky-500 transition-all" style={{ width: `${p}%` }} />
                    </div>
                  ) : (
                    <span className="text-[10px] opacity-50">{u.error ? u.error : formatSize(u.file.size)}</span>
                  )}
                </div>
                {ACTIVE.includes(u.status) ? (
                  <button type="button" title={tr.uploadCancel} onClick={() => fm.cancelUpload(u.id)} className="rounded p-1 opacity-60 hover:opacity-100">
                    <Icons.X className="h-3.5 w-3.5" />
                  </button>
                ) : u.status === 'error' || u.status === 'canceled' ? (
                  <button type="button" title={tr.uploadRetry} onClick={() => fm.retryUpload(u.id)} className="rounded p-1 opacity-60 hover:opacity-100">
                    <Icons.RotateCw className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
