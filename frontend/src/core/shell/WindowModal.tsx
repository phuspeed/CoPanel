/**
 * Modal overlay scoped to the desktop window viewport when windowed,
 * otherwise falls back to full-viewport fixed overlay (classic mode).
 */
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
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** When false, only the X button or explicit Cancel actions close the modal. Default: true */
  closeOnBackdropClick?: boolean;
}

const MAX_W = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
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

  if (!open) return null;

  const overlay = (
    <div
      className={cn(
        'z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm',
        viewport?.isWindowed ? 'absolute inset-0' : 'fixed inset-0',
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

  if (viewport?.isWindowed && viewport.viewportRef.current) {
    return createPortal(overlay, viewport.viewportRef.current);
  }

  return createPortal(overlay, document.body);
}
