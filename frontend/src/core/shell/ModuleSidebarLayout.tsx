/**
 * Responsive module chrome: fixed sidebar on wide / windowed; drawer on classic mobile.
 */
import { useEffect, useState, type ReactNode } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../lib/utils';
import { isLayoutViewportWide } from '../viewportDesktopSite';
import { useIsWindowedModule } from './WindowViewportContext';

interface Props {
  isDark: boolean;
  sidebar: ReactNode;
  children: ReactNode;
  /** Label on the mobile menu bar when the sidebar is collapsed */
  mobileTitle?: string;
  className?: string;
}

export default function ModuleSidebarLayout({
  isDark,
  sidebar,
  children,
  mobileTitle,
  className,
}: Props) {
  const isWindowed = useIsWindowedModule();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewportWide, setViewportWide] = useState(() => isLayoutViewportWide());

  useEffect(() => {
    const onResize = () => setViewportWide(isLayoutViewportWide());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const useDrawer = !isWindowed && !viewportWide;

  useEffect(() => {
    if (viewportWide) setSidebarOpen(false);
  }, [viewportWide]);

  const closeSidebar = () => setSidebarOpen(false);

  if (!useDrawer) {
    return (
      <div className={cn('flex h-full min-h-0 flex-1 overflow-hidden', className)}>
        {sidebar}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    );
  }

  return (
    <div className={cn('relative flex h-full min-h-0 flex-1 flex-col overflow-hidden', className)}>
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 border-b px-3 py-2.5',
          isDark ? 'border-slate-800 bg-slate-950/90' : 'border-slate-200 bg-white',
        )}
      >
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className={cn(
            'inline-flex items-center justify-center rounded-lg p-2',
            isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-100',
          )}
          aria-label="Open module menu"
        >
          <Icons.PanelLeft className="h-5 w-5" />
        </button>
        {mobileTitle ? (
          <span className={cn('truncate text-sm font-semibold', isDark ? 'text-slate-100' : 'text-slate-900')}>
            {mobileTitle}
          </span>
        ) : null}
      </div>

      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-[60] bg-black/45"
          aria-label="Close module menu"
          onClick={closeSidebar}
        />
      ) : null}

      <div
        className={cn(
          'fixed inset-y-0 left-0 z-[61] flex max-w-[min(85vw,280px)] transform shadow-xl transition-transform duration-200 ease-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none',
        )}
        onClick={closeSidebar}
      >
        {sidebar}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
