import * as Icons from 'lucide-react';
import {
  chromeAccentIcon,
  chromeNavBadge,
  chromeNavIcon,
  chromeNavItem,
  chromeSidebar,
  chromeSidebarHeader,
  chromeSidebarIconBox,
  chromeSidebarNav,
  chromeSidebarSubtitle,
  chromeSidebarTitle,
} from '../../../core/desktopChrome';
import { cn } from '../../../lib/utils';

export type WebManagerTab = 'sites' | 'services' | 'databases' | 'php';

const ITEMS: { id: WebManagerTab; icon: typeof Icons.Globe }[] = [
  { id: 'sites', icon: Icons.Globe },
  { id: 'services', icon: Icons.Server },
  { id: 'databases', icon: Icons.Database },
  { id: 'php', icon: Icons.Cpu },
];

interface Props {
  activeTab: WebManagerTab;
  onTab: (id: WebManagerTab) => void;
  isDark: boolean;
  labels: Record<WebManagerTab, string>;
  title: string;
  subtitle: string;
  counts?: Partial<Record<WebManagerTab, number>>;
}

/** Desktop-style left navigation for Web Manager sections */
export default function WebManagerSidebar({
  activeTab,
  onTab,
  isDark,
  labels,
  title,
  subtitle,
  counts,
}: Props) {
  return (
    <aside className={chromeSidebar(isDark)}>
      <div className={chromeSidebarHeader(isDark)}>
        <div className="flex items-center gap-3">
          <div className={chromeSidebarIconBox(isDark)}>
            <Icons.Globe className={cn('h-5 w-5', chromeAccentIcon('blue'))} />
          </div>
          <div className="min-w-0">
            <h1 className={chromeSidebarTitle(isDark)}>{title}</h1>
            <p className={chromeSidebarSubtitle(isDark)}>{subtitle}</p>
          </div>
        </div>
      </div>

      <nav className={chromeSidebarNav()} aria-label="Web Manager sections">
        {ITEMS.map(({ id, icon: Icon }) => {
          const active = activeTab === id;
          const count = counts?.[id];
          return (
            <button key={id} type="button" onClick={() => onTab(id)} className={chromeNavItem(isDark, active, 'blue')}>
              <Icon className={chromeNavIcon(isDark, active, 'blue')} />
              <span className="flex-1 truncate font-medium">{labels[id]}</span>
              {count !== undefined && count > 0 && (
                <span className={chromeNavBadge(isDark, active, 'blue')}>{count}</span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
