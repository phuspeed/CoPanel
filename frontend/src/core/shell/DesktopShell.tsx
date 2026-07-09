/**
 * Deepin-style desktop: wallpaper, search pill, app icon grid.
 */
import { useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { accentForPackageId, packageIdFromModulePath } from '../appStoreAccent';
import { ModuleConfig } from '../registry';
import { cn } from '../../lib/utils';
import { moduleSupportsWindows, openModuleWindow } from './openModuleWindow';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = Icons as unknown as Record<
  string,
  React.ComponentType<{ className?: string }>
>;

type Lang = 'en' | 'vi';

const I18N = {
  en: {
    search: 'Search apps...',
    noMatch: 'No apps match your search.',
    desktop: 'Desktop',
  },
  vi: {
    search: 'Tìm ứng dụng...',
    noMatch: 'Không có ứng dụng phù hợp.',
    desktop: 'Màn hình chính',
  },
} as const;

interface Props {
  modules: ModuleConfig[];
  isDark: boolean;
  language: Lang;
  onOpenLauncher: () => void;
  siteTitle: string;
}

export default function DesktopShell({ modules, isDark, language, onOpenLauncher, siteTitle }: Props) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const tr = I18N[language === 'vi' ? 'vi' : 'en'];

  const filtered = useMemo(() => {
    if (!query.trim()) return modules;
    const q = query.toLowerCase();
    return modules.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.path.toLowerCase().includes(q) ||
        (m.description || '').toLowerCase().includes(q),
    );
  }, [modules, query]);

  const openApp = (mod: ModuleConfig) => {
    if (moduleSupportsWindows(mod.path)) {
      openModuleWindow(mod.path);
      return;
    }
    navigate(mod.path);
  };

  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 flex-col overflow-hidden',
        isDark
          ? 'bg-gradient-to-br from-slate-950 via-indigo-950/80 to-slate-900'
          : 'bg-gradient-to-br from-sky-100 via-indigo-50 to-slate-100',
      )}
    >
      {/* Decorative glow */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-3xl"
        aria-hidden
      />

      <div className="relative z-10 flex shrink-0 flex-col items-center px-4 pb-4 pt-8 md:pt-12">
        <p className={cn('mb-4 text-sm font-semibold', isDark ? 'text-slate-400' : 'text-slate-500')}>
          {siteTitle} · {tr.desktop}
        </p>
        <div className="relative w-full max-w-xl">
          <Icons.Search
            className={cn('absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2', isDark ? 'text-slate-500' : 'text-slate-400')}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={onOpenLauncher}
            placeholder={tr.search}
            className={cn(
              'w-full rounded-full border px-12 py-3 text-sm backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-blue-500/50',
              isDark
                ? 'border-white/10 bg-white/10 text-white placeholder:text-slate-500'
                : 'border-slate-200/80 bg-white/70 text-slate-900 placeholder:text-slate-400',
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered[0]) openApp(filtered[0]);
            }}
          />
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-24 md:px-8">
        <div className="mx-auto grid max-w-5xl grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 md:gap-6 lg:grid-cols-6">
          {filtered.map((mod) => (
            <DesktopIcon key={mod.path} module={mod} isDark={isDark} onOpen={() => openApp(mod)} />
          ))}
          {filtered.length === 0 && (
            <p className={cn('col-span-full text-center text-sm', isDark ? 'text-slate-400' : 'text-slate-500')}>
              {tr.noMatch}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function DesktopIcon({
  module,
  isDark,
  onOpen,
}: {
  module: ModuleConfig;
  isDark: boolean;
  onOpen: () => void;
}) {
  const Icon = ICONS[module.icon] || ICONS.Grid;
  const pkgId = packageIdFromModulePath(module.path);
  const accent = accentForPackageId(pkgId);
  const accentClasses = isDark ? accent.dark : accent.light;

  return (
    <button
      type="button"
      onClick={onOpen}
      onDoubleClick={onOpen}
      className="group flex flex-col items-center gap-2 rounded-2xl p-3 text-center transition-colors hover:bg-white/10"
    >
      <div
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br shadow-inner ring-2 transition-transform group-hover:scale-105 md:h-16 md:w-16',
          accentClasses,
        )}
      >
        <Icon className="h-7 w-7 text-white drop-shadow-md md:h-8 md:w-8" />
      </div>
      <span
        className={cn(
          'max-w-full truncate text-[11px] font-semibold md:text-xs',
          isDark ? 'text-slate-200' : 'text-slate-700',
        )}
      >
        {module.name}
      </span>
    </button>
  );
}
