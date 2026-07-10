import type { FileItem } from './types';
import type { SortKey } from './types';

export function joinPath(parent: string, child: string): string {
  if (!parent || parent === '/') return `/${child}`;
  return `${parent.replace(/[\\/]+$/, '')}/${child}`;
}

export function parentDir(fullPath: string): string {
  const norm = fullPath.replace(/[\\/]+$/, '');
  if (!norm) return '/';
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  if (idx < 0) {
    if (/^[A-Za-z]:$/.test(norm)) return `${norm}\\`;
    return norm;
  }
  if (idx === 0) return '/';
  const candidate = norm.slice(0, idx);
  if (candidate.length === 2 && candidate[1] === ':') return `${candidate}\\`;
  return candidate || '/';
}

export function pathBreadcrumbs(path: string): { label: string; path: string }[] {
  if (!path) return [{ label: '/', path: '/' }];
  const norm = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  if (norm === '/') return [{ label: '/', path: '/' }];
  const parts = norm.split('/').filter(Boolean);
  const crumbs: { label: string; path: string }[] = [{ label: '/', path: '/' }];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : `/${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

export function sortFiles(files: FileItem[], sortKey: SortKey, sortAsc: boolean): FileItem[] {
  const dirs = files.filter((f) => f.is_dir);
  const regular = files.filter((f) => !f.is_dir);
  const compare = (a: FileItem, b: FileItem): number => {
    let result = 0;
    if (sortKey === 'name') result = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    else if (sortKey === 'size') result = a.size - b.size;
    else if (sortKey === 'modified') result = a.modified - b.modified;
    return sortAsc ? result : -result;
  };
  return [...dirs.sort(compare), ...regular.sort(compare)];
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

export function formatDate(timestamp: number): string {
  if (!timestamp) return '—';
  return new Date(timestamp * 1000).toLocaleString();
}

export function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('copanel_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function fileIconKind(name: string, isDir: boolean): 'folder' | 'archive' | 'image' | 'code' | 'file' {
  if (isDir) return 'folder';
  const lower = name.toLowerCase();
  if (lower.endsWith('.zip') || lower.endsWith('.tar') || lower.endsWith('.gz')) return 'archive';
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/.test(lower)) return 'image';
  if (/\.(js|ts|tsx|py|php|json|html|css|sh|yml|yaml|md)$/.test(lower)) return 'code';
  return 'file';
}
