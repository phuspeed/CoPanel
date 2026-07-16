import * as Icons from 'lucide-react';
import {
  chromeAccentIcon,
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

export type SettingsTab = 'datetime' | 'users' | 'ssh' | 'root' | 'gate' | 'totp' | 'network' | 'branding';

const ITEMS: { id: SettingsTab; icon: typeof Icons.Terminal }[] = [
  { id: 'datetime', icon: Icons.Clock },
  { id: 'users', icon: Icons.Users },
  { id: 'ssh', icon: Icons.Terminal },
  { id: 'root', icon: Icons.KeyRound },
  { id: 'gate', icon: Icons.Shield },
  { id: 'totp', icon: Icons.Smartphone },
  { id: 'network', icon: Icons.Network },
  { id: 'branding', icon: Icons.Palette },
];

interface Props {
  tab: SettingsTab;
  onTab: (id: SettingsTab) => void;
  isDark: boolean;
  labels: Record<SettingsTab, string>;
  title: string;
  subtitle: string;
}

/** Windows / macOS Settings–style left navigation */
export default function SettingsSidebar({ tab, onTab, isDark, labels, title, subtitle }: Props) {
  return (
    <aside className={chromeSidebar(isDark)}>
      <div className={chromeSidebarHeader(isDark)}>
        <div className="flex items-center gap-3">
          <div className={chromeSidebarIconBox(isDark)}>
            <Icons.Settings className={cn('h-5 w-5', chromeAccentIcon('blue'))} />
          </div>
          <div className="min-w-0">
            <h1 className={chromeSidebarTitle(isDark)}>{title}</h1>
            <p className={cn(chromeSidebarSubtitle(isDark), 'truncate')}>{subtitle}</p>
          </div>
        </div>
      </div>
      <nav className={chromeSidebarNav()} aria-label="Settings categories">
        {ITEMS.map(({ id, icon: Icon }) => {
          const active = tab === id;
          return (
            <button key={id} type="button" onClick={() => onTab(id)} className={chromeNavItem(isDark, active, 'blue')}>
              <Icon className={chromeNavIcon(isDark, active, 'blue')} />
              <span className="truncate font-medium">{labels[id]}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
