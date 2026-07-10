export interface FileItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
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
