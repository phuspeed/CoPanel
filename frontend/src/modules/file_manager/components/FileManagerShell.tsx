import { useCallback, useEffect, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { FileManagerState } from '../hooks/useFileManager';
import { useItemInteractions, type ContextMenuRequest } from '../hooks/useItemInteractions';
import ModuleSidebarLayout from '../../../core/shell/ModuleSidebarLayout';
import { collectDropEntries, dropMode, hasInternalDrag, hasOsFiles, readInternalPaths } from '../dnd';
import { isTypingTarget } from '../utils';
import FileModals from './FileModals';
import FileSidebar from './FileSidebar';
import FileToolbar from './FileToolbar';
import FileCommandBar from './FileCommandBar';
import FileGridView from './FileGridView';
import FileListView from './FileListView';
import FileContextMenu from './FileContextMenu';
import ConflictDialog from './ConflictDialog';
import UploadDrawer from './UploadDrawer';
import PreviewLightbox from './PreviewLightbox';

/** Columns in the grid view (for ↑/↓ keyboard moves). */
function gridColumns(container: HTMLElement | null): number {
  const items = container?.querySelectorAll<HTMLElement>('[data-fm-item]');
  if (!items || items.length < 2) return 1;
  const top = items[0].offsetTop;
  let n = 0;
  for (const el of Array.from(items)) {
    if (el.offsetTop !== top) break;
    n += 1;
  }
  return Math.max(1, n);
}

export default function FileManagerShell({ fm }: { fm: FileManagerState }) {
  const { isDark, tr, windowed, currentPath, files, allFilesCount, loading, error, viewMode, selectedPaths, clipboard, selectedSize, focusPath } = fm;

  const [menu, setMenu] = useState<ContextMenuRequest | null>(null);
  const [osDragOver, setOsDragOver] = useState(false);
  const [editPathSignal, setEditPathSignal] = useState(0);
  const [focusFilterSignal, setFocusFilterSignal] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const typeBuffer = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  const closeMenu = useCallback(() => setMenu(null), []);
  const ix = useItemInteractions(fm, setMenu);

  const openUploadPicker = useCallback((kind: 'files' | 'folder') => {
    (kind === 'folder' ? folderInput : fileInput).current?.click();
  }, []);

  // Keep the keyboard-focused item visible.
  useEffect(() => {
    if (!focusPath || !contentRef.current) return;
    const el = contentRef.current.querySelector(`[data-fm-item="${CSS.escape(focusPath)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusPath]);

  // Give the file pane keyboard focus on load / folder change (unless the user is typing somewhere).
  useEffect(() => {
    if (!isTypingTarget(document.activeElement) && !fm.anyModalOpen) rootRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (fm.anyModalOpen || menu || isTypingTarget(e.target)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const lower = key.toLowerCase();
    let handled = true;

    if (ctrl && e.shiftKey && lower === 'n') fm.setCreateType('dir');
    else if (ctrl && lower === 'a') fm.selectAll();
    else if (ctrl && lower === 'c') fm.handleCopy();
    else if (ctrl && lower === 'x') fm.handleCut();
    else if (ctrl && lower === 'v') void fm.handlePaste();
    else if (ctrl && lower === 'l') setEditPathSignal((n) => n + 1);
    else if ((ctrl && lower === 'f') || (!ctrl && key === '/')) setFocusFilterSignal((n) => n + 1);
    else if (key === 'F2') fm.startRename();
    else if (key === 'F5' || (ctrl && lower === 'r')) fm.refresh();
    else if (key === 'Delete') void fm.handleDelete();
    else if ((e.altKey && key === 'ArrowUp') || key === 'Backspace') fm.handleGoUp();
    else if (e.altKey && key === 'ArrowLeft') fm.goBack();
    else if (e.altKey && key === 'ArrowRight') fm.goForward();
    else if (key === 'Enter') {
      const target = files.find((f) => f.path === (focusPath || selectedPaths[0]));
      if (target) fm.handleOpenItem(target);
    } else if (key === 'Escape') {
      if (selectedPaths.length) fm.clearSelection();
      else if (clipboard) fm.setClipboard(null);
      else handled = false;
    } else if (key === 'Home') fm.moveFocus('home', e.shiftKey);
    else if (key === 'End') fm.moveFocus('end', e.shiftKey);
    else if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'ArrowLeft' || key === 'ArrowRight') {
      const cols = viewMode === 'grid' ? gridColumns(contentRef.current) : 1;
      const delta =
        viewMode === 'grid'
          ? { ArrowDown: cols, ArrowUp: -cols, ArrowLeft: -1, ArrowRight: 1 }[key]
          : key === 'ArrowDown'
            ? 1
            : key === 'ArrowUp'
              ? -1
              : 0;
      if (delta) fm.moveFocus(delta, e.shiftKey);
      else handled = false;
    } else if (!ctrl && !e.altKey && key.length === 1 && key !== ' ') {
      const now = Date.now();
      const buf = now - typeBuffer.current.at > 800 ? key : typeBuffer.current.text + key;
      typeBuffer.current = { text: buf, at: now };
      fm.selectByPrefix(buf);
    } else handled = false;

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ---- drag & drop on the pane background (OS uploads into the current folder) ----
  const onPaneDragEnter = (e: React.DragEvent) => {
    if (!hasOsFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setOsDragOver(true);
  };
  const onPaneDragLeave = (e: React.DragEvent) => {
    if (!hasOsFiles(e.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setOsDragOver(false);
  };
  const onPaneDragOver = (e: React.DragEvent) => {
    if (hasOsFiles(e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    } else if (hasInternalDrag(e.dataTransfer)) {
      // Dropping on the background of the same folder is a no-op.
      e.dataTransfer.dropEffect = 'none';
    }
  };
  const onPaneDrop = async (e: React.DragEvent) => {
    dragDepth.current = 0;
    setOsDragOver(false);
    if (!hasOsFiles(e.dataTransfer)) return;
    e.preventDefault();
    const entries = await collectDropEntries(e.dataTransfer);
    if (entries.length) await fm.enqueueUploads(entries, currentPath);
  };

  // Breadcrumb crumbs are drop targets too.
  const crumbDragOver = (e: React.DragEvent, path: string) => {
    if (path === currentPath || (!hasInternalDrag(e.dataTransfer) && !hasOsFiles(e.dataTransfer))) return false;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = hasOsFiles(e.dataTransfer) || dropMode(e) === 'copy' ? 'copy' : 'move';
    return true;
  };
  const crumbDrop = (e: React.DragEvent, path: string) => {
    if (path === currentPath) return;
    e.preventDefault();
    e.stopPropagation();
    if (hasInternalDrag(e.dataTransfer)) {
      const paths = readInternalPaths(e.dataTransfer);
      if (paths.length) void fm.transferItems(paths, path, dropMode(e));
    } else void ix.dropOnFolder(e, path);
  };

  const onPaneClick = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('[data-fm-item]') && !e.ctrlKey && !e.metaKey && !e.shiftKey) fm.clearSelection();
  };
  const onPaneContextMenu = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-fm-item]')) return;
    e.preventDefault();
    fm.clearSelection();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const body = () => {
    if (loading && files.length === 0)
      return (
        <div className="flex h-full min-h-[200px] items-center justify-center gap-2 text-xs text-slate-500">
          <Icons.Loader className="h-5 w-5 animate-spin text-sky-500" />
          {tr.loading}
        </div>
      );
    if (error)
      return (
        <div className="m-3 flex gap-2 rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-400">
          <Icons.AlertCircle className="h-4 w-4 shrink-0" />
          {tr.errorLoading} {error}
        </div>
      );
    if (files.length === 0)
      return (
        <div className={cn('flex h-full min-h-[220px] flex-col items-center justify-center gap-2 text-xs', isDark ? 'text-slate-500' : 'text-slate-400')}>
          <Icons.FolderOpen className="h-10 w-10 opacity-40" />
          {tr.noFiles}
        </div>
      );
    return viewMode === 'grid' ? <FileGridView fm={fm} ix={ix} /> : <FileListView fm={fm} ix={ix} />;
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid="fm-root"
      className={cn(
        'relative flex h-full min-h-0 flex-col overflow-hidden outline-none select-none',
        isDark ? 'text-slate-100' : 'text-slate-900',
        !windowed && 'rounded-2xl border',
        !windowed && (isDark ? 'border-slate-800' : 'border-slate-200'),
      )}
    >
      <input ref={fileInput} type="file" multiple className="hidden" data-testid="fm-upload-input" onChange={fm.handleUploadFile} />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="hidden"
        data-testid="fm-upload-folder-input"
        onChange={fm.handleUploadFolderInput}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ModuleSidebarLayout isDark={isDark} mobileTitle={tr.title} sidebar={<FileSidebar fm={fm} />}>
          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <FileToolbar fm={fm} editPathSignal={editPathSignal} focusFilterSignal={focusFilterSignal} onCrumbDragOver={crumbDragOver} onCrumbDrop={crumbDrop} />
            <FileCommandBar fm={fm} onUploadPicker={openUploadPicker} />

            {clipboard && (
              <div
                data-testid="fm-clipboard-bar"
                className={cn(
                  'flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5 text-[11px]',
                  isDark ? 'border-amber-900/40 bg-amber-950/20 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-900',
                )}
              >
                <span className="flex items-center gap-1.5">
                  {clipboard.action === 'cut' ? <Icons.Scissors className="h-3.5 w-3.5" /> : <Icons.Copy className="h-3.5 w-3.5" />}
                  {clipboard.action === 'cut' ? tr.cutPending(clipboard.paths.length) : tr.copyPending(clipboard.paths.length)}
                </span>
                <span className="flex gap-1.5">
                  <button type="button" onClick={() => void fm.handlePaste()} className="rounded-md bg-amber-600/90 px-2 py-0.5 font-bold text-white hover:bg-amber-500">
                    {tr.paste}
                  </button>
                  <button type="button" onClick={() => fm.setClipboard(null)} className={cn('rounded-md px-2 py-0.5 font-bold', isDark ? 'bg-slate-800' : 'bg-white')}>
                    {tr.cancel}
                  </button>
                </span>
              </div>
            )}

            <div
              ref={contentRef}
              data-testid="fm-pane"
              className={cn('relative min-h-0 flex-1 overflow-auto', isDark ? 'bg-slate-950/20' : 'bg-white')}
              onMouseDown={(e) => {
                if (!isTypingTarget(e.target)) rootRef.current?.focus({ preventScroll: true });
              }}
              onClick={onPaneClick}
              onContextMenu={onPaneContextMenu}
              onDragEnter={onPaneDragEnter}
              onDragLeave={onPaneDragLeave}
              onDragOver={onPaneDragOver}
              onDrop={(e) => void onPaneDrop(e)}
            >
              {osDragOver && (
                <div
                  className={cn(
                    'pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed',
                    isDark ? 'border-sky-500/70 bg-sky-950/50 text-sky-200' : 'border-blue-500/70 bg-blue-50/90 text-blue-700',
                  )}
                >
                  <Icons.UploadCloud className="h-10 w-10 opacity-80" />
                  <span className="text-sm font-semibold">{tr.dropToUploadInto(currentPath)}</span>
                </div>
              )}
              {body()}
            </div>

            <UploadDrawer fm={fm} />

            <footer
              data-testid="fm-status"
              className={cn(
                'flex shrink-0 items-center gap-3 border-t px-3 py-1 text-[10px]',
                isDark ? 'border-slate-800 bg-slate-900/80 text-slate-500' : 'border-slate-200 bg-slate-50 text-slate-500',
              )}
            >
              <span>{fm.filterQuery ? `${files.length} / ${tr.statusItems(allFilesCount)}` : tr.statusItems(allFilesCount)}</span>
              {selectedPaths.length > 0 && <span className={isDark ? 'text-sky-300' : 'text-blue-600'}>{tr.statusSelected(selectedPaths.length, selectedSize)}</span>}
              <span className="ml-auto hidden truncate lg:inline" title={tr.keyboardHint}>
                {tr.keyboardHint}
              </span>
            </footer>
          </div>
        </ModuleSidebarLayout>
      </div>

      <FileModals fm={fm} />
      <ConflictDialog fm={fm} />
      <PreviewLightbox fm={fm} />
      {menu && <FileContextMenu fm={fm} menu={menu} onClose={closeMenu} onUploadPicker={openUploadPicker} />}
    </div>
  );
}
