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
    <aside className={chromeSidebar(isDark)}>
      <div className={chromeSidebarHeader(isDark)}>
        <div className="flex items-center gap-3">
          <div className={chromeSidebarIconBox(isDark)}>
            <Icons.Shield className={cn('h-5 w-5', chromeAccentIcon('teal'))} />
          </div>
          <div className="min-w-0">
            <h1 className={chromeSidebarTitle(isDark)}>{title}</h1>
            <p className={chromeSidebarSubtitle(isDark)}>{subtitle}</p>
          </div>
        </div>
      </div>

      <nav className={chromeSidebarNav()} aria-label="SSL Manager sections">
        {ITEMS.map(({ id, icon: Icon }) => {
          const active = tab === id;
          const count = counts?.[id];
          return (
            <button key={id} type="button" onClick={() => onTab(id)} className={chromeNavItem(isDark, active, 'teal')}>
              <Icon className={chromeNavIcon(isDark, active, 'teal')} />
              <span className="flex-1 truncate font-medium">{labels[id]}</span>
              {id === 'auto_renew' && autoRenewOn && (
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" title="Auto-renew on" />
              )}
              {count !== undefined && count > 0 && (
                <span className={chromeNavBadge(isDark, active, 'teal')}>{count}</span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
