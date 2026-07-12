import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';

export type BackupTab = 'profiles' | 'remotes' | 'cloud_setup';

const ITEMS: { id: BackupTab; icon: typeof Icons.Cloud }[] = [
  { id: 'profiles', icon: Icons.LayoutDashboard },
  { id: 'remotes', icon: Icons.Cloud },
  { id: 'cloud_setup', icon: Icons.Settings },
];

interface Props {
  tab: BackupTab;
  onTab: (id: BackupTab) => void;
  isDark: boolean;
  labels: Record<BackupTab, string>;
  title: string;
  subtitle: string;
  counts?: Partial<Record<BackupTab, number>>;
  oauthConnected?: boolean;
}

export default function BackupManagerSidebar({
  tab,
  onTab,
  isDark,
  labels,
  title,
  subtitle,
  counts,
  oauthConnected,
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
            <Icons.Cloud className="h-5 w-5 text-indigo-500" />
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

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Backup Manager sections">
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
                    ? 'border-indigo-500 bg-slate-800 text-white'
                    : 'border-indigo-600 bg-white text-slate-900 shadow-sm'
                  : isDark
                    ? 'border-transparent text-slate-300 hover:bg-slate-900/70'
                    : 'border-transparent text-slate-700 hover:bg-white/90',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  active ? 'text-indigo-500' : isDark ? 'text-slate-500' : 'text-slate-400',
                )}
              />
              <span className="flex-1 truncate font-medium">{labels[id]}</span>
              {id === 'cloud_setup' && oauthConnected && (
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" title="OAuth connected" />
              )}
              {count !== undefined && count > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                    active
                      ? isDark
                        ? 'bg-indigo-500/25 text-indigo-200'
                        : 'bg-indigo-100 text-indigo-700'
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
