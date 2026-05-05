/**
 * Common dashboard widget chrome (header, status pill, body slot). Each
 * widget is a small self-contained card; the dashboard composes them in a
 * responsive grid.
 */
import * as Icons from 'lucide-react';
import { ReactNode } from 'react';

interface Props {
  title: string;
  icon?: keyof typeof Icons;
  status?: 'ok' | 'warn' | 'error' | 'info';
  loading?: boolean;
  action?: { label: string; onClick: () => void };
  children: ReactNode;
}

const STATUS_BADGE: Record<NonNullable<Props['status']>, string> = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
};

export default function Widget({ title, icon = 'Activity', status, loading, action, children }: Props) {
  const Icon = (Icons as any)[icon] || Icons.Activity;
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 flex flex-col gap-3 min-h-[180px] shadow-sm">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="p-2 rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
            <Icon className="w-4 h-4" />
          </span>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_BADGE[status]}`}>
              {status}
            </span>
          )}
          {action && (
            <button
              onClick={action.onClick}
              className="text-[11px] font-bold text-blue-500 hover:text-blue-400"
            >
              {action.label}
            </button>
          )}
        </div>
      </header>
      <div className="flex-1">
        {loading ? <div className="text-xs text-slate-500">Loading...</div> : children}
      </div>
    </section>
  );
}
