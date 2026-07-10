import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { PackageCategory } from '../types';
import type { AppStoreTranslations } from '../i18n';

interface Props {
  active: PackageCategory | 'all';
  onChange: (cat: PackageCategory | 'all') => void;
  expanded: boolean;
  onToggle: () => void;
  isDark: boolean;
  tr: AppStoreTranslations;
}

const CATEGORIES: PackageCategory[] = ['development', 'system', 'web', 'database', 'security', 'other'];

export default function CategoryFilter({ active, onChange, expanded, onToggle, isDark, tr }: Props) {
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'mx-4 mt-3 flex items-center gap-1 text-xs font-semibold',
          isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-500',
        )}
      >
        <Icons.ChevronDown className="h-3.5 w-3.5" />
        {tr.expandCategories}
      </button>
    );
  }

  return (
    <div className={cn('mx-4 mt-3 rounded-2xl border p-3', isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-slate-50')}>
      <div className="mb-2 flex items-center justify-between">
        <span className={cn('text-[10px] font-bold uppercase tracking-wider', isDark ? 'text-slate-500' : 'text-slate-400')}>
          {tr.expandCategories}
        </span>
        <button type="button" onClick={onToggle} className={cn('text-[10px] font-semibold', isDark ? 'text-slate-400' : 'text-slate-500')}>
          {tr.collapseCategories}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Chip active={active === 'all'} onClick={() => onChange('all')} isDark={isDark}>
          {tr.navAll}
        </Chip>
        {CATEGORIES.map((cat) => (
          <Chip key={cat} active={active === cat} onClick={() => onChange(cat)} isDark={isDark}>
            {tr.categories[cat]}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
  isDark,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  isDark: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
        active
          ? 'bg-blue-600 text-white'
          : isDark
            ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100',
      )}
    >
      {children}
    </button>
  );
}
