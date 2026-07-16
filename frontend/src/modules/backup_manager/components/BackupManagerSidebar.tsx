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
    <aside className={chromeSidebar(isDark)}>
      <div className={chromeSidebarHeader(isDark)}>
        <div className="flex items-center gap-3">
          <div className={chromeSidebarIconBox(isDark)}>
            <Icons.Cloud className={cn('h-5 w-5', chromeAccentIcon('sky'))} />
          </div>
          <div className="min-w-0">
            <h1 className={chromeSidebarTitle(isDark)}>{title}</h1>
            <p className={chromeSidebarSubtitle(isDark)}>{subtitle}</p>
          </div>
        </div>
      </div>

      <nav className={chromeSidebarNav()} aria-label="Backup Manager sections">
        {ITEMS.map(({ id, icon: Icon }) => {
          const active = tab === id;
          const count = counts?.[id];
          return (
            <button key={id} type="button" onClick={() => onTab(id)} className={chromeNavItem(isDark, active, 'sky')}>
              <Icon className={chromeNavIcon(isDark, active, 'sky')} />
              <span className="flex-1 truncate font-medium">{labels[id]}</span>
              {id === 'cloud_setup' && oauthConnected && (
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" title="OAuth connected" />
              )}
              {count !== undefined && count > 0 && (
                <span className={chromeNavBadge(isDark, active, 'sky')}>{count}</span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
