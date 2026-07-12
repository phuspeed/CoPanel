import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';

export type DockerTab = 'containers' | 'compose' | 'images' | 'networks' | 'volumes';

const ITEMS: { id: DockerTab; icon: typeof Icons.Box }[] = [
  { id: 'containers', icon: Icons.Box },
  { id: 'compose', icon: Icons.FileCode },
  { id: 'images', icon: Icons.Layers },
  { id: 'networks', icon: Icons.Network },
  { id: 'volumes', icon: Icons.HardDrive },
];

interface Props {
  tab: DockerTab;
  onTab: (id: DockerTab) => void;
  isDark: boolean;
  labels: Record<DockerTab, string>;
  title: string;
  subtitle: string;
  counts?: Partial<Record<DockerTab, number>>;
}

export default function DockerManagerSidebar({
  tab,
  onTab,
  isDark,
  labels,
  title,
  subtitle,
  counts,
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
            <Icons.Box className="h-5 w-5 text-blue-500" />
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

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Docker Manager sections">
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
                    ? 'border-blue-500 bg-slate-800 text-white'
                    : 'border-blue-600 bg-white text-slate-900 shadow-sm'
                  : isDark
                    ? 'border-transparent text-slate-300 hover:bg-slate-900/70'
                    : 'border-transparent text-slate-700 hover:bg-white/90',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  active ? 'text-blue-500' : isDark ? 'text-slate-500' : 'text-slate-400',
                )}
              />
              <span className="flex-1 truncate font-medium">{labels[id]}</span>
              {count !== undefined && count > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                    active
                      ? isDark
                        ? 'bg-blue-500/25 text-blue-200'
                        : 'bg-blue-100 text-blue-700'
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
