/**
 * Desktop window manager types (Phase 1 MVP).
 */

export interface WindowSize {
  width: number;
  height: number;
}

export interface WindowPosition {
  x: number;
  y: number;
}

export interface DesktopWindow {
  id: string;
  /** Module route path e.g. /file-manager */
  modulePath: string;
  title: string;
  icon: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  /** Half-screen snap (Phase 3) */
  snapped: 'left' | 'right' | null;
  /** Bounds saved before maximize / snap for restore */
  restoreBounds: WindowSize & WindowPosition;
}

export interface WindowManagerState {
  windows: DesktopWindow[];
  nextZIndex: number;
  focusedId: string | null;
}

export const WINDOW_LAYER_BASE_Z = 100;
export const DOCK_HEIGHT = 56;

export const DEFAULT_WINDOW_SIZE: WindowSize = { width: 960, height: 640 };
export const MIN_WINDOW_SIZE: WindowSize = { width: 420, height: 320 };
