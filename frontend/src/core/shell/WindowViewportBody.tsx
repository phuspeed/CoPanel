/**
 * Scrollable module area inside AppWindow — attaches viewportRef for WindowModal.
 */
import { useWindowViewport } from './WindowViewportContext';

export default function WindowViewportBody({ children }: { children: React.ReactNode }) {
  const vp = useWindowViewport();
  return (
    <div
      ref={vp?.viewportRef}
      className="module-window-viewport relative flex min-h-0 flex-1 flex-col overflow-auto"
    >
      {children}
    </div>
  );
}
