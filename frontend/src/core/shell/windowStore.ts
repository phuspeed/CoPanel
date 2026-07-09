/**
 * Desktop window manager store — open/focus/minimize/maximize/close/snap (Phase 3).
 */
import { createStore } from '../platform/store';
import { loadWindowLayout, saveWindowLayout, schedulePersistWindow } from './windowPersistence';
import {
  DEFAULT_WINDOW_SIZE,
  DesktopWindow,
  DOCK_HEIGHT,
  MIN_WINDOW_SIZE,
  WINDOW_LAYER_BASE_Z,
  WindowManagerState,
} from './windowTypes';

function newWindowId(): string {
  return `win-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function cascadeOffset(openCount: number): { x: number; y: number } {
  const step = 28;
  const baseX = 80;
  const baseY = 48;
  return {
    x: baseX + (openCount % 8) * step,
    y: baseY + (openCount % 8) * step,
  };
}

export const windowStore = createStore<WindowManagerState>({
  windows: [],
  nextZIndex: WINDOW_LAYER_BASE_Z,
  focusedId: null,
});

function patchWindows(updater: (windows: DesktopWindow[]) => DesktopWindow[]): void {
  const state = windowStore.getState();
  windowStore.setState({ windows: updater(state.windows) });
}

function persistWin(id: string): void {
  const win = windowStore.getState().windows.find((w) => w.id === id);
  if (win) schedulePersistWindow(win);
}

export function getWindowByModulePath(modulePath: string): DesktopWindow | undefined {
  return windowStore.getState().windows.find((w) => w.modulePath === modulePath && !w.minimized);
}

export function getOpenWindows(): DesktopWindow[] {
  return windowStore.getState().windows;
}

export function getFocusedWindow(): DesktopWindow | undefined {
  const { focusedId, windows } = windowStore.getState();
  return windows.find((w) => w.id === focusedId);
}

export interface OpenWindowOptions {
  modulePath: string;
  title: string;
  icon: string;
  width?: number;
  height?: number;
  singleton?: boolean;
}

export function openWindow(opts: OpenWindowOptions): string {
  const state = windowStore.getState();

  if (opts.singleton !== false) {
    const existing = state.windows.find((w) => w.modulePath === opts.modulePath);
    if (existing) {
      focusWindow(existing.id);
      if (existing.minimized) restoreWindow(existing.id);
      return existing.id;
    }
  }

  const defaultW = Math.max(opts.width ?? DEFAULT_WINDOW_SIZE.width, MIN_WINDOW_SIZE.width);
  const defaultH = Math.max(opts.height ?? DEFAULT_WINDOW_SIZE.height, MIN_WINDOW_SIZE.height);
  const saved = loadWindowLayout(opts.modulePath);
  const offset = cascadeOffset(state.windows.length);

  const x = saved?.x ?? offset.x;
  const y = saved?.y ?? offset.y;
  const width = saved?.width ?? defaultW;
  const height = saved?.height ?? defaultH;
  const id = newWindowId();
  const zIndex = state.nextZIndex + 1;

  const win: DesktopWindow = {
    id,
    modulePath: opts.modulePath,
    title: opts.title,
    icon: opts.icon,
    x,
    y,
    width,
    height,
    zIndex,
    minimized: false,
    maximized: saved?.maximized ?? false,
    snapped: saved?.snapped ?? null,
    restoreBounds: { x, y, width, height },
  };

  windowStore.setState({
    windows: [...state.windows, win],
    nextZIndex: zIndex,
    focusedId: id,
  });

  if (win.snapped) {
    // Re-apply snap geometry on next frame when container is measured
    requestAnimationFrame(() => {
      const el = document.querySelector('[data-window-layer]') as HTMLElement | null;
      if (el) snapWindow(id, win.snapped, el.clientWidth, el.clientHeight);
    });
  } else if (win.maximized) {
    requestAnimationFrame(() => {
      const el = document.querySelector('[data-window-layer]') as HTMLElement | null;
      if (el) applyMaximizeGeometry(id, el.clientWidth, el.clientHeight);
    });
  }

  saveWindowLayout(win);
  return id;
}

function applyMaximizeGeometry(id: string, containerW: number, containerH: number): void {
  const h = containerH - DOCK_HEIGHT;
  patchWindows((windows) =>
    windows.map((w) => {
      if (w.id !== id) return w;
      if (!w.maximized) return w;
      return { ...w, x: 0, y: 0, width: containerW, height: h, snapped: null };
    }),
  );
}

export function closeWindow(id: string): void {
  const state = windowStore.getState();
  const next = state.windows.filter((w) => w.id !== id);
  const focusedId =
    state.focusedId === id ? (next[next.length - 1]?.id ?? null) : state.focusedId;
  windowStore.setState({ windows: next, focusedId });
}

export function closeFocusedWindow(): boolean {
  const { focusedId } = windowStore.getState();
  if (!focusedId) return false;
  closeWindow(focusedId);
  return true;
}

export function focusWindow(id: string): void {
  const state = windowStore.getState();
  const target = state.windows.find((w) => w.id === id);
  if (!target) return;
  const zIndex = state.nextZIndex + 1;
  patchWindows((windows) =>
    windows.map((w) => (w.id === id ? { ...w, zIndex } : w)),
  );
  windowStore.setState({ nextZIndex: zIndex, focusedId: id });
}

/** Alt+Tab — cycle visible windows. */
export function cycleFocusWindow(reverse = false): void {
  const state = windowStore.getState();
  const visible = state.windows.filter((w) => !w.minimized);
  if (visible.length === 0) return;
  const currentIdx = visible.findIndex((w) => w.id === state.focusedId);
  const start = currentIdx >= 0 ? currentIdx : 0;
  const delta = reverse ? -1 : 1;
  const nextIdx = (start + delta + visible.length) % visible.length;
  focusWindow(visible[nextIdx].id);
}

export function minimizeWindow(id: string): void {
  patchWindows((windows) =>
    windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
  );
  const state = windowStore.getState();
  if (state.focusedId === id) {
    const visible = state.windows.filter((w) => w.id !== id && !w.minimized);
    windowStore.setState({ focusedId: visible[visible.length - 1]?.id ?? null });
  }
}

export function restoreWindow(id: string): void {
  patchWindows((windows) =>
    windows.map((w) => (w.id === id ? { ...w, minimized: false } : w)),
  );
  focusWindow(id);
}

export function toggleMaximizeWindow(id: string, containerW?: number, containerH?: number): void {
  patchWindows((windows) =>
    windows.map((w) => {
      if (w.id !== id) return w;
      if (w.maximized) {
        return {
          ...w,
          maximized: false,
          snapped: null,
          x: w.restoreBounds.x,
          y: w.restoreBounds.y,
          width: w.restoreBounds.width,
          height: w.restoreBounds.height,
        };
      }
      const cw = containerW ?? window.innerWidth;
      const ch = (containerH ?? window.innerHeight) - DOCK_HEIGHT;
      return {
        ...w,
        maximized: true,
        snapped: null,
        restoreBounds: { x: w.x, y: w.y, width: w.width, height: w.height },
        x: 0,
        y: 0,
        width: cw,
        height: ch,
      };
    }),
  );
  focusWindow(id);
  persistWin(id);
}

export function snapWindow(
  id: string,
  snap: 'left' | 'right' | null,
  containerW: number,
  containerH: number,
): void {
  const h = containerH - DOCK_HEIGHT;
  const halfW = Math.floor(containerW / 2);

  patchWindows((windows) =>
    windows.map((w) => {
      if (w.id !== id) return w;
      if (!snap) {
        if (w.snapped) {
          return {
            ...w,
            snapped: null,
            maximized: false,
            x: w.restoreBounds.x,
            y: w.restoreBounds.y,
            width: w.restoreBounds.width,
            height: w.restoreBounds.height,
          };
        }
        return { ...w, snapped: null };
      }
      return {
        ...w,
        maximized: false,
        snapped: snap,
        restoreBounds: w.snapped ? w.restoreBounds : { x: w.x, y: w.y, width: w.width, height: w.height },
        x: snap === 'left' ? 0 : halfW,
        y: 0,
        width: halfW,
        height: h,
      };
    }),
  );
  focusWindow(id);
  persistWin(id);
}

export function moveWindow(id: string, x: number, y: number): void {
  patchWindows((windows) =>
    windows.map((w) =>
      w.id === id
        ? { ...w, x, y, snapped: null, maximized: false, restoreBounds: { ...w.restoreBounds, x, y } }
        : w,
    ),
  );
}

export function resizeWindow(id: string, width: number, height: number, x?: number, y?: number): void {
  const w = Math.max(width, MIN_WINDOW_SIZE.width);
  const h = Math.max(height, MIN_WINDOW_SIZE.height);
  patchWindows((windows) =>
    windows.map((item) => {
      if (item.id !== id) return item;
      const next = {
        ...item,
        width: w,
        height: h,
        snapped: null,
        maximized: false,
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
      };
      return {
        ...next,
        restoreBounds: { x: next.x, y: next.y, width: next.width, height: next.height },
      };
    }),
  );
}

export function commitWindowLayout(id: string): void {
  persistWin(id);
}
