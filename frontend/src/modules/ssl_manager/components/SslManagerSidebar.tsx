import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';

export type SslTab = 'certificates' | 'issue' | 'custom' | 'auto_renew';

const ITEMS: { id: SslTab; icon: typeof Icons.Shield }[] = [
  { id: 'certificates', icon: Icons.ShieldCheck },
  { id: 'issue', icon: Icons.Zap },
  { id: 'custom', icon: Icons.Key },
  { id: 'auto_renew', icon: Icons.RefreshCw },
];

interface Props {
  tab: SslTab;
  onTab: (id: SslTab) => void;
  isDark: boolean;
  labels: Record<SslTab, string>;
  title: string;
  subtitle: string;
  counts?: Partial<Record<SslTab, number>>;
  autoRenewOn?: boolean;
}

export default function SslManagerSidebar({
  tab,
  onTab,
  isDark,
  labels,
  title,
  subtitle,
  counts,
  autoRenewOn,
}: Props) {
  return (
    <aside
      className={cn(
        'flex w-[248px] shrink-0 flex-col border-r',
        isDark ? 'border-slate-800 bg-slate-950/90' : 'border-slate-200 bg-slate-50/95',
      )}
    >
      <div className={cn('border-b px-5 py-4', isDark ? 'border-slate-800' : 'border-slate-200')}>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg',
              isDark ? 'bg-slate-800' : 'border border-slate-200 bg-white shadow-sm',
            )}
          >
            <Icons.Shield className="h-5 w-5 text-teal-500" />
          </div>
          <div className="min-w-0">
            <h1 className={cn('truncate text-base font-semibold', isDark ? 'text-slate-100' : 'text-slate-900')}>
              {title}
            </h1>
            <p className={cn('line-clamp-2 text-[11px] leading-snug', isDark ? 'text-slate-500' : 'text-slate-500')}>
              {subtitle}
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="SSL Manager sections">
        {ITEMS.map(({ id, icon: Icon }) => {
          const active = tab === id;
          const count = counts?.[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTab(id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md border-l-2 py-2.5 pl-[10px] pr-3 text-left text-sm transition-colors',
                active
                  ? isDark
                    ? 'border-teal-500 bg-slate-800 text-white'
                    : 'border-teal-600 bg-white text-slate-900 shadow-sm'
                  : isDark
                    ? 'border-transparent text-slate-300 hover:bg-slate-900/70'
                    : 'border-transparent text-slate-700 hover:bg-white/90',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  active ? 'text-teal-500' : isDark ? 'text-slate-500' : 'text-slate-400',
                )}
              />
              <span className="flex-1 truncate font-medium">{labels[id]}</span>
              {id === 'auto_renew' && autoRenewOn && (
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Auto-renew on" />
              )}
              {count !== undefined && count > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                    active
                      ? isDark
                        ? 'bg-teal-500/25 text-teal-200'
                        : 'bg-teal-100 text-teal-700'
                      : isDark
                        ? 'bg-slate-800 text-slate-400'
                        : 'bg-slate-200 text-slate-600',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
