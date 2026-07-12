import * as Icons from 'lucide-react';
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
            <Icons.Wand2 className="h-5 w-5 text-violet-500" />
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

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Site Wizard steps">
        {ITEMS.map(({ id, icon: Icon }) => {
          const active = step === id;
          const done = completed?.[id];
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onStep(id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md border-l-2 py-2.5 pl-[10px] pr-3 text-left text-sm transition-colors disabled:opacity-50',
                active
                  ? isDark
                    ? 'border-violet-500 bg-slate-800 text-white'
                    : 'border-violet-600 bg-white text-slate-900 shadow-sm'
                  : isDark
                    ? 'border-transparent text-slate-300 hover:bg-slate-900/70'
                    : 'border-transparent text-slate-700 hover:bg-white/90',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  active ? 'text-violet-500' : done ? 'text-emerald-500' : isDark ? 'text-slate-500' : 'text-slate-400',
                )}
              />
              <span className="flex-1 truncate font-medium">{labels[id]}</span>
              {done && !active && <Icons.Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
