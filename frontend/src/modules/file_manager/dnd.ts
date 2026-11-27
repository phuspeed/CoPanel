import type { UploadEntry } from './types';

/** dataTransfer type carrying File Manager paths for internal move/copy. */
export const FM_DRAG_MIME = 'application/x-copanel-fm-paths';

export function hasInternalDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(FM_DRAG_MIME);
}

export function hasOsFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes('Files') && !hasInternalDrag(dt);
}

export function readInternalPaths(dt: DataTransfer): string[] {
  try {
    const raw = dt.getData(FM_DRAG_MIME);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/** Ctrl (Windows/Linux) or Alt/Option (macOS) on drop = copy; otherwise move. */
export function dropMode(e: { ctrlKey: boolean; altKey: boolean; metaKey: boolean }): 'copy' | 'move' {
  return e.ctrlKey || e.altKey || e.metaKey ? 'copy' : 'move';
}

type FsEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, err: (e: unknown) => void) => void };
};

function readAll(dir: FsEntry): Promise<FsEntry[]> {
  const reader = dir.createReader?.();
  if (!reader) return Promise.resolve([]);
  const out: FsEntry[] = [];
  return new Promise((resolve) => {
    const step = () =>
      reader.readEntries(
        (batch) => {
          if (!batch.length) resolve(out);
          else {
            out.push(...batch);
            step();
          }
        },
        () => resolve(out),
      );
    step();
  });
}

async function walk(entry: FsEntry, prefix: string, out: UploadEntry[], limit: number): Promise<void> {
  if (out.length >= limit) return;
  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>((resolve) => entry.file!(resolve, () => resolve(null)));
    if (file) out.push({ file, relPath: prefix ? `${prefix}/${file.name}` : undefined });
    return;
  }
  if (entry.isDirectory) {
    const dirPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    for (const child of await readAll(entry)) await walk(child, dirPath, out, limit);
  }
}

/** Files from an OS drop, walking dropped folders (keeps `folder/sub/file` relative paths). */
export async function collectDropEntries(dt: DataTransfer, limit = 5000): Promise<UploadEntry[]> {
  const items = Array.from(dt.items || []);
  const entries = items
    .map((it) => (it.kind === 'file' && 'webkitGetAsEntry' in it ? (it.webkitGetAsEntry() as unknown as FsEntry | null) : null))
    .filter((e): e is FsEntry => !!e);
  if (!entries.length) return Array.from(dt.files || []).map((file) => ({ file }));
  const out: UploadEntry[] = [];
  for (const entry of entries) await walk(entry, '', out, limit);
  return out;
}
