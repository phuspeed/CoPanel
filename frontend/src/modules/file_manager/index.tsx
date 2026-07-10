/**
 * File Manager — Deepin / Nautilus-style dual UI (classic + desktop window).
 */
import ModuleViewport from '../../core/shell/ModuleViewport';
import { useIsWindowedModule } from '../../core/shell/WindowViewportContext';
import { cn } from '../../lib/utils';
import FileManagerShell from './components/FileManagerShell';
import { useFileManager } from './hooks/useFileManager';

export default function FileManagerDashboard() {
  const fm = useFileManager();
  const windowed = useIsWindowedModule();

  return (
    <ModuleViewport
      constrained
      className={cn(
        'h-full min-h-0 overflow-hidden',
        windowed ? 'p-0' : 'p-3 md:p-4',
      )}
    >
      <FileManagerShell {...fm} />
    </ModuleViewport>
  );
}
