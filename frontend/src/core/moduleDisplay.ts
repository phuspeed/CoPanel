import type { ModuleConfig } from './registry';

export type PanelLang = 'en' | 'vi';

/** Display name for a module (manifest labels, then built-in i18n key, then name). */
export function moduleDisplayName(
  mod: ModuleConfig,
  lang: PanelLang,
  builtInNames?: Record<string, string>,
): string {
  const fromManifest = mod.labels?.[lang] || mod.labels?.en;
  if (fromManifest) return fromManifest;
  const key = mod.id || mod.name.toLowerCase().replace(/\s+/g, '_');
  if (builtInNames?.[key]) return builtInNames[key];
  return mod.name;
}

/** Permission key for a module (package id for extensions, snake name for core). */
export function modulePermissionKey(mod: ModuleConfig): string {
  if (mod.extensionId) return mod.extensionId;
  return mod.id || mod.name.toLowerCase().replace(/\s+/g, '_');
}
