/**
 * Draggable / resizable desktop window chrome for embedded modules.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../lib/utils';
import { WindowViewportProvider } from './WindowViewportContext';
import WindowViewportBody from './WindowViewportBody';
import {
  closeWindow,
  commitWindowLayout,
  focusWindow,
  minimizeWindow,
  moveWindow,
  resizeWindow,
  snapWindow,
  toggleMaximizeWindow,
} from './windowStore';
import { DesktopWindow, DOCK_HEIGHT, MIN_WINDOW_SIZE } from './windowTypes';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = Icons as unknown as Record<
  string,
  React.ComponentType<{ className?: string }>
>;

const SNAP_EDGE_PX = 28;

interface Props {
  win: DesktopWindow;
  isFocused: boolean;
  isDark: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  keepMountedOnMinimize?: boolean;
  children: React.ReactNode;
}

type DragMode = 'move' | 'resize-se' | null;

function AppWindowFrame({ win, isFocused, isDark, containerRef, keepMountedOnMinimize = false, children }: Props) {
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const dragOrigin = useRef({ x: 0, y: 0, winX: 0, winY: 0, winW: 0, winH: 0 });
  const Icon = ICONS[win.icon] || Icons.Folder;

  const containerSize = () => {
    const el = containerRef.current;
    return {
      w: el?.clientWidth ?? window.innerWidth,
      h: el?.clientHeight ?? window.innerHeight,
    };
  };

  const tryEdgeSnap = useCallback(() => {
    const { w, h } = containerSize();
    if (win.x <= SNAP_EDGE_PX) {
      snapWindow(win.id, 'left', w, h);
      return;
    }
    if (win.x + win.width >= w - SNAP_EDGE_PX) {
      snapWindow(win.id, 'right', w, h);
    }
  }, [win.id, win.x, win.width, containerRef]);

  const onPointerDownTitle = (e: React.PointerEvent) => {
    if (win.maximized) return;
    if ((e.target as HTMLElement).closest('[data-window-chrome-control]')) return;
    e.preventDefault();
    focusWindow(win.id);
    dragOrigin.current = {
      x: e.clientX,
      y: e.clientY,
      winX: win.x,
      winY: win.y,
      winW: win.width,
      winH: win.height,
    };
    setDragMode('move');
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerDownResize = (e: React.PointerEvent) => {
    if (win.maximized || win.snapped) return;
    e.preventDefault();
    e.stopPropagation();
    focusWindow(win.id);
    dragOrigin.current = {
      x: e.clientX,
      y: e.clientY,
      winX: win.x,
      winY: win.y,
      winW: win.width,
      winH: win.height,
    };
    setDragMode('resize-se');
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragMode) return;
      const dx = e.clientX - dragOrigin.current.x;
      const dy = e.clientY - dragOrigin.current.y;
      const { w: maxW, h: maxHRaw } = containerSize();
      const maxH = maxHRaw - DOCK_HEIGHT;

      if (dragMode === 'move') {
        const nx = Math.max(0, Math.min(dragOrigin.current.winX + dx, maxW - 120));
        const ny = Math.max(0, Math.min(dragOrigin.current.winY + dy, maxH - 48));
        moveWindow(win.id, nx, ny);
      } else if (dragMode === 'resize-se') {
        const nw = Math.max(MIN_WINDOW_SIZE.width, dragOrigin.current.winW + dx);
        const nh = Math.max(MIN_WINDOW_SIZE.height, dragOrigin.current.winH + dy);
        resizeWindow(win.id, Math.min(nw, maxW - win.x), Math.min(nh, maxH - win.y));
      }
    },
    [dragMode, win.id, win.x, containerRef],
  );

  const onPointerUp = useCallback(() => {
    if (dragMode === 'move') tryEdgeSnap();
    if (dragMode) commitWindowLayout(win.id);
    setDragMode(null);
  }, [dragMode, tryEdgeSnap, win.id]);

  useEffect(() => {
    if (!dragMode) return;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [dragMode, onPointerMove, onPointerUp]);

  if (win.minimized && !keepMountedOnMinimize) return null;

  if (win.minimized) {
    return <div style={{ display: 'none' }}>{children}</div>;
  }

  const maximizedStyle = win.maximized
    ? { left: 0, top: 0, width: '100%', height: `calc(100% - ${DOCK_HEIGHT}px)` }
    : { left: win.x, top: win.y, width: win.width, height: win.height };

  const onTitleDoubleClick = () => {
    const { w, h } = containerSize();
    toggleMaximizeWindow(win.id, w, h);
  };

  return (
    <div
      className={cn(
        'absolute flex flex-col overflow-hidden rounded-xl border shadow-2xl transition-shadow',
        isDark ? 'bg-slate-900 border-slate-700/80' : 'bg-white border-slate-200',
        isFocused ? 'ring-2 ring-blue-500/40 shadow-blue-900/20' : 'shadow-black/30',
        win.snapped && 'ring-1 ring-blue-400/30',
        dragMode && 'select-none',
      )}
      style={{ ...maximizedStyle, zIndex: win.zIndex, position: 'absolute' }}
      onMouseDown={() => focusWindow(win.id)}
    >
      <div
        className={cn(
          'flex h-10 shrink-0 items-center gap-2 border-b px-2',
          isDark ? 'border-slate-800 bg-slate-900/95' : 'border-slate-200 bg-slate-50/95',
          !win.maximized && 'cursor-grab active:cursor-grabbing',
        )}
        onPointerDown={onPointerDownTitle}
        onDoubleClick={onTitleDoubleClick}
      >
        <div
          data-window-chrome-control
          className="flex shrink-0 items-center gap-1"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <WindowChromeButton
            label="Close"
            dotClassName="bg-red-500 hover:bg-red-400"
            onPress={() => closeWindow(win.id)}
          />
          <WindowChromeButton
            label="Minimize"
            dotClassName="bg-amber-400 hover:bg-amber-300"
            onPress={() => minimizeWindow(win.id)}
          />
          <WindowChromeButton
            label="Maximize"
            dotClassName="bg-emerald-500 hover:bg-emerald-400"
            onPress={() => {
              const { w, h } = containerSize();
              toggleMaximizeWindow(win.id, w, h);
            }}
          />
        </div>
        <Icon className={cn('h-4 w-4 shrink-0', isDark ? 'text-blue-400' : 'text-blue-600')} />
        <span className={cn('flex-1 truncate text-xs font-semibold', isDark ? 'text-slate-200' : 'text-slate-800')}>
          {win.title}
        </span>
      </div>

      <WindowViewportBody>{children}</WindowViewportBody>

      {!win.maximized && !win.snapped && (
        <div
          className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
          onPointerDown={onPointerDownResize}
          aria-hidden
        />
      )}
    </div>
  );
}

export default function AppWindow(props: Props) {
  return (
    <WindowViewportProvider windowId={props.win.id}>
      <AppWindowFrame {...props} />
    </WindowViewportProvider>
  );
}

function WindowChromeButton({
  label,
  dotClassName,
  onPress,
}: {
  label: string;
  dotClassName: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onPress();
      }}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-black/10 dark:hover:bg-white/10"
    >
      <span className={cn('h-3 w-3 rounded-full', dotClassName)} />
    </button>
  );
}
