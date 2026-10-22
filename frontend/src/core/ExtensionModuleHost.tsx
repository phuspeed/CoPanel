/**
 * Host wrapper for AppStore runtime extensions.
 *
 * Extensions ship their own copy of ModuleViewport / WindowViewportContext, so
 * window mode from the panel shell does not propagate. Layout resets for desktop
 * windows live in index.css under `.module-window-viewport .copanel-extension-host`.
 */
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { useIsWindowedModule } from './shell/WindowViewportContext';

interface Props {
  extensionId: string;
  children: ReactNode;
}

export default function ExtensionModuleHost({ extensionId, children }: Props) {
  const isWindowed = useIsWindowedModule();

  return (
    <div
      className={cn(
        'copanel-extension-host',
        isWindowed && 'flex h-full w-full min-h-0 min-w-0 flex-1 flex-col',
      )}
      data-extension-id={extensionId}
    >
      {children}
    </div>
  );
}
