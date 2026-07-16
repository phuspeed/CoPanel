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
    <aside className={chromeSidebar(isDark)}>
      <div className={chromeSidebarHeader(isDark)}>
        <div className="flex items-center gap-3">
          <div className={chromeSidebarIconBox(isDark)}>
            <Icons.Box className={cn('h-5 w-5', chromeAccentIcon('blue'))} />
          </div>
          <div className="min-w-0">
            <h1 className={chromeSidebarTitle(isDark)}>{title}</h1>
            <p className={chromeSidebarSubtitle(isDark)}>{subtitle}</p>
          </div>
        </div>
      </div>

      <nav className={chromeSidebarNav()} aria-label="Docker Manager sections">
        {ITEMS.map(({ id, icon: Icon }) => {
          const active = tab === id;
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
