import * as Icons from 'lucide-react';
import {
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

export type WizardStep = 'quick' | 'template' | 'domain' | 'database' | 'ssl' | 'review';

const ITEMS: { id: WizardStep; icon: typeof Icons.Wand2 }[] = [
  { id: 'quick', icon: Icons.Zap },
  { id: 'template', icon: Icons.LayoutTemplate },
  { id: 'domain', icon: Icons.Globe },
  { id: 'database', icon: Icons.Database },
  { id: 'ssl', icon: Icons.Shield },
  { id: 'review', icon: Icons.ClipboardCheck },
];

interface Props {
  step: WizardStep;
  onStep: (id: WizardStep) => void;
  isDark: boolean;
  labels: Record<WizardStep, string>;
  title: string;
  subtitle: string;
  disabled?: boolean;
  completed?: Partial<Record<WizardStep, boolean>>;
}

export default function WizardSidebar({
  step,
  onStep,
  isDark,
  labels,
  title,
  subtitle,
  disabled,
  completed,
}: Props) {
  return (
    <aside className={chromeSidebar(isDark)}>
      <div className={chromeSidebarHeader(isDark)}>
        <div className="flex items-center gap-3">
          <div className={chromeSidebarIconBox(isDark)}>
            <Icons.Wand2 className="h-5 w-5 text-sky-500" />
          </div>
          <div className="min-w-0">
            <h1 className={chromeSidebarTitle(isDark)}>{title}</h1>
            <p className={chromeSidebarSubtitle(isDark)}>{subtitle}</p>
          </div>
        </div>
      </div>

      <nav className={chromeSidebarNav()} aria-label="Site Wizard steps">
        {ITEMS.map(({ id, icon: Icon }) => {
          const active = step === id;
          const done = completed?.[id];
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onStep(id)}
              className={cn(chromeNavItem(isDark, active, 'sky'), 'disabled:opacity-50')}
            >
              <Icon
                className={cn(
                  chromeNavIcon(isDark, active, 'sky'),
                  !active && done && 'text-emerald-500',
                )}
              />
              <span className="flex-1 truncate font-medium">{labels[id]}</span>
              {done && !active && <Icons.Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
