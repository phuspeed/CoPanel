/**
 * Bottom taskbar — Start menu, running windows, system tray, user account.
 */
import { useEffect, useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { moduleRegistry } from '../registry';
import { cn } from '../../lib/utils';
import { useStore } from '../platform/store';
import { moduleSupportsWindows, openModuleWindow } from './openModuleWindow';
import {
  focusWindow,
  minimizeWindow,
  restoreWindow,
  windowStore,
} from './windowStore';
import { DOCK_HEIGHT } from './windowTypes';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = Icons as unknown as Record<
  string,
  React.ComponentType<{ className?: string }>
>;

type Lang = 'en' | 'vi';

interface ModuleActivityState {
  playing?: boolean;
  playbackState?: 'playing' | 'paused' | null;
  trackName?: string;
  title?: string;
}

interface Props {
  isDark: boolean;
  language: Lang;
  isSuperAdmin?: boolean;
  onToggleTheme: () => void;
  onToggleLanguage: () => void;
  onOpenStartMenu: () => void;
  startMenuOpen: boolean;
  onOpenTasks: () => void;
  onOpenNotifications: () => void;
  onOpenUserMenu: () => void;
  userMenuOpen: boolean;
  runningTasks: number;
  unreadNotifications: number;
  username?: string;
  siteTitle?: string;
  logoDataUrl?: string | null;
}

export default function Dock({
  isDark,
  language,
  isSuperAdmin = false,
  onToggleTheme,
  onToggleLanguage,
  onOpenStartMenu,
  startMenuOpen,
  onOpenTasks,
  onOpenNotifications,
  onOpenUserMenu,
  userMenuOpen,
  runningTasks,
  unreadNotifications,
  username,
  siteTitle = 'CoPanel',
  logoDataUrl,
}: Props) {
  const navigate = useNavigate();
  const { windows, focusedId } = useStore(windowStore, (s) => ({
    windows: s.windows,
    focusedId: s.focusedId,
  }));
  const [now, setNow] = useState(new Date());
  const [moduleActivity, setModuleActivity] = useState<Record<string, ModuleActivityState>>({});

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{
        modulePath?: string;
        playing?: boolean;
        playbackState?: 'playing' | 'paused' | null;
        trackName?: string;
        title?: string;
      }>).detail;
      if (!detail?.modulePath) return;
      setModuleActivity((prev) => ({
        ...prev,
        [detail.modulePath!]: {
          playing: detail.playing,
          playbackState: detail.playbackState ?? (detail.playing ? 'playing' : null),
          trackName: detail.trackName,
          title: detail.title,
        },
      }));
    };
    window.addEventListener('copanel:module-activity', onStatus as EventListener);
    return () => window.removeEventListener('copanel:module-activity', onStatus as EventListener);
  }, []);

  const locale = language === 'vi' ? 'vi-VN' : 'en-US';
  const timeStr = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now);
  const dateStr = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(now);

  const pinnedModules = moduleRegistry
    .getAll()
    .filter((m) => m.pinned && moduleSupportsWindows(m.path) && (!m.adminOnly || isSuperAdmin));
  const windowActivity = useMemo(
    () =>
      windows.reduce<Record<string, ModuleActivityState>>((acc, win) => {
        const activity = moduleActivity[win.modulePath];
        if (activity) acc[win.id] = activity;
        return acc;
      }, {}),
    [moduleActivity, windows],
  );

  const handleDockClick = (modulePath: string) => {
    if (moduleSupportsWindows(modulePath)) {
      const existing = windows.find((w) => w.modulePath === modulePath);
      if (existing) {
        if (existing.minimized) restoreWindow(existing.id);
        else if (focusedId === existing.id) minimizeWindow(existing.id);
        else focusWindow(existing.id);
      } else {
        openModuleWindow(modulePath);
      }
      return;
    }
    navigate(modulePath);
  };

  const userInitial = (username || '?').charAt(0).toUpperCase();

  return (
    <div
      className={cn(
        'fixed bottom-0 left-0 right-0 z-[120] flex items-center gap-2 border-t px-2 backdrop-blur-xl md:px-3',
        isDark ? 'border-slate-800/80 bg-slate-900/85' : 'border-slate-200/80 bg-white/85',
      )}
      style={{ height: DOCK_HEIGHT }}
    >
      {/* Start + pinned quick launch */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          title="Start"
          onClick={onOpenStartMenu}
          className={cn(
            'flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors',
            startMenuOpen
              ? isDark
                ? 'bg-blue-600/40 text-blue-200 ring-1 ring-blue-500/50'
                : 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
              : isDark
                ? 'text-slate-200 hover:bg-slate-800'
                : 'text-slate-700 hover:bg-slate-100',
          )}
        >
          {logoDataUrl ? (
            <img src={logoDataUrl} alt="" className="h-6 w-6 rounded-md object-cover" />
          ) : (
            <div className={cn('flex h-6 w-6 items-center justify-center rounded-md', isDark ? 'bg-blue-600' : 'bg-blue-500')}>
              <Icons.Server className="h-3.5 w-3.5 text-white" />
            </div>
          )}
          <span className="hidden text-[11px] font-bold lg:inline">{siteTitle}</span>
        </button>

        {pinnedModules.map((mod) => {
          const Icon = ICONS[mod.icon] || Icons.Grid;
          return (
            <DockButton
              key={mod.path}
              isDark={isDark}
              active={windows.some((w) => w.modulePath === mod.path && !w.minimized)}
              title={moduleActivity[mod.path]?.title || mod.name}
              onClick={() => handleDockClick(mod.path)}
              playbackState={moduleActivity[mod.path]?.playbackState}
              trackName={moduleActivity[mod.path]?.trackName}
            >
              <Icon className="h-5 w-5" />
            </DockButton>
          );
        })}
      </div>

      <div className={cn('mx-0.5 h-8 w-px shrink-0', isDark ? 'bg-slate-700' : 'bg-slate-200')} />

      {/* Running windows */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {windows.map((win) => {
          const Icon = ICONS[win.icon] || ICONS.Grid;
          const active = focusedId === win.id && !win.minimized;
          const activity = windowActivity[win.id];
          const taskbarLabel = activity?.trackName || win.title;
          return (
            <DockButton
              key={win.id}
              isDark={isDark}
              active={active}
              title={activity?.title || win.title}
              minimized={win.minimized}
              onClick={() => {
                if (win.minimized) restoreWindow(win.id);
                else if (focusedId === win.id) minimizeWindow(win.id);
                else focusWindow(win.id);
              }}
              playbackState={activity?.playbackState}
              trackName={activity?.trackName}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span
                className={cn(
                  'hidden max-w-[100px] truncate text-[10px] font-semibold sm:inline',
                  activity?.playbackState === 'playing' && 'text-emerald-500',
                )}
              >
                {taskbarLabel}
              </span>
            </DockButton>
          );
        })}
      </div>

      {/* System tray */}
      <div className="flex shrink-0 items-center gap-0.5">
        <DockButton isDark={isDark} title="Task Center" onClick={onOpenTasks} badge={runningTasks}>
          <Icons.Activity className="h-4 w-4" />
        </DockButton>
        <DockButton isDark={isDark} title="Notifications" onClick={onOpenNotifications} badge={unreadNotifications}>
          <Icons.Bell className="h-4 w-4" />
        </DockButton>
        <DockButton isDark={isDark} title="Theme" onClick={onToggleTheme}>
          {isDark ? <Icons.Sun className="h-4 w-4" /> : <Icons.Moon className="h-4 w-4" />}
        </DockButton>
        <DockButton isDark={isDark} title="Language" onClick={onToggleLanguage}>
          <span className="text-[10px] font-bold">{language === 'en' ? 'EN' : 'VI'}</span>
        </DockButton>
        <div className={cn('hidden text-right leading-tight md:block md:px-1', isDark ? 'text-slate-300' : 'text-slate-700')}>
          <p className="text-[11px] font-bold tabular-nums">{timeStr}</p>
          <p className={cn('text-[9px]', isDark ? 'text-slate-500' : 'text-slate-400')}>{dateStr}</p>
        </div>
        <button
          type="button"
          title={username || 'Account'}
          onClick={onOpenUserMenu}
          className={cn(
            'ml-1 flex items-center gap-1.5 rounded-xl px-2 py-1.5 transition-colors',
            userMenuOpen
              ? isDark
                ? 'bg-slate-700 text-white ring-1 ring-slate-600'
                : 'bg-slate-200 text-slate-900 ring-1 ring-slate-300'
              : isDark
                ? 'text-slate-300 hover:bg-slate-800'
                : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white',
              isDark ? 'bg-blue-600' : 'bg-blue-500',
            )}
          >
            {userInitial}
          </span>
          <span className={cn('hidden max-w-[72px] truncate text-[10px] font-bold lg:inline', isDark ? 'text-slate-300' : 'text-slate-600')}>
            {username}
          </span>
        </button>
      </div>
    </div>
  );
}

function DockButton({
  children,
  onClick,
  isDark,
  active,
  minimized,
  title,
  badge,
  playbackState,
  trackName,
}: {
  children: React.ReactNode;
  onClick: () => void;
  isDark: boolean;
  active?: boolean;
  minimized?: boolean;
  title?: string;
  badge?: number;
  playbackState?: 'playing' | 'paused' | null;
  trackName?: string;
}) {
  const isPlaying = playbackState === 'playing';
  const isPaused = playbackState === 'paused';

  return (
    <button
      type="button"
      title={title || trackName}
      onClick={onClick}
      className={cn(
        'relative flex shrink-0 items-center gap-1.5 overflow-hidden rounded-xl px-2.5 py-2 transition-colors',
        active
          ? isDark
            ? 'bg-blue-600/30 text-blue-300 ring-1 ring-blue-500/40'
            : 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
          : isDark
            ? 'text-slate-300 hover:bg-slate-800'
            : 'text-slate-600 hover:bg-slate-100',
        minimized && !isPlaying && 'opacity-50',
        isPlaying && 'ring-1 ring-emerald-500/30',
        (isPlaying || isPaused) && 'pr-6',
      )}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-blue-500 px-1 text-[8px] font-bold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {(isPlaying || isPaused) && (
        <span
          className={cn(
            'absolute bottom-1 right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border',
            isPlaying
              ? 'border-emerald-400/50 bg-emerald-500 text-white'
              : isDark
                ? 'border-slate-600 bg-slate-700 text-slate-200'
                : 'border-slate-300 bg-white text-slate-600',
            isPlaying && 'animate-pulse',
          )}
        >
          {isPlaying ? (
            <Icons.Play className="h-2 w-2 fill-current" />
          ) : (
            <Icons.Pause className="h-2 w-2 fill-current" />
          )}
        </span>
      )}
    </button>
  );
}
