/**
 * Root layout wrapper for modules that support desktop window mode.
 * Use as the outermost element in index.tsx.
 */
import { cn } from '../../lib/utils';
import { useAppShellContext } from '../hooks/useAppShellContext';
import { isLayoutViewportWide } from '../viewportDesktopSite';
import { useIsWindowedModule } from './WindowViewportContext';

interface Props {
  children: React.ReactNode;
  className?: string;
  /** Classic full-page only — max width container */
  constrained?: boolean;
}

export default function ModuleViewport({ children, className, constrained = false }: Props) {
  const { theme } = useAppShellContext();
  const isWindowed = useIsWindowedModule();
  const isDark = theme === 'dark';
  const isClassicMobile = !isWindowed && !isLayoutViewportWide();

  return (
    <div
      className={cn(
        'flex flex-col transition-colors duration-200',
        isWindowed ? 'h-full min-h-0' : isClassicMobile ? 'min-h-0' : 'min-h-screen',
        isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900',
        !isWindowed && constrained && 'mx-auto max-w-7xl',
        className,
      )}
    >
      {children}
    </div>
  );
}
