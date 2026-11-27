export interface FileItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
  is_symlink?: boolean;
}

export interface BookmarkEntry {
  path: string;
  is_dir: boolean;
  label?: string;
}

export type SortKey = 'name' | 'size' | 'modified';
export type ViewMode = 'grid' | 'list';
export type CreateType = 'file' | 'dir';

export interface ClipboardState {
  paths: string[];
  action: 'cut' | 'copy';
}

export interface PlaceEntry {
  id: string;
  path: string;
  icon: 'root' | 'www' | 'home' | 'copanel' | 'folder';
}

/** What to do when a target name already exists. */
export type ConflictPolicy = 'overwrite' | 'skip' | 'rename';

export interface ConflictRequest {
  kind: 'upload' | 'move' | 'copy';
  names: string[];
  targetDir: string;
}

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'skipped' | 'error' | 'canceled';

export interface UploadTask {
  id: string;
  file: File;
  /** Path below destDir for folder uploads (e.g. `site/css/a.css`). */
  relPath?: string;
  destDir: string;
  policy: ConflictPolicy;
  loaded: number;
  status: UploadStatus;
  error?: string;
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf';

/** Upload source collected from an <input> or a drop (folders keep their relative path). */
export interface UploadEntry {
  file: File;
  relPath?: string;
}
