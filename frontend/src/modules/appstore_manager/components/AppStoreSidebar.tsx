import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { StoreNav } from '../types';
import type { AppStoreTranslations } from '../i18n';

interface Props {
  active: StoreNav;
  onChange: (nav: StoreNav) => void;
  isDark: boolean;
  tr: AppStoreTranslations;
  updateCount: number;
  installedCount: number;
}

const NAV: { id: StoreNav; icon: typeof Icons.Flame }[] = [
  { id: 'hot', icon: Icons.Flame },
  { id: 'all', icon: Icons.LayoutGrid },
  { id: 'updates', icon: Icons.RefreshCw },
  { id: 'manage', icon: Icons.Settings },
];

export default function AppStoreSidebar({ active, onChange, isDark, tr, updateCount, installedCount }: Props) {
  const labels: Record<StoreNav, string> = {
    hot: tr.navHot,
    all: tr.navAll,
    updates: tr.navUpdates,
    manage: tr.navManage,
  };

  return (
    <aside
      className={cn(
        'flex w-[200px] shrink-0 flex-col border-r',
        isDark ? 'border-slate-800 bg-slate-900/60' : 'border-slate-200 bg-slate-50/90',
      )}
    >
      <div className={cn('border-b px-4 py-4', isDark ? 'border-slate-800' : 'border-slate-200')}>
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600">
            <Icons.ShoppingBag className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className={cn('truncate text-sm font-bold', isDark ? 'text-slate-100' : 'text-slate-900')}>{tr.title}</p>
            <p className={cn('truncate text-[10px]', isDark ? 'text-slate-500' : 'text-slate-500')}>{tr.subtitle}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {NAV.map(({ id, icon: Icon }) => {
          const isActive = active === id;
          const badge = id === 'updates' ? updateCount : id === 'manage' ? installedCount : 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors',
                isActive
                  ? 'bg-blue-600 text-white shadow-sm'
                  : isDark
                    ? 'text-slate-300 hover:bg-slate-800'
                    : 'text-slate-700 hover:bg-white',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{labels[id]}</span>
              {badge > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                    isActive ? 'bg-white/20 text-white' : isDark ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-100 text-blue-700',
                  )}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className={cn('border-t px-3 py-3 text-[10px]', isDark ? 'border-slate-800 text-slate-500' : 'border-slate-200 text-slate-400')}>
        <span className="inline-flex items-center gap-1 text-emerald-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          {tr.live}
        </span>
      </div>
    </aside>
  );
}
