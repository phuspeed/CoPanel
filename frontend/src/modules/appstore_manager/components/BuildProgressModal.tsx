import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import WindowModal from '../../../core/shell/WindowModal';
import type { AppStoreTranslations } from '../i18n';

interface Props {
  open: boolean;
  isDark: boolean;
  language: 'en' | 'vi';
  tr: AppStoreTranslations;
  buildLogs: string[];
  buildStatus: string | null;
  buildProgress: number;
  showBuildLogs: boolean;
  onToggleLogs: () => void;
  onClose: () => void;
  restartRequired: boolean;
  restartReason: string | null;
  restartUi: 'idle' | 'submitting' | 'waiting';
  onRestart: () => void;
}

export default function BuildProgressModal({
  open,
  isDark,
  language,
  tr,
  buildLogs,
  buildStatus,
  buildProgress,
  showBuildLogs,
  onToggleLogs,
  onClose,
  restartRequired,
  restartReason,
  restartUi,
  onRestart,
}: Props) {
  if (!open || buildLogs.length === 0) return null;

  return (
    <WindowModal open={open} onClose={onClose} title="Build Logs" maxWidth="2xl">
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
        <span
          className={cn(
            'inline-block rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase',
            buildStatus === 'success'
              ? 'border-green-500/20 bg-green-500/10 text-green-400'
              : buildStatus === 'failed'
                ? 'border-red-500/20 bg-red-500/10 text-red-400'
                : 'animate-pulse border-blue-500/20 bg-blue-500/10 text-blue-400',
          )}
        >
          {buildStatus || 'running'}
        </span>

        <div className={cn('rounded-xl border p-4', isDark ? 'border-slate-800 bg-slate-950/80' : 'border-slate-100 bg-slate-50')}>
          <div className="mb-2 flex justify-between text-xs font-semibold">
            <span>{language === 'vi' ? 'Tiến trình' : 'Progress'}</span>
            <span className="font-mono">{Math.max(0, Math.min(100, buildProgress))}%</span>
          </div>
          <div className={cn('h-2 overflow-hidden rounded-full', isDark ? 'bg-slate-800' : 'bg-slate-200')}>
            <div
              className={cn(
                'h-full transition-all duration-500',
                buildStatus === 'failed' ? 'bg-red-500' : buildStatus === 'success' ? 'bg-emerald-500' : 'bg-blue-500',
              )}
              style={{ width: `${Math.max(5, Math.min(100, buildProgress || 5))}%` }}
            />
          </div>
          <button type="button" onClick={onToggleLogs} className="mt-2 text-[11px] font-semibold text-blue-500">
            {showBuildLogs ? (language === 'vi' ? 'Ẩn log' : 'Hide logs') : language === 'vi' ? 'Hiện log' : 'Show logs'}
          </button>
        </div>

        {showBuildLogs && (
          <div
            className={cn(
              'max-h-[36vh] space-y-1 overflow-y-auto rounded-xl border p-4 font-mono text-xs',
              isDark ? 'border-slate-800 bg-slate-950/80 text-slate-300' : 'border-slate-100 bg-white text-slate-700',
            )}
          >
            {buildLogs.map((log, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {log}
              </div>
            ))}
          </div>
        )}

        {buildStatus === 'success' && restartRequired && (
          <div className={cn('space-y-3 rounded-xl border p-4', isDark ? 'border-amber-500/30 bg-amber-950/30' : 'border-amber-200 bg-amber-50')}>
            <p className={cn('text-xs font-bold', isDark ? 'text-amber-200' : 'text-amber-900')}>{tr.restartRequiredTitle}</p>
            <p className={cn('text-[11px]', isDark ? 'text-amber-100/80' : 'text-amber-800')}>{tr.restartRequiredBody}</p>
            {restartReason && <p className="font-mono text-[10px] opacity-60">{restartReason}</p>}
            <button
              type="button"
              disabled={restartUi !== 'idle'}
              onClick={onRestart}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 py-2.5 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-60"
            >
              {restartUi !== 'idle' && <Icons.Loader2 className="h-4 w-4 animate-spin" />}
              {restartUi === 'idle' && tr.restartCopanelBtn}
              {restartUi === 'submitting' && tr.restartingCopanel}
              {restartUi === 'waiting' && tr.restartWaitingForService}
            </button>
          </div>
        )}

        {(buildStatus === 'success' || buildStatus === 'failed') && (
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'w-full rounded-xl border py-2.5 text-xs font-bold',
              isDark ? 'border-slate-700 bg-slate-800 text-slate-200' : 'border-slate-200 bg-white text-slate-700',
            )}
          >
            {language === 'vi' ? 'Đóng' : 'Close'}
          </button>
        )}
      </div>
    </WindowModal>
  );
}
