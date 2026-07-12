import type { PackageCategory } from './types';

export function formatApiDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((x: { msg?: string }) => x?.msg || JSON.stringify(x)).join('; ');
  }
  if (detail && typeof detail === 'object' && 'msg' in detail) {
    return String((detail as { msg: string }).msg);
  }
  return 'Request failed';
}

export function pkgIdFromZipName(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, '').replace(/\.zip$/i, '');
  return base.split('-v')[0].split('_v')[0].split('.')[0].trim().toLowerCase() || 'custom_module';
}

export function modulePathFromPackageId(id: string): string {
  return `/${id.replace(/_/g, '-')}`;
}

export const requiredPackageMap: Record<string, { id: string; name: string }> = {
  module_redis: { id: 'redis', name: 'Redis' },
  module_cron: { id: 'memcached', name: 'Memcached' },
  web_manager: { id: 'nginx', name: 'Nginx' },
  database_manager: { id: 'mysql', name: 'MySQL / MariaDB' },
};

const PACKAGE_CATEGORY_MAP: Record<string, PackageCategory> = {
  terminal: 'development',
  docker_manager: 'development',
  cron_manager: 'development',
  file_manager: 'system',
  system_monitor: 'system',
  system_cleaner: 'system',
  backup_manager: 'system',
  package_manager: 'system',
  appstore_manager: 'system',
  panel_settings: 'system',
  web_manager: 'web',
  site_wizard: 'web',
  ssl_manager: 'web',
  dns_manager: 'web',
  database_manager: 'database',
  firewall: 'security',
  users: 'security',
};

export function categoryForPackage(id: string): PackageCategory {
  return PACKAGE_CATEGORY_MAP[id] || 'other';
}

export function filterPackagesByNav(
  catalog: import('./types').Package[],
  nav: import('./types').StoreNav,
): import('./types').Package[] {
  switch (nav) {
    case 'hot': {
      const hot = catalog.filter((p) => p.is_core || p.has_update);
      return (hot.length > 0 ? hot : catalog).slice(0, 12);
    }
    case 'updates':
      return catalog.filter((p) => p.update_status === 'update_available' || p.has_update);
    case 'manage':
      return catalog.filter((p) => p.installed);
    case 'all':
    default:
      return catalog;
  }
}
