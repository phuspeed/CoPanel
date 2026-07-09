/**
 * Renders all open desktop windows with module components inside.
 */
import { Suspense, useRef } from 'react';
import { moduleRegistry } from '../registry';
import { useStore } from '../platform/store';
import { ShellContextProvider, ShellContextValue } from './ShellContext';
import AppWindow from './AppWindow';
import { windowStore } from './windowStore';

function ModuleLoader() {
  return (
    <div className="flex min-h-[200px] items-center justify-center">
      <svg className="h-6 w-6 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    </div>
  );
}

interface Props {
  shellContext: ShellContextValue;
  isDark: boolean;
}

export default function WindowLayer({ shellContext, isDark }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { windows, focusedId } = useStore(windowStore, (s) => ({
    windows: s.windows,
    focusedId: s.focusedId,
  }));

  if (windows.length === 0) return null;

  return (
    <div ref={containerRef} data-window-layer className="pointer-events-none absolute inset-0 z-[100] overflow-hidden">
      {windows.map((win) => {
        const mod = moduleRegistry.getByPath(win.modulePath);
        if (!mod) return null;
        const Component = mod.component;

        return (
          <div key={win.id} className="pointer-events-auto">
            <AppWindow
              win={win}
              isFocused={focusedId === win.id}
              isDark={isDark}
              containerRef={containerRef}
            >
              <ShellContextProvider value={shellContext}>
                <Suspense fallback={<ModuleLoader />}>
                  <Component />
                </Suspense>
              </ShellContextProvider>
            </AppWindow>
          </div>
        );
      })}
    </div>
  );
}
