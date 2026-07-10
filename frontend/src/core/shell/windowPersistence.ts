/**
 * Persist per-module window bounds in localStorage (Phase 3).
 */
import type { DesktopWindow } from './windowTypes';

const STORAGE_KEY = 'copanel_window_layout_v1';

export interface SavedWindowLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized?: boolean;
  snapped?: 'left' | 'right' | null;
}

type LayoutMap = Record<string, SavedWindowLayout>;

function readAll(): LayoutMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LayoutMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map: LayoutMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode */
  }
}

export function loadWindowLayout(modulePath: string): SavedWindowLayout | null {
  const saved = readAll()[modulePath];
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return null;
  return saved;
}

export function saveWindowLayout(win: DesktopWindow): void {
  const map = readAll();
  map[win.modulePath] = {
    x: win.x,
    y: win.y,
    width: win.width,
    height: win.height,
    maximized: win.maximized,
    snapped: win.snapped ?? null,
  };
  writeAll(map);
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced save after drag/resize (300ms). */
export function schedulePersistWindow(win: DesktopWindow): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    saveWindowLayout(win);
    persistTimer = null;
  }, 300);
}

export function clearWindowLayout(modulePath: string): void {
  const map = readAll();
  delete map[modulePath];
  writeAll(map);
}
