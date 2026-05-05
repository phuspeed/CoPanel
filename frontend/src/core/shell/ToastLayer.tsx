/**
 * Floating toast layer - listens to the notifications store and renders a
 * stack of dismissible cards in the bottom-right corner.
 */
import * as Icons from 'lucide-react';
import { Level, dismissToast, useToasts } from '../platform';

const LEVEL_STYLES: Record<Level, { ring: string; icon: any; tint: string }> = {
  info: { ring: 'ring-blue-500/30', icon: Icons.Info, tint: 'text-blue-500' },
  success: { ring: 'ring-emerald-500/30', icon: Icons.CheckCircle2, tint: 'text-emerald-500' },
  warning: { ring: 'ring-amber-500/30', icon: Icons.AlertTriangle, tint: 'text-amber-500' },
  error: { ring: 'ring-red-500/30', icon: Icons.XCircle, tint: 'text-red-500' },
};

export default function ToastLayer() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="fixed z-[9999] bottom-4 right-4 flex flex-col gap-3 pointer-events-none w-[min(360px,calc(100vw-32px))]">
      {toasts.map((t) => {
        const style = LEVEL_STYLES[t.level] || LEVEL_STYLES.info;
        const Icon = style.icon;
        return (
          <div
            key={t.id}
            className={`pointer-events-auto group relative flex items-start gap-3 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 shadow-lg ring-1 ${style.ring} px-4 py-3 animate-fade-in`}
          >
            <Icon className={`w-5 h-5 mt-0.5 ${style.tint}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{t.title}</p>
              {t.body && (
                <p className="text-xs mt-0.5 text-slate-600 dark:text-slate-400 line-clamp-3">{t.body}</p>
              )}
              {t.module && (
                <p className="text-[10px] uppercase tracking-wider mt-1 text-slate-400 dark:text-slate-500">
                  {t.module}
                </p>
              )}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="Dismiss"
            >
              <Icons.X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
