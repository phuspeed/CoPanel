/**
 * Synology DSM-style App Launcher - a fullscreen overlay grid of apps. Opens
 * from the top-bar grid icon. Includes a quick search box (basic command-
 * palette behavior) so power users can jump anywhere.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { ModuleConfig, moduleRegistry } from '../registry';

interface Props {
  open: boolean;
  onClose: () => void;
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

export default function AppLauncher({ open, onClose }: Props) {
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
    <div className="fixed inset-0 z-[210] bg-slate-950/70 backdrop-blur-md flex flex-col" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex-1 min-h-0 flex flex-col items-center pt-10 md:pt-16 px-4 md:px-6 pb-6">
        <div className="w-full max-w-4xl h-full min-h-0 flex flex-col">
          <div className="relative mb-6 md:mb-8 shrink-0">
            <Icons.Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr.searchPlaceholder}
              className="w-full bg-white/10 border border-white/10 backdrop-blur rounded-2xl px-12 py-3 text-base text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-400"
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'Enter' && filtered[0]) {
                  window.location.href = filtered[0].path;
                  onClose();
                }
              }}
            />
            <button
              onClick={onClose}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-white"
              aria-label={tr.closeLauncher}
              title={tr.launcherHint}
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6 pb-2">
              {filtered.map((m) => (
                <AppTile key={m.path} module={m} onSelect={onClose} />
              ))}
              {filtered.length === 0 && (
                <p className="col-span-full text-center text-sm text-slate-300">{tr.noMatch}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AppTile({ module, onSelect }: { module: ModuleConfig; onSelect: () => void }) {
  const Icon = getIcon(module.icon);
  return (
    <Link
      to={module.path}
      onClick={onSelect}
      className="group flex flex-col items-center text-center gap-2 p-4 rounded-2xl hover:bg-white/10 transition-colors"
    >
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-105 transition-transform">
        <Icon className="w-8 h-8 text-white" />
      </div>
      <span className="text-xs font-semibold text-white max-w-full truncate">{module.name}</span>
    </Link>
  );
}
