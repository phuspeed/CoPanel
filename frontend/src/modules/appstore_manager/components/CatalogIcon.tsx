import type { ComponentType } from 'react';
import * as Icons from 'lucide-react';

export default function CatalogIcon({
  iconName,
  className,
}: {
  iconName?: string;
  className?: string;
}) {
  const map = Icons as unknown as Record<string, ComponentType<{ className?: string }>>;
  const Cmp = (iconName && map[iconName] ? map[iconName] : Icons.Package) as ComponentType<{ className?: string }>;
  return <Cmp className={className} />;
}
