/**
 * Open a registered module in a desktop window when windowMode is enabled.
 */
import { moduleRegistry } from '../registry';
import { openWindow } from './windowStore';

export function moduleSupportsWindows(modulePath: string): boolean {
  const mod = moduleRegistry.getByPath(modulePath);
  return Boolean(mod?.windowMode);
}

export function openModuleWindow(modulePath: string): string | null {
  const mod = moduleRegistry.getByPath(modulePath);
  if (!mod) return null;

  if (!mod.windowMode) {
    return null;
  }

  const size = mod.defaultWindowSize;
  return openWindow({
    modulePath: mod.path,
    title: mod.name,
    icon: mod.icon,
    width: size?.width,
    height: size?.height,
    singleton: mod.singleton !== false,
  });
}
