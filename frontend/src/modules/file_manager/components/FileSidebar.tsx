import { useEffect, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { chromeNavIcon, chromeNavItem, chromeSidebarHeader, chromeSidebarTitle } from '../../../core/desktopChrome';
import { cn } from '../../../lib/utils';
import { PLACES, type FileManagerTranslations } from '../i18n';
import type { FileManagerState } from '../hooks/useFileManager';
import FileTree from './FileTree';

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

const WIDTH_KEY = 'copanel_fm_sidebar_w';
const MIN_W = 180;
const MAX_W = 420;

function initialWidth() {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(v) && v >= MIN_W && v <= MAX_W) return v;
  } catch {
    /* ignore */
  }
  return 232;
}

export default function FileSidebar({ fm }: { fm: FileManagerState }) {
  const {
    isDark,
    tr,
    currentPath,
    bookmarks,
    bookmarkBackendMissing,
    bookmarkPathSet,
    navigateTo,
    openBookmark,
    removeBookmarkByPath,
    bookmarkCurrentDirectory,
    fsVersion,
    transferItems,
    enqueueUploads,
  } = fm;
  const [width, setWidth] = useState(initialWidth);
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* ignore */
    }
  }, [width]);

  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { startX: e.clientX, startW: width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const next = drag.current.startW + (e.clientX - drag.current.startX);
    setWidth(Math.max(MIN_W, Math.min(MAX_W, next)));
  };
  const onResizeUp = (e: React.PointerEvent) => {
    drag.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const sectionTitle = cn('mb-1 px-2 text-[10px] font-bold uppercase tracking-widest', isDark ? 'text-slate-500' : 'text-slate-400');
  const currentBookmarked = !!currentPath && bookmarkPathSet.has(currentPath);

  return (
    <aside
      data-testid="fm-sidebar"
      style={{ width }}
      className={cn(
        'relative flex h-full max-w-[85vw] shrink-0 flex-col overflow-hidden border-r',
        isDark ? 'border-slate-800 bg-slate-950/95' : 'border-slate-200 bg-[#f4f6f8]',
      )}
    >
      <div className={chromeSidebarHeader(isDark)}>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-cyan-600">
            <Icons.FolderOpen className="h-4 w-4 text-white" />
          </div>
          <p className={chromeSidebarTitle(isDark)}>{tr.title}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-3">
        <section>
          <p className={sectionTitle}>{tr.places}</p>
          <nav className="space-y-0.5">
            {PLACES.map((place) => {
              const Icon = placeIcon[place.icon];
              const active = currentPath === place.path;
              return (
                <button
                  key={place.id}
                  type="button"
                  onClick={() => navigateTo(place.path)}
                  className={cn(chromeNavItem(isDark, active, 'sky'), 'text-xs')}
                  title={place.path}
                >
                  <Icon className={chromeNavIcon(isDark, active, 'sky')} />
                  <span className="truncate font-medium">{placeLabel(tr, place.id)}</span>
                </button>
              );
            })}
          </nav>
        </section>

        <FileTree
          isDark={isDark}
          title={tr.folders}
          currentPath={currentPath}
          fsVersion={fsVersion}
          onNavigate={navigateTo}
          onTransfer={(paths, dir, mode) => void transferItems(paths, dir, mode)}
          onUpload={(entries, dir) => void enqueueUploads(entries, dir)}
        />

        <section>
          <div className="mb-1 flex items-center justify-between gap-1 px-2">
            <p className={cn(sectionTitle, 'mb-0 px-0')}>{tr.bookmarks}</p>
            <button
              type="button"
              disabled={!currentPath || bookmarkBackendMissing}
              onClick={(e) => {
                e.stopPropagation();
                void bookmarkCurrentDirectory();
              }}
              className={cn(
                'rounded p-1 transition disabled:opacity-40',
                currentBookmarked ? 'text-amber-400' : isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700',
              )}
              title={currentBookmarked ? tr.bookmarkFolderToggle : tr.bookmarkFolder}
            >
              <Icons.Bookmark className={cn('h-3.5 w-3.5', currentBookmarked && 'fill-current')} />
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
                    onClick={() => void openBookmark(b)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition',
                      isDark ? 'text-slate-300 hover:bg-slate-900/70' : 'text-slate-700 hover:bg-white/90',
                    )}
                    title={b.path}
                  >
                    {b.is_dir ? <Icons.Folder className="h-3.5 w-3.5 shrink-0 text-sky-400" /> : <Icons.File className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                    <span className="truncate">{(b.label && b.label.trim()) || b.path.split(/[\\/]/).pop()}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={tr.removeBookmark}
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeBookmarkByPath(b.path);
                    }}
                    className={cn('rounded p-1 opacity-0 transition group-hover:opacity-100 focus:opacity-100', isDark ? 'text-slate-500 hover:bg-slate-800' : 'text-slate-400 hover:bg-slate-200')}
                  >
                    <Icons.X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={tr.sidebarResize}
        title={tr.sidebarResize}
        data-testid="fm-sidebar-resize"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setWidth(232);
        }}
        className={cn('absolute inset-y-0 right-0 w-1.5 cursor-col-resize touch-none transition hover:bg-sky-500/40')}
      />
    </aside>
  );
}
