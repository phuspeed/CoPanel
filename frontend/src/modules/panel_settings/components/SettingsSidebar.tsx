import * as Icons from 'lucide-react';
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
            <Icons.Settings className="h-5 w-5 text-blue-500" />
          </div>
          <div className="min-w-0">
            <h1 className={cn('truncate text-base font-semibold', isDark ? 'text-slate-100' : 'text-slate-900')}>
              {title}
            </h1>
            <p className={cn('truncate text-[11px]', isDark ? 'text-slate-500' : 'text-slate-500')}>{subtitle}</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Settings categories">
        {ITEMS.map(({ id, icon: Icon }) => {
          const active = tab === id;
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
              <span className="truncate font-medium">{labels[id]}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
