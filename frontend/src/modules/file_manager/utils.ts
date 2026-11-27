import type { FileItem } from './types';
import type { PreviewKind, SortKey } from './types';

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

/** Error text from a CoPanel API body: `{detail}` or the `{error: {message}}` envelope. */
export function apiErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const d = data as { detail?: unknown; error?: { message?: unknown } };
    if (typeof d.detail === 'string' && d.detail) return d.detail;
    if (d.error && typeof d.error.message === 'string' && d.error.message) return d.error.message;
  }
  return fallback;
}

export function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('copanel_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type FileIconKind = 'folder' | 'archive' | 'image' | 'code' | 'video' | 'audio' | 'pdf' | 'text' | 'file';

function extOf(name: string): string {
  const lower = name.toLowerCase();
  const i = lower.lastIndexOf('.');
  return i > 0 ? lower.slice(i + 1) : '';
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'opus']);
const ARCHIVE_EXT = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar']);
const CODE_EXT = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'php', 'json', 'html', 'htm', 'css', 'scss', 'sh', 'bash',
  'yml', 'yaml', 'md', 'go', 'rs', 'java', 'rb', 'pl', 'lua', 'sql', 'xml', 'vue', 'toml', 'c', 'h', 'cpp',
]);
const TEXT_EXT = new Set([
  'txt', 'log', 'conf', 'cfg', 'ini', 'env', 'csv', 'tsv', 'service', 'timer', 'socket', 'properties',
  'htaccess', 'htpasswd', 'gitignore', 'gitattributes', 'dockerignore', 'editorconfig', 'lock', 'pem', 'crt',
  'key', 'pub', 'list', 'sources', 'rules', 'repo', 'nginx', 'vhost', 'example', 'sample', 'dist', 'bak',
]);
const TEXT_NAMES = new Set(['dockerfile', 'makefile', 'procfile', 'license', 'readme', 'caddyfile', 'vagrantfile', 'crontab', 'hosts', 'authorized_keys', 'known_hosts']);

export function fileIconKind(name: string, isDir: boolean): FileIconKind {
  if (isDir) return 'folder';
  const ext = extOf(name);
  if (ARCHIVE_EXT.has(ext)) return 'archive';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (CODE_EXT.has(ext)) return 'code';
  const lower = name.toLowerCase();
  if (TEXT_EXT.has(ext) || TEXT_NAMES.has(lower) || (lower.startsWith('.') && !lower.slice(1).includes('.'))) return 'text';
  return 'file';
}

/** Browser-previewable media (opened in the lightbox). */
export function previewKind(name: string): PreviewKind | null {
  const ext = extOf(name);
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  return null;
}

/** Files opened in the text editor (configs, code, logs, dotfiles, extension-less names). */
export function isTextLike(name: string): boolean {
  const lower = name.toLowerCase();
  const ext = extOf(name);
  if (CODE_EXT.has(ext) || TEXT_EXT.has(ext)) return true;
  if (TEXT_NAMES.has(lower)) return true;
  if (lower.startsWith('.') && !lower.slice(1).includes('.')) return true; // .env, .bashrc
  return ext === '';
}

export function isZipName(name: string): boolean {
  return extOf(name) === 'zip';
}

/** True for inputs, textareas, selects and contenteditable (keyboard shortcuts stay off). */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Copy text to the clipboard; falls back to execCommand on plain-HTTP panels. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const prevFocus = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  prevFocus?.focus?.({ preventScroll: true });
  return ok;
}

export function baseName(p: string): string {
  const norm = p.replace(/[\\/]+$/, '');
  const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return i >= 0 ? norm.slice(i + 1) : norm;
}

/** True when `child` is `parent` or inside it. */
export function isSameOrInside(child: string, parent: string): boolean {
  const c = child.replace(/[\\/]+$/, '') || '/';
  const p = parent.replace(/[\\/]+$/, '') || '/';
  if (c === p) return true;
  return c.startsWith(p === '/' ? '/' : `${p}/`);
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Resolve what the user typed into the path bar.
 * - Absolute POSIX paths (`/var/www`) and Windows drive paths (`C:\\x`) are used as-is.
 * - Anything else is relative to `currentPath`.
 * `.`/`..` segments and duplicate/trailing slashes are normalized. `~` is NOT expanded.
 * Returns null for empty input. The backend still enforces access rules.
 */
export function resolveTypedPath(input: string, currentPath: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const drive = /^([A-Za-z]:)(?:[\\/]|$)/.exec(raw);
  if (drive) {
    const parts = normalizeSegments(raw.slice(drive[1].length).split(/[\\/]+/));
    return `${drive[1].toUpperCase()}\\${parts.join('\\')}`;
  }
  const isAbs = raw.startsWith('/') || raw.startsWith('\\');
  if (!isAbs) {
    const baseDrive = /^([A-Za-z]:)(?:[\\/]|$)/.exec(currentPath || '');
    if (baseDrive) {
      return resolveTypedPath(`${currentPath.replace(/[\\/]+$/, '')}\\${raw}`, '');
    }
  }
  const base = isAbs ? '' : currentPath || '/';
  const combined = isAbs ? raw : `${base}/${raw}`;
  const parts = normalizeSegments(combined.split(/[\\/]+/));
  return `/${parts.join('/')}`;
}

function normalizeSegments(segments: string[]): string[] {
  const out: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out;
}
