import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import { PLACES, type FileManagerTranslations } from '../i18n';
import type { BookmarkEntry } from '../types';

interface Props {
  isDark: boolean;
  tr: FileManagerTranslations;
  currentPath: string;
  bookmarks: BookmarkEntry[];
  bookmarkBackendMissing: boolean;
  bookmarkPathSet: Set<string>;
  onNavigate: (path: string) => void;
  onOpenBookmark: (b: BookmarkEntry) => void;
  onRemoveBookmark: (path: string) => void;
  onBookmarkFolder: () => void;
}

const placeIcon = {
  root: Icons.HardDrive,
  www: Icons.Globe,
  home: Icons.Home,
  copanel: Icons.Server,
  folder: Icons.Folder,
};

const placeLabel = (tr: FileManagerTranslations, id: string) => {
  if (id === 'root') return tr.placeRoot;
  if (id === 'www') return tr.placeWww;
  if (id === 'home') return tr.placeHome;
  if (id === 'copanel') return tr.placeCopanel;
  return id;
};

export default function FileSidebar({
  isDark,
  tr,
  currentPath,
  bookmarks,
  bookmarkBackendMissing,
  bookmarkPathSet,
  onNavigate,
  onOpenBookmark,
  onRemoveBookmark,
  onBookmarkFolder,
}: Props) {
  return (
    <aside
      className={cn(
        'flex w-[200px] shrink-0 flex-col border-r overflow-hidden',
        isDark ? 'border-slate-800 bg-slate-900/70' : 'border-slate-200 bg-slate-50/95',
      )}
    >
      <div className={cn('border-b px-3 py-3', isDark ? 'border-slate-800' : 'border-slate-200')}>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-blue-600">
            <Icons.FolderOpen className="h-4 w-4 text-white" />
          </div>
          <p className={cn('text-sm font-bold truncate', isDark ? 'text-slate-100' : 'text-slate-900')}>{tr.title}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        <section>
          <p className={cn('px-2 mb-1 text-[10px] font-bold uppercase tracking-wider', isDark ? 'text-slate-500' : 'text-slate-400')}>
            {tr.places}
          </p>
          <nav className="space-y-0.5">
            {PLACES.map((place) => {
              const Icon = placeIcon[place.icon];
              const active = currentPath === place.path || currentPath.startsWith(`${place.path}/`);
              return (
                <button
                  key={place.id}
                  type="button"
                  onClick={() => onNavigate(place.path)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition',
                    active
                      ? 'bg-blue-600 text-white'
                      : isDark
                        ? 'text-slate-300 hover:bg-slate-800'
                        : 'text-slate-700 hover:bg-white',
                  )}
                  title={placeLabel(tr, place.id)}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{placeLabel(tr, place.id)}</span>
                </button>
              );
            })}
          </nav>
        </section>

        <section>
          <div className="flex items-center justify-between gap-1 px-2 mb-1">
            <p className={cn('text-[10px] font-bold uppercase tracking-wider', isDark ? 'text-slate-500' : 'text-slate-400')}>
              {tr.bookmarks}
            </p>
            <button
              type="button"
              disabled={!currentPath || bookmarkBackendMissing}
              onClick={onBookmarkFolder}
              className={cn(
                'rounded p-1 transition disabled:opacity-40',
                currentPath && bookmarkPathSet.has(currentPath)
                  ? 'text-amber-400'
                  : isDark
                    ? 'text-slate-500 hover:text-slate-300'
                    : 'text-slate-400 hover:text-slate-700',
              )}
              title={currentPath && bookmarkPathSet.has(currentPath) ? tr.bookmarkFolderToggle : tr.bookmarkFolder}
            >
              <Icons.Bookmark className={cn('h-3.5 w-3.5', currentPath && bookmarkPathSet.has(currentPath) && 'fill-current')} />
            </button>
          </div>
          {bookmarkBackendMissing ? (
            <p className={cn('px-2 text-[10px] leading-relaxed', isDark ? 'text-amber-400/80' : 'text-amber-700')}>{tr.bookmarksUpgradeHint}</p>
          ) : bookmarks.length === 0 ? (
            <p className={cn('px-2 text-[10px]', isDark ? 'text-slate-600' : 'text-slate-400')}>{tr.bookmarksEmpty}</p>
          ) : (
            <div className="space-y-0.5">
              {bookmarks.map((b) => (
                <div key={b.path} className="group flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onOpenBookmark(b)}
                    className={cn(
                      'flex flex-1 min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition',
                      isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-white',
                    )}
                    title={b.path}
                  >
                    {b.is_dir ? <Icons.Folder className="h-3.5 w-3.5 shrink-0 text-sky-400" /> : <Icons.File className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                    <span className="truncate">{(b.label && b.label.trim()) || b.path.split(/[\\/]/).pop()}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveBookmark(b.path)}
                    className={cn('opacity-0 group-hover:opacity-100 rounded p-1 transition', isDark ? 'hover:bg-slate-800 text-slate-500' : 'hover:bg-slate-200 text-slate-400')}
                  >
                    <Icons.X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
