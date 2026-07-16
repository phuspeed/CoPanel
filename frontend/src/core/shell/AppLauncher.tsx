/**
 * App Launcher — soft-gradient fullscreen grid (homepage-style icon tiles).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { accentForPackageId, packageIdFromModulePath } from '../appStoreAccent';
import { chromeLauncherOverlay } from '../desktopChrome';
import { ModuleConfig, moduleRegistry } from '../registry';
import { cn } from '../../lib/utils';
import { moduleSupportsWindows, openModuleWindow } from './openModuleWindow';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Matches AppStore card accents per theme */
  theme?: 'dark' | 'light';
  desktopMode?: boolean;
}

const ICONS: Record<string, any> = Icons as unknown as Record<string, any>;
type Lang = 'en' | 'vi';

const I18N = {
  en: {
    searchPlaceholder: 'Search apps...',
    closeLauncher: 'Close launcher',
    noMatch: 'No apps match your search.',
    launcherHint: 'App Launcher',
  },
  vi: {
    searchPlaceholder: 'Tìm ứng dụng...',
    closeLauncher: 'Đóng trình khởi chạy',
    noMatch: 'Không có ứng dụng phù hợp từ khóa tìm kiếm.',
    launcherHint: 'Trình khởi chạy ứng dụng',
  },
} as const;

function getIcon(name: string) {
  const Comp = ICONS[name] || ICONS.Grid;
  return Comp;
}

export default function AppLauncher({ open, onClose, theme = 'dark', desktopMode = false }: Props) {
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState<Lang>(() => (localStorage.getItem('copanel_lang') as Lang) || 'en');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const modules = moduleRegistry.getAll();
  const tr = I18N[language === 'vi' ? 'vi' : 'en'];

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setLanguage((localStorage.getItem('copanel_lang') as Lang) || 'en');
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return modules;
    const q = query.toLowerCase();
    return modules.filter(
      (m) => m.name.toLowerCase().includes(q) || m.path.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q),
    );
  }, [modules, query]);

  if (!open) return null;

  return (
    <div
      className={cn('fixed inset-0 z-[210] flex flex-col', isDark ? chromeLauncherOverlay.dark : chromeLauncherOverlay.light)}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex min-h-0 flex-1 flex-col items-center px-4 pb-6 pt-10 md:px-6 md:pt-16"
      >
        <div className="flex h-full min-h-0 w-full max-w-4xl flex-col">
          <div className="relative mb-8 shrink-0 md:mb-10">
            <Icons.Search
              className={cn(
                'absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2',
                isDark ? 'text-slate-400' : 'text-slate-500',
              )}
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr.searchPlaceholder}
              className={cn(
                'w-full rounded-2xl border px-12 py-3 text-base backdrop-blur focus:outline-none',
                isDark
                  ? 'border-white/10 bg-white/10 text-white placeholder:text-slate-400 focus:border-cyan-400'
                  : 'border-white/60 bg-white/70 text-slate-800 placeholder:text-slate-400 shadow-sm focus:border-sky-400',
              )}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'Enter' && filtered[0]) {
                  if (desktopMode && moduleSupportsWindows(filtered[0].path)) {
                    openModuleWindow(filtered[0].path);
                  } else {
                    navigate(filtered[0].path);
                  }
                  onClose();
                }
              }}
            />
            <button
              onClick={onClose}
              className={cn(
                'absolute right-3 top-1/2 -translate-y-1/2',
                isDark ? 'text-slate-300 hover:text-white' : 'text-slate-500 hover:text-slate-800',
              )}
              aria-label={tr.closeLauncher}
              title={tr.launcherHint}
            >
              <Icons.X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <div className="grid grid-cols-3 gap-5 pb-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 md:gap-6">
              {filtered.map((m) => (
                <AppTile
                  key={m.path}
                  module={m}
                  onSelect={onClose}
                  isDark={isDark}
                  desktopMode={desktopMode}
                />
              ))}
              {filtered.length === 0 && (
                <p
                  className={cn(
                    'col-span-full text-center text-sm',
                    isDark ? 'text-slate-300' : 'text-slate-500',
                  )}
                >
                  {tr.noMatch}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AppTile({
  module,
  onSelect,
  isDark,
  desktopMode,
}: {
  module: ModuleConfig;
  onSelect: () => void;
  isDark: boolean;
  desktopMode?: boolean;
}) {
  const Icon = getIcon(module.icon);
  const pkgId = packageIdFromModulePath(module.path);
  const accent = accentForPackageId(pkgId);
  const accentClasses = isDark ? accent.dark : accent.light;

  const handleClick = (e: React.MouseEvent) => {
    if (desktopMode && moduleSupportsWindows(module.path)) {
      e.preventDefault();
      openModuleWindow(module.path);
      onSelect();
      return;
    }
    onSelect();
  };

  const tileClass = cn(
    'group flex flex-col items-center gap-2.5 rounded-2xl p-3 text-center transition-colors',
    isDark ? 'hover:bg-white/10' : 'hover:bg-white/50',
  );

  const inner = (
    <>
      <div
        className={cn(
          'relative flex h-[3.75rem] w-[3.75rem] items-center justify-center rounded-[1.15rem] bg-gradient-to-br shadow-md ring-1 transition-all duration-200 group-hover:scale-105 group-hover:shadow-lg',
          isDark ? 'ring-white/15' : 'ring-black/5',
          accentClasses,
        )}
      >
        <Icon className="relative z-10 h-7 w-7 text-white drop-shadow-md" aria-hidden />
      </div>
      <span
        className={cn(
          'max-w-full truncate text-xs font-semibold',
          isDark ? 'text-white' : 'text-slate-700',
        )}
      >
        {module.name}
      </span>
    </>
  );

  if (desktopMode && moduleSupportsWindows(module.path)) {
    return (
      <button type="button" onClick={handleClick} className={tileClass}>
        {inner}
      </button>
    );
  }

  return (
    <Link to={module.path} onClick={handleClick} className={tileClass}>
      {inner}
    </Link>
  );
}
