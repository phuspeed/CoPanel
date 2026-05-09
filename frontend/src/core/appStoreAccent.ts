/**
 * Gradient + ring accents for module tiles. Same hashing as AppStore Manager
 * catalog cards so each package id maps to an identical swatch everywhere.
 */

export const CARD_ACCENT: { dark: string; light: string }[] = [
  { dark: 'from-sky-500/25 to-indigo-600/30 ring-sky-500/20', light: 'from-sky-500 to-indigo-600 ring-sky-200/60' },
  { dark: 'from-emerald-500/25 to-teal-600/30 ring-emerald-500/20', light: 'from-emerald-500 to-teal-600 ring-emerald-200/60' },
  { dark: 'from-violet-500/25 to-fuchsia-600/30 ring-violet-500/20', light: 'from-violet-500 to-fuchsia-600 ring-violet-200/60' },
  { dark: 'from-amber-500/25 to-orange-600/30 ring-amber-500/20', light: 'from-amber-500 to-orange-600 ring-amber-200/60' },
  { dark: 'from-cyan-500/25 to-blue-600/30 ring-cyan-500/20', light: 'from-cyan-500 to-blue-600 ring-cyan-200/60' },
];

export function accentForPackageId(id: string): { dark: string; light: string } {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return CARD_ACCENT[Math.abs(h) % CARD_ACCENT.length];
}

/** Route path e.g. /file-manager → AppStore id file_manager */
export function packageIdFromModulePath(path: string): string {
  const slug = path.replace(/^\//, '').replace(/-/g, '_');
  return slug || 'module';
}
