import { useRef, useState, type HTMLAttributes } from 'react';
import type { FileItem } from '../types';
import type { FileManagerState } from './useFileManager';
import { FM_DRAG_MIME, collectDropEntries, dropMode, hasInternalDrag, hasOsFiles, readInternalPaths } from '../dnd';

export interface ContextMenuRequest {
  x: number;
  y: number;
  item?: FileItem;
}

const LONG_PRESS_MS = 500;

/**
 * Pointer/keyboard-free interactions shared by list and grid views:
 * click / Ctrl / Shift selection, double-click open, context menu, long-press
 * (touch) menu, tap-to-open on touch, drag source, and folder drop targets.
 */
export function useItemInteractions(fm: FileManagerState, openMenu: (req: ContextMenuRequest) => void) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const pointerType = useRef<string>('mouse');
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const suppressClick = useRef(false);

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const ensureSelected = (item: FileItem) => {
    if (!fm.selectedPaths.includes(item.path)) fm.selectItem(item.path);
  };

  const dragPaths = (item: FileItem) => (fm.selectedPaths.includes(item.path) ? fm.selectedPaths : [item.path]);

  const bind = (item: FileItem): HTMLAttributes<HTMLElement> & { draggable: boolean; 'data-fm-item': string } => {
    const attrs: HTMLAttributes<HTMLElement> & { draggable: boolean; 'data-fm-item': string } = {
      'data-fm-item': item.path,
      draggable: true,
      onPointerDown: (e) => {
        pointerType.current = e.pointerType;
      },
      onClick: (e) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        if (pointerType.current === 'touch' && !e.shiftKey && !e.ctrlKey) {
          // Touch: tap opens; when a selection exists, taps toggle it instead.
          if (fm.selectedPaths.length > 0) fm.selectItem(item.path, { ctrl: true });
          else fm.handleOpenItem(item);
          return;
        }
        fm.selectItem(item.path, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
      },
      onDoubleClick: () => {
        if (pointerType.current !== 'touch') fm.handleOpenItem(item);
      },
      onContextMenu: (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelPress();
        ensureSelected(item);
        openMenu({ x: e.clientX, y: e.clientY, item });
      },
      onTouchStart: (e) => {
        const t = e.touches[0];
        if (!t) return;
        cancelPress();
        const x = t.clientX;
        const y = t.clientY;
        press.current = {
          x,
          y,
          fired: false,
          timer: window.setTimeout(() => {
            if (!press.current) return;
            press.current.fired = true;
            suppressClick.current = true;
            ensureSelected(item);
            if (navigator.vibrate) navigator.vibrate(15);
            openMenu({ x, y, item });
          }, LONG_PRESS_MS),
        };
      },
      onTouchMove: (e) => {
        const t = e.touches[0];
        if (press.current && t && (Math.abs(t.clientX - press.current.x) > 10 || Math.abs(t.clientY - press.current.y) > 10)) cancelPress();
      },
      onTouchEnd: (e) => {
        if (press.current?.fired) e.preventDefault();
        cancelPress();
      },
      onTouchCancel: cancelPress,
      onDragStart: (e) => {
        const paths = dragPaths(item);
        if (!fm.selectedPaths.includes(item.path)) fm.selectItem(item.path);
        e.dataTransfer.setData(FM_DRAG_MIME, JSON.stringify(paths));
        e.dataTransfer.setData('text/plain', paths.join('\n'));
        e.dataTransfer.effectAllowed = 'copyMove';
      },
      onDragEnd: () => setDropTarget(null),
    };
    if (item.is_dir) {
      attrs.onDragOver = (e) => {
        if (!hasInternalDrag(e.dataTransfer) && !hasOsFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = hasOsFiles(e.dataTransfer) || dropMode(e) === 'copy' ? 'copy' : 'move';
        if (dropTarget !== item.path) setDropTarget(item.path);
      };
      attrs.onDragLeave = (e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
          setDropTarget((d) => (d === item.path ? null : d));
        }
      };
      attrs.onDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(null);
        void dropOnFolder(e, item.path);
      };
    }
    return attrs;
  };

  /** Handle a drop onto a folder path (items, tree nodes, crumbs). */
  const dropOnFolder = async (e: React.DragEvent, folder: string) => {
    if (hasInternalDrag(e.dataTransfer)) {
      const paths = readInternalPaths(e.dataTransfer).filter((p) => p !== folder);
      if (paths.length) await fm.transferItems(paths, folder, dropMode(e));
    } else if (hasOsFiles(e.dataTransfer)) {
      const entries = await collectDropEntries(e.dataTransfer);
      if (entries.length) await fm.enqueueUploads(entries, folder);
    }
  };

  const isCut = (path: string) => fm.clipboard?.action === 'cut' && fm.clipboard.paths.includes(path);

  return { bind, dropTarget, setDropTarget, dropOnFolder, isCut };
}

export type ItemInteractions = ReturnType<typeof useItemInteractions>;
