import * as Icons from 'lucide-react';
import {
  chromeNavBadge,
  chromeNavIcon,
  chromeNavItem,
  chromeSidebar,
  chromeSidebarHeader,
  chromeSidebarIconBox,
  chromeSidebarNav,
  chromeSidebarSubtitle,
  chromeSidebarTitle,
  chromeAccentIcon,
} from '../../../core/desktopChrome';
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
    <aside className={chromeSidebar(isDark, 'sm')}>
      <div className={chromeSidebarHeader(isDark)}>
        <div className="flex items-center gap-2.5">
          <div className={cn(chromeSidebarIconBox(isDark), 'bg-gradient-to-br from-sky-500 to-cyan-600 border-0 shadow-none')}>
            <Icons.ShoppingBag className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className={chromeSidebarTitle(isDark)}>{tr.title}</p>
            <p className={chromeSidebarSubtitle(isDark)}>{tr.subtitle}</p>
          </div>
        </div>
      </div>

      <nav className={chromeSidebarNav()} aria-label="App Store sections">
        {NAV.map(({ id, icon: Icon }) => {
          const isActive = active === id;
          const badge = id === 'updates' ? updateCount : id === 'manage' ? installedCount : 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className={chromeNavItem(isDark, isActive, 'sky')}
            >
              <Icon className={chromeNavIcon(isDark, isActive, 'sky')} />
              <span className="flex-1 truncate font-medium">{labels[id]}</span>
              {badge > 0 && <span className={chromeNavBadge(isDark, isActive, 'sky')}>{badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className={cn('border-t p-3', isDark ? 'border-slate-800' : 'border-slate-200')}>
        <p className={cn('flex items-center gap-1.5 text-[10px]', isDark ? 'text-slate-500' : 'text-slate-400')}>
          <Icons.Cloud className={cn('h-3 w-3', chromeAccentIcon('sky'))} />
          {tr.live}
        </p>
      </div>
    </aside>
  );
}
