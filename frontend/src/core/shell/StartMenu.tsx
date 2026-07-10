/**
 * Windows-style Start menu — apps live here, not as fixed desktop icons.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { accentForPackageId, packageIdFromModulePath } from '../appStoreAccent';
import { ModuleConfig } from '../registry';
import { cn } from '../../lib/utils';
import { moduleSupportsWindows, openModuleWindow } from './openModuleWindow';
import { DOCK_HEIGHT } from './windowTypes';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = Icons as unknown as Record<
  string,
  React.ComponentType<{ className?: string }>
>;

type Lang = 'en' | 'vi';

const I18N = {
  en: {
    start: 'Start',
    search: 'Search apps...',
    pinned: 'Pinned',
    allApps: 'All apps',
    noMatch: 'No apps match your search.',
    close: 'Close',
  },
  vi: {
    start: 'Bắt đầu',
    search: 'Tìm ứng dụng...',
    pinned: 'Ghim',
    allApps: 'Tất cả ứng dụng',
    noMatch: 'Không có ứng dụng phù hợp.',
    close: 'Đóng',
  },
} as const;

interface Props {
  open: boolean;
  onClose: () => void;
  modules: ModuleConfig[];
  getModuleName?: (mod: ModuleConfig) => string;
  isDark: boolean;
  language: Lang;
  siteTitle: string;
  logoDataUrl?: string | null;
}

export default function StartMenu({
  open,
  onClose,
  modules,
  getModuleName,
  isDark,
  language,
  siteTitle,
  logoDataUrl,
}: Props) {
  const tr = I18N[language === 'vi' ? 'vi' : 'en'];
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open, onClose]);

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

  const pinned = useMemo(() => filtered.filter((m) => m.pinned), [filtered]);
  const rest = useMemo(() => filtered.filter((m) => !m.pinned), [filtered]);

  const openApp = (mod: ModuleConfig) => {
    if (moduleSupportsWindows(mod.path)) {
      openModuleWindow(mod.path);
    } else {
      navigate(mod.path);
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        'fixed left-3 z-[130] flex w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl',
        isDark ? 'border-slate-700/80 bg-slate-900/95' : 'border-slate-200 bg-white/95',
      )}
      style={{ bottom: DOCK_HEIGHT + 8, maxHeight: `calc(100vh - ${DOCK_HEIGHT + 24}px)` }}
    >
      {/* Header */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-3 border-b px-4 py-3',
          isDark ? 'border-slate-800 bg-slate-900/80' : 'border-slate-100 bg-slate-50/80',
        )}
      >
        {logoDataUrl ? (
          <img src={logoDataUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
        ) : (
          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', isDark ? 'bg-blue-600' : 'bg-blue-500')}>
            <Icons.Server className="h-4 w-4 text-white" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-sm font-bold', isDark ? 'text-white' : 'text-slate-900')}>{siteTitle}</p>
          <p className={cn('text-[10px]', isDark ? 'text-slate-500' : 'text-slate-400')}>{tr.start}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={cn('rounded-lg p-1.5', isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100')}
          title={tr.close}
        >
          <Icons.X className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 py-2">
        <div className="relative">
          <Icons.Search className={cn('absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2', isDark ? 'text-slate-500' : 'text-slate-400')} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr.search}
            className={cn(
              'w-full rounded-xl border py-2 pl-9 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40',
              isDark
                ? 'border-slate-700 bg-slate-950/60 text-white placeholder:text-slate-500'
                : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400',
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered[0]) openApp(filtered[0]);
            }}
          />
        </div>
      </div>

      {/* App grid */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {pinned.length > 0 && (
          <section className="mb-3">
            <p className={cn('mb-2 px-1 text-[10px] font-bold uppercase tracking-wider', isDark ? 'text-slate-500' : 'text-slate-400')}>
              {tr.pinned}
            </p>
            <div className="grid grid-cols-4 gap-1 sm:grid-cols-5">
              {pinned.map((mod) => (
                <AppTile
                  key={mod.path}
                  mod={mod}
                  label={getModuleName ? getModuleName(mod) : mod.name}
                  isDark={isDark}
                  onOpen={() => openApp(mod)}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <p className={cn('mb-2 px-1 text-[10px] font-bold uppercase tracking-wider', isDark ? 'text-slate-500' : 'text-slate-400')}>
            {tr.allApps}
          </p>
          {rest.length === 0 && pinned.length === 0 ? (
            <p className={cn('py-6 text-center text-xs', isDark ? 'text-slate-500' : 'text-slate-400')}>{tr.noMatch}</p>
          ) : (
            <div className="grid grid-cols-4 gap-1 sm:grid-cols-5">
              {rest.map((mod) => (
                <AppTile
                  key={mod.path}
                  mod={mod}
                  label={getModuleName ? getModuleName(mod) : mod.name}
                  isDark={isDark}
                  onOpen={() => openApp(mod)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function AppTile({
  mod,
  label,
  isDark,
  onOpen,
}: {
  mod: ModuleConfig;
  label: string;
  isDark: boolean;
  onOpen: () => void;
}) {
  const Icon = ICONS[mod.icon] || ICONS.Grid;
  const pkgId = packageIdFromModulePath(mod.path);
  const accent = accentForPackageId(pkgId);
  const accentClasses = isDark ? accent.dark : accent.light;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex flex-col items-center gap-1.5 rounded-xl p-2 transition-colors',
        isDark ? 'hover:bg-slate-800/80' : 'hover:bg-slate-100',
      )}
    >
      <div
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm ring-1 ring-white/10 transition-transform group-hover:scale-105',
          accentClasses,
        )}
      >
        <Icon className="h-5 w-5 text-white drop-shadow" />
      </div>
      <span
        className={cn(
          'max-w-full truncate text-center text-[9px] font-semibold leading-tight',
          isDark ? 'text-slate-300' : 'text-slate-600',
        )}
      >
        {label}
      </span>
    </button>
  );
}
