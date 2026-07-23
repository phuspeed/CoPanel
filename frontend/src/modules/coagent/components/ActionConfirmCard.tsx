import * as Icons from 'lucide-react';
import type { Lang } from '../i18n';
import { COPY } from '../i18n';

export interface PendingAction {
  action_id: string;
  tool: string;
  args: Record<string, unknown>;
  title: string;
  command_preview: string;
  risk?: string;
  status?: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  resultSummary?: string;
}

export default function ActionConfirmCard({
  action,
  language,
  onApprove,
  onCancel,
}: {
  action: PendingAction;
  language: Lang;
  onApprove: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const t = COPY[language];
  const status = action.status || 'pending';
  const risk = (action.risk || 'medium').toLowerCase();
  const riskColor =
    risk === 'high'
      ? 'text-red-600 dark:text-red-400'
      : risk === 'low'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-amber-600 dark:text-amber-400';

  return (
    <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 dark:bg-amber-500/10">
      <div className="flex items-start gap-2">
        <Icons.AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t.actionPending}
          </div>
          <div className="mt-1 text-sm text-slate-800 dark:text-slate-200">{action.title}</div>
          <div className={`mt-1 text-xs font-medium ${riskColor}`}>
            {t.risk}: {risk}
          </div>
          <div className="mt-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">{t.command}</div>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900/90 p-2 text-xs text-emerald-300">
              {action.command_preview}
            </pre>
          </div>
          {action.args && Object.keys(action.args).length > 0 && (
            <pre className="mt-2 overflow-x-auto rounded-lg bg-white/60 p-2 text-[11px] text-slate-700 dark:bg-black/30 dark:text-slate-300">
              {JSON.stringify(action.args, null, 2)}
            </pre>
          )}
          {action.resultSummary && (
            <div className="mt-2 text-xs text-slate-700 dark:text-slate-300">{action.resultSummary}</div>
          )}
          {status === 'pending' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onApprove(action.action_id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
              >
                <Icons.Check className="h-3.5 w-3.5" />
                {t.approve}
              </button>
              <button
                type="button"
                onClick={() => onCancel(action.action_id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                <Icons.X className="h-3.5 w-3.5" />
                {t.cancel}
              </button>
            </div>
          )}
          {status === 'running' && (
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t.actionRunning}
            </div>
          )}
          {status === 'done' && (
            <div className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">{t.actionDone}</div>
          )}
          {status === 'failed' && (
            <div className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">{t.actionFailed}</div>
          )}
          {status === 'cancelled' && (
            <div className="mt-2 text-xs text-slate-500">{t.actionCancelled}</div>
          )}
        </div>
      </div>
    </div>
  );
}
