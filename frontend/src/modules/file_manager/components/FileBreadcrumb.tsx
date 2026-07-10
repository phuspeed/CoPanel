import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import { pathBreadcrumbs } from '../utils';
import type { FileManagerTranslations } from '../i18n';

interface Props {
  isDark: boolean;
  tr: FileManagerTranslations;
  currentPath: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
}

export default function FileBreadcrumb({ isDark, tr, currentPath, canGoBack, canGoForward, onBack, onForward, onUp, onRefresh, onNavigate }: Props) {
  const crumbs = pathBreadcrumbs(currentPath);
  const btn = cn(
    'flex h-8 w-8 items-center justify-center rounded-lg border transition disabled:opacity-35',
    isDark ? 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
  );

  return (
    <div className="flex items-center gap-1.5 min-w-0 flex-1">
      <button type="button" className={btn} onClick={onBack} disabled={!canGoBack} title={tr.back}>
        <Icons.ChevronLeft className="h-4 w-4" />
      </button>
      <button type="button" className={btn} onClick={onForward} disabled={!canGoForward} title={tr.forward}>
        <Icons.ChevronRight className="h-4 w-4" />
      </button>
      <button type="button" className={btn} onClick={onUp} title={tr.up}>
        <Icons.ArrowUp className="h-4 w-4" />
      </button>
      <button type="button" className={btn} onClick={onRefresh} title={tr.refresh}>
        <Icons.RefreshCw className="h-4 w-4" />
      </button>
      <div
        className={cn(
          'ml-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg border px-2 py-1 text-xs font-mono',
          isDark ? 'border-slate-700 bg-slate-950/50 text-slate-300' : 'border-slate-200 bg-white text-slate-700',
        )}
      >
        {crumbs.map((c, i) => (
          <span key={c.path} className="flex items-center shrink-0">
            {i > 0 && <span className={cn('mx-1', isDark ? 'text-slate-600' : 'text-slate-300')}>/</span>}
            <button
              type="button"
              onClick={() => onNavigate(c.path)}
              className={cn(
                'rounded px-1 py-0.5 transition hover:underline',
                i === crumbs.length - 1
                  ? isDark
                    ? 'text-sky-300 font-bold'
                    : 'text-blue-600 font-bold'
                  : isDark
                    ? 'text-slate-400 hover:text-slate-200'
                    : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {c.label}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
