import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ICONS = Icons as unknown as Record<string, LucideIcon>;

/** Resolve a Lucide icon component from a manifest/config icon name string. */
export function resolveLucideIcon(iconName: string | undefined): LucideIcon {
  const key = (iconName || '').trim();
  if (key && ICONS[key]) return ICONS[key];
  return Icons.Grid;
}
