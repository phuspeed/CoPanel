/**
 * "Upgrade CoPanel" dialog: installed → available version, release notes,
 * GitHub link, progress bar, live installer log, Close / Start upgrade.
 *
 * One dialog for both shells: the Classic sidebar footer and the Desktop
 * dock version badge both open this. State comes from
 * ``usePanelUpdate``. ``z-[110]`` keeps it above desktop windows (z-[100])
 * and below the dock (z-[120]).
 */
import { useEffect, useRef } from 'react';
import * as Icons from 'lucide-react';
import type { PanelUpdateState } from '../hooks/usePanelUpdate';

export interface PanelUpgradeLabels {
  changelog: string;
  close: string;
  liveLog: string;
  progress: string;
  restarting: string;
  upgradeRunning: string;
  startUpgrade: string;
  upToDate: string;
  upgradeDone: string;
  upgradeFailed: string;
  upgradeIntro: string;
  upgradeTitle: string;
  viewReleases: string;
}

interface Props {
  state: PanelUpdateState;
  isDark: boolean;
  labels: PanelUpgradeLabels;
}

export default function PanelUpgradeModal({ state, isDark, labels }: Props) {
  const { info, modalOpen, closeModal: onClose, running, log, progress, success, failed, restarting, runUpgrade } = state;
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  if (!modalOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-fade-in">
      <div
        className={`flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl ${isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
          }`}
      >
        <div className={`flex items-start justify-between gap-3 border-b px-5 py-4 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
          <div>
            <h3 className={`text-base font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{labels.upgradeTitle}</h3>
            <p className={`mt-1 text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{labels.upgradeIntro}</p>
            {info && (
              <p className="mt-2 font-mono text-[11px] text-blue-400">
                {info.local_version}
                {info.remote_version ? ` → ${info.remote_version}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={running}
            onClick={() => !running && onClose()}
            className="shrink-0 text-slate-500 hover:text-slate-300 disabled:opacity-40"
          >
            <Icons.X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {!info?.update_available && !running && !log && (
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{labels.upToDate}</p>
          )}
          {info?.changelog ? (
            <div>
              <div className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                {labels.changelog}
              </div>
              <pre
                className={`max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border p-3 text-[11px] leading-relaxed ${isDark ? 'border-slate-800 bg-slate-950/50 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
              >
                {info.changelog}
              </pre>
            </div>
          ) : null}
          {info?.release_url && (
            <a
              href={info.release_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-bold text-blue-500 hover:text-blue-400"
            >
              {labels.viewReleases}
              <Icons.ExternalLink className="h-3 w-3" />
            </a>
          )}

          <div>
            <div className={`mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
              <span>{labels.progress}</span>
              <span className="font-mono normal-case">{Math.round(progress)}%</span>
            </div>
            <div className={`h-2 w-full overflow-hidden rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-[width] duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div>
            <div className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{labels.liveLog}</div>
            <pre
              ref={logRef}
              className={`max-h-52 overflow-auto whitespace-pre-wrap rounded-xl border p-3 font-mono text-[10px] leading-snug ${isDark ? 'border-slate-800 bg-black/40 text-green-400/90' : 'border-slate-200 bg-slate-900 text-green-200'
                }`}
            >
              {log || (running ? labels.upgradeRunning : '—')}
            </pre>
          </div>

          {running && restarting && (
            <p className="text-center text-xs font-bold text-amber-500">{labels.restarting}</p>
          )}
          {success && <p className="text-center text-xs font-bold text-emerald-500">{labels.upgradeDone}</p>}
          {!success && failed && !running && (
            <p className="text-center text-xs font-bold text-red-400">{labels.upgradeFailed}</p>
          )}
        </div>

        <div className={`flex justify-end gap-2 border-t px-5 py-4 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
          <button
            type="button"
            disabled={running}
            onClick={() => onClose()}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              } disabled:opacity-50`}
          >
            {labels.close}
          </button>
          <button
            type="button"
            disabled={running || success || !info?.update_available}
            onClick={runUpgrade}
            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-blue-500 disabled:opacity-50"
          >
            {labels.startUpgrade}
          </button>
        </div>
      </div>
    </div>
  );
}
