/**
 * Modal overlay scoped to the desktop window viewport when windowed,
 * otherwise falls back to full-viewport fixed overlay (classic mode).
 *
 * AppStore extension bundles compile their own copy of this file and of
 * WindowViewportContext, so the context is always null there. In that case
 * the nearest `.module-window-viewport` ancestor is found through the DOM
 * (hidden anchor span) and the overlay is portaled into it, so the dialog
 * sits inside the app window instead of behind it.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Icons from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppShellContext } from '../hooks/useAppShellContext';
import { useWindowViewport } from './WindowViewportContext';

interface Props {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '5xl';
  /** When false, only the X button or explicit Cancel actions close the modal. Default: true */
  closeOnBackdropClick?: boolean;
}

const MAX_W = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
};

export default function WindowModal({
  open,
  onClose,
  children,
  title,
  className,
  maxWidth = 'lg',
  closeOnBackdropClick = true,
}: Props) {
  const { theme } = useAppShellContext();
  const isDark = theme === 'dark';
  const viewport = useWindowViewport();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [domViewport, setDomViewport] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (viewport?.isWindowed) return;
    const el = anchorRef.current?.closest('.module-window-viewport');
    setDomViewport(el instanceof HTMLElement ? el : null);
  }, [viewport?.isWindowed, open]);

  const anchor = <span ref={anchorRef} hidden aria-hidden="true" />;

  if (!open) return anchor;

  const windowed = Boolean(viewport?.isWindowed || domViewport);

  const overlay = (
    <div
      className={cn(
        'z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm',
        windowed ? 'absolute inset-0' : 'fixed inset-0',
      )}
      onClick={closeOnBackdropClick ? onClose : undefined}
    >
      <div
        className={cn(
          'flex w-full flex-col overflow-hidden rounded-2xl border shadow-2xl',
          MAX_W[maxWidth],
          isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-900',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div
            className={cn(
              'flex items-center justify-between border-b px-4 py-3',
              isDark ? 'border-slate-800' : 'border-slate-200',
            )}
          >
            <h3 className="text-sm font-bold">{title}</h3>
            <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-slate-800/50" aria-label="Close">
              <Icons.X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );

  const target =
    (viewport?.isWindowed ? viewport.viewportRef.current : null) || domViewport || document.body;
  const portaled = createPortal(overlay, target);
  return (
    <>
      {anchor}
      {portaled}
    </>
  );
}
