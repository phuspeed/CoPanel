/**
 * Shared Desktop UI chrome tokens — NAS/ADM-style sidebar + panels.
 * Use with `cn()`; pass `isDark` from useAppShellContext / theme.
 */

import { cn } from '../lib/utils';

export type ChromeAccent = 'blue' | 'cyan' | 'teal' | 'sky';

const ACCENT = {
  blue: {
    border: { dark: 'border-blue-500', light: 'border-blue-600' },
    icon: 'text-blue-500',
    badgeActive: {
      dark: 'bg-blue-500/25 text-blue-200',
      light: 'bg-blue-100 text-blue-700',
    },
    softBg: {
      dark: 'bg-blue-500/15',
      light: 'bg-blue-50',
    },
  },
  cyan: {
    border: { dark: 'border-cyan-500', light: 'border-cyan-600' },
    icon: 'text-cyan-500',
    badgeActive: {
      dark: 'bg-cyan-500/25 text-cyan-200',
      light: 'bg-cyan-100 text-cyan-700',
    },
    softBg: {
      dark: 'bg-cyan-500/15',
      light: 'bg-cyan-50',
    },
  },
  teal: {
    border: { dark: 'border-teal-500', light: 'border-teal-600' },
    icon: 'text-teal-500',
    badgeActive: {
      dark: 'bg-teal-500/25 text-teal-200',
      light: 'bg-teal-100 text-teal-700',
    },
    softBg: {
      dark: 'bg-teal-500/15',
      light: 'bg-teal-50',
    },
  },
  sky: {
    border: { dark: 'border-sky-500', light: 'border-sky-600' },
    icon: 'text-sky-500',
    badgeActive: {
      dark: 'bg-sky-500/25 text-sky-200',
      light: 'bg-sky-100 text-sky-700',
    },
    softBg: {
      dark: 'bg-sky-500/15',
      light: 'bg-sky-50',
    },
  },
} as const;

/** Left module sidebar shell (Atoma / ADM style) */
export function chromeSidebar(isDark: boolean, width: 'sm' | 'md' = 'md') {
  return cn(
    'flex h-full shrink-0 flex-col border-r',
    width === 'sm' ? 'w-[200px]' : 'w-[220px]',
    isDark ? 'border-slate-800 bg-slate-950/95' : 'border-slate-200 bg-[#f4f6f8]',
  );
}

export function chromeSidebarHeader(isDark: boolean) {
  return cn('border-b px-4 py-3.5', isDark ? 'border-slate-800' : 'border-slate-200');
}

export function chromeSidebarIconBox(isDark: boolean) {
  return cn(
    'flex h-9 w-9 items-center justify-center rounded-lg',
    isDark ? 'bg-slate-800' : 'border border-slate-200 bg-white shadow-sm',
  );
}

export function chromeSidebarTitle(isDark: boolean) {
  return cn('truncate text-sm font-semibold', isDark ? 'text-slate-100' : 'text-slate-900');
}

export function chromeSidebarSubtitle(isDark: boolean) {
  return cn('line-clamp-2 text-[11px] leading-snug', isDark ? 'text-slate-500' : 'text-slate-500');
}

export function chromeSidebarNav() {
  return 'flex-1 space-y-0.5 overflow-y-auto p-2';
}

/** Nav item with left accent border (unified Atoma pattern) */
export function chromeNavItem(isDark: boolean, active: boolean, accent: ChromeAccent = 'blue') {
  const a = ACCENT[accent];
  return cn(
    'flex w-full items-center gap-2.5 rounded-md border-l-2 py-2.5 pl-[10px] pr-3 text-left text-sm transition-colors',
    active
      ? isDark
        ? cn(a.border.dark, 'bg-slate-800/90 text-white')
        : cn(a.border.light, 'bg-white text-slate-900 shadow-sm')
      : isDark
        ? 'border-transparent text-slate-300 hover:bg-slate-900/70'
        : 'border-transparent text-slate-700 hover:bg-white/90',
  );
}

export function chromeNavIcon(isDark: boolean, active: boolean, accent: ChromeAccent = 'blue') {
  return cn('h-4 w-4 shrink-0', active ? ACCENT[accent].icon : isDark ? 'text-slate-500' : 'text-slate-400');
}

export function chromeNavBadge(isDark: boolean, active: boolean, accent: ChromeAccent = 'blue') {
  const a = ACCENT[accent];
  return cn(
    'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
    active
      ? isDark
        ? a.badgeActive.dark
        : a.badgeActive.light
      : isDark
        ? 'bg-slate-800 text-slate-400'
        : 'bg-slate-200 text-slate-600',
  );
}

/** Content panel / quadrant surface */
export function chromePanel(isDark: boolean) {
  return cn(
    'rounded-xl border',
    isDark ? 'border-slate-700/80 bg-slate-900/50' : 'border-slate-200 bg-white shadow-sm',
  );
}

export function chromePanelMuted(isDark: boolean) {
  return cn(
    'rounded-xl border',
    isDark ? 'border-slate-700/60 bg-slate-950/40' : 'border-slate-200/90 bg-slate-50/80',
  );
}

export function chromeContentBg(isDark: boolean) {
  return isDark ? 'bg-slate-950' : 'bg-[#fafbfc]';
}

export function chromeAccentIcon(accent: ChromeAccent = 'blue') {
  return ACCENT[accent].icon;
}

/** Soft wallpaper gradients for desktop home / launcher */
export const chromeWallpaper = {
  light: 'bg-gradient-to-r from-[#e8d5d8] via-[#e8eef5] to-[#c8e4e8]',
  dark: 'bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950/40',
} as const;

export const chromeLauncherOverlay = {
  light: 'bg-gradient-to-r from-[#e8d5d8]/90 via-[#e8eef5]/92 to-[#c8e4e8]/90 backdrop-blur-md',
  dark: 'bg-slate-950/75 backdrop-blur-md',
} as const;
