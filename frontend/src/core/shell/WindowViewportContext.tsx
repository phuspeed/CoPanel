/**
 * Viewport context for modules rendered inside AppWindow.
 * Used by ModuleViewport and WindowModal to scope layout/overlays.
 */
import { createContext, useContext, useRef } from 'react';

export interface WindowViewportValue {
  windowId: string;
  isWindowed: true;
  viewportRef: React.RefObject<HTMLDivElement>;
}

const WindowViewportContext = createContext<WindowViewportValue | null>(null);

export function WindowViewportProvider({
  windowId,
  children,
}: {
  windowId: string;
  children: React.ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  return (
    <WindowViewportContext.Provider value={{ windowId, isWindowed: true, viewportRef }}>
      {children}
    </WindowViewportContext.Provider>
  );
}

export function useWindowViewport(): WindowViewportValue | null {
  return useContext(WindowViewportContext);
}

/** True when module runs inside a desktop window (not classic full-page Outlet). */
export function useIsWindowedModule(): boolean {
  return useWindowViewport()?.isWindowed === true;
}
