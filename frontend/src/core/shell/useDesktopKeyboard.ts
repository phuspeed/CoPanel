/**
 * Global desktop keyboard shortcuts (Phase 3).
 * Alt+Tab cycle windows, Ctrl+W close, Alt+←/→ snap.
 */
import { useEffect } from 'react';
import {
  closeFocusedWindow,
  cycleFocusWindow,
  getFocusedWindow,
  snapWindow,
} from './windowStore';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

export function useDesktopKeyboard(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      const layer = document.querySelector('[data-window-layer]') as HTMLElement | null;
      const cw = layer?.clientWidth ?? window.innerWidth;
      const ch = layer?.clientHeight ?? window.innerHeight;

      if (e.altKey && e.key === 'Tab') {
        e.preventDefault();
        cycleFocusWindow(e.shiftKey);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
        const focused = getFocusedWindow();
        if (focused) {
          e.preventDefault();
          closeFocusedWindow();
        }
        return;
      }

      const focused = getFocusedWindow();
      if (!focused || e.altKey === false) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        snapWindow(focused.id, 'left', cw, ch);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        snapWindow(focused.id, 'right', cw, ch);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        snapWindow(focused.id, null, cw, ch);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
