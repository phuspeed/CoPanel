import { useCallback, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { FileItem } from '../types';
import type { FileManagerState } from '../hooks/useFileManager';
import FileModals from './FileModals';
import FileSidebar from './FileSidebar';
import ModuleSidebarLayout from '../../../core/shell/ModuleSidebarLayout';
import FileToolbar from './FileToolbar';
import FileGridView from './FileGridView';
import FileListView from './FileListView';
import FileContextMenu, { type FileContextMenuState } from './FileContextMenu';

export default function FileManagerShell(fm: FileManagerState) {
  const {
    isDark,
    tr,
    windowed,
    currentPath,
    files,
    allFilesCount,
    loading,
    error,
    sortKey,
    sortAsc,
    viewMode,
    setViewMode,
    filterQuery,
    setFilterQuery,
    selectedPaths,
    clipboard,
    setClipboard,
    uploadProgress,
    bookmarkPathSet,
    bookmarkBackendMissing,
    bookmarks,
    canGoBack,
    canGoForward,
    selectedSize,
    navigateTo,
    goBack,
    goForward,
    handleGoUp,
    handleOpenItem,
    handleToggleSelect,
    handleSelectAll,
    handleSort,
    handleEditFile,
    handleDownloadFile,
    handleUploadFile,
    handleUploadFiles,
    handleCut,
    handleCopy,
    handlePaste,
    handleDelete,
    bookmarkSelection,
    bookmarkCurrentDirectory,
    openBookmark,
    removeBookmarkByPath,
    toggleBookmarkForItem,
    refresh,
    clearSelection,
    setCreateType,
    setRenamingItem,
    setRenameValue,
  } = fm;

  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openItemContextMenu = useCallback((e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedPaths.includes(item.path)) {
      handleToggleSelect(item.path, false);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, kind: 'item', item });
  }, [selectedPaths, handleToggleSelect]);

  const openBlankContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-fm-item]')) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, kind: 'blank' });
  }, []);

  const contextItem = contextMenu?.item;

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    dragDepthRef.current += 1;
    setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragOver(false);
    const dropped = e.dataTransfer.files;
    if (dropped?.length) void handleUploadFiles(dropped);
  };

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden select-none',
        isDark ? 'text-slate-100' : 'text-slate-900',
        !windowed && 'rounded-2xl border',
        !windowed && (isDark ? 'border-slate-800' : 'border-slate-200'),
      )}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ModuleSidebarLayout
          isDark={isDark}
          mobileTitle={tr.title}
          sidebar={
            <FileSidebar
              isDark={isDark}
              tr={tr}
              currentPath={currentPath}
              bookmarks={bookmarks}
              bookmarkBackendMissing={bookmarkBackendMissing}
              bookmarkPathSet={bookmarkPathSet}
              onNavigate={navigateTo}
              onOpenBookmark={(b) => void openBookmark(b)}
              onRemoveBookmark={(p) => void removeBookmarkByPath(p)}
              onBookmarkFolder={() => void bookmarkCurrentDirectory()}
            />
          }
        >
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <FileToolbar
            isDark={isDark}
            tr={tr}
            currentPath={currentPath}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            viewMode={viewMode}
            filterQuery={filterQuery}
            onBack={goBack}
            onForward={goForward}
            onUp={handleGoUp}
            onRefresh={refresh}
            onNavigate={navigateTo}
            onViewMode={setViewMode}
            onFilterQuery={setFilterQuery}
            onCreateFile={() => setCreateType('file')}
            onCreateDir={() => setCreateType('dir')}
            onUpload={handleUploadFile}
          />

          {uploadProgress !== null && (
            <div className={cn('shrink-0 border-b px-3 py-2', isDark ? 'border-slate-800 bg-blue-950/20' : 'border-blue-100 bg-blue-50')}>
              <div className="flex justify-between text-[10px] font-semibold mb-1">
                <span>{tr.uploading}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className={cn('h-1.5 rounded-full overflow-hidden', isDark ? 'bg-slate-800' : 'bg-slate-200')}>
                <div className="h-full bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          {clipboard && (
            <div className={cn('shrink-0 flex items-center justify-between gap-2 border-b px-3 py-2 text-xs', isDark ? 'border-amber-900/40 bg-amber-950/20 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-900')}>
              <span>
                {clipboard.paths.length} {tr.itemsTo} {clipboard.action === 'cut' ? tr.cut : tr.copy}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => void handlePaste()} className="rounded-lg bg-amber-600/80 px-2.5 py-1 font-bold text-white hover:bg-amber-500">
                  {tr.paste}
                </button>
                <button type="button" onClick={() => setClipboard(null)} className={cn('rounded-lg px-2.5 py-1 font-bold', isDark ? 'bg-slate-800' : 'bg-slate-200')}>
                  {tr.cancel}
                </button>
              </div>
            </div>
          )}

          <div
            className={cn('relative min-h-0 flex-1 overflow-auto', isDark ? 'bg-slate-950/20' : 'bg-white')}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            {dragOver && (
              <div
                className={cn(
                  'pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 border-2 border-dashed',
                  isDark ? 'border-blue-500/70 bg-blue-950/40 text-blue-200' : 'border-blue-500/70 bg-blue-50/90 text-blue-700',
                )}
              >
                <Icons.UploadCloud className="h-10 w-10 opacity-80" />
                <span className="text-sm font-semibold">{tr.dropToUpload}</span>
              </div>
            )}
            {loading && files.length === 0 ? (
              <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-500">
                <Icons.Loader className="h-5 w-5 animate-spin text-blue-500" />
                {tr.loading}
              </div>
            ) : error ? (
              <div className="m-3 rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-400 flex gap-2">
                <Icons.AlertCircle className="h-4 w-4 shrink-0" />
                {tr.errorLoading} {error}
              </div>
            ) : viewMode === 'grid' ? (
              <FileGridView
                isDark={isDark}
                tr={tr}
                files={files}
                selectedPaths={selectedPaths}
                onOpen={handleOpenItem}
                onToggleSelect={handleToggleSelect}
                onItemContextMenu={openItemContextMenu}
                onBlankContextMenu={openBlankContextMenu}
              />
            ) : (
              <FileListView
                isDark={isDark}
                tr={tr}
                files={files}
                selectedPaths={selectedPaths}
                sortKey={sortKey}
                sortAsc={sortAsc}
                bookmarkPathSet={bookmarkPathSet}
                bookmarksUiEnabled={!bookmarkBackendMissing}
                onSort={handleSort}
                onOpen={handleOpenItem}
                onToggleSelect={handleToggleSelect}
                onSelectAll={handleSelectAll}
                onEdit={handleEditFile}
                onDownload={handleDownloadFile}
                onRename={(item) => {
                  setRenameValue(item.name);
                  setRenamingItem(item);
                }}
                onBookmarkToggle={(item) => void toggleBookmarkForItem(item)}
                onCut={handleCut}
                onCopy={handleCopy}
                onDelete={handleDelete}
                onItemContextMenu={openItemContextMenu}
                onBlankContextMenu={openBlankContextMenu}
              />
            )}
          </div>

          <footer
            className={cn(
              'shrink-0 flex items-center justify-between border-t px-3 py-1.5 text-[10px] font-mono',
              isDark ? 'border-slate-800 bg-slate-900/80 text-slate-500' : 'border-slate-200 bg-slate-50 text-slate-500',
            )}
          >
            <span>{tr.statusItems(allFilesCount)}</span>
            <span className="truncate max-w-[60%]">{currentPath || '/'}</span>
            <span>
              {selectedPaths.length > 0 ? tr.statusSelected(selectedPaths.length, selectedSize) : ' '}
            </span>
          </footer>
        </div>
        </ModuleSidebarLayout>
      </div>

      <FileModals fm={fm} />

      {contextMenu && (
        <FileContextMenu
          menu={contextMenu}
          isDark={isDark}
          tr={tr}
          item={contextItem}
          hasClipboard={!!clipboard}
          bookmarksUiEnabled={!bookmarkBackendMissing}
          bookmarked={contextItem ? bookmarkPathSet.has(contextItem.path) : false}
          selectionCount={selectedPaths.length}
          hasZipSelection={selectedPaths.length === 1 && selectedPaths[0].toLowerCase().endsWith('.zip')}
          onClose={closeContextMenu}
          onOpen={() => contextItem && handleOpenItem(contextItem)}
          onEdit={() => contextItem && void handleEditFile(contextItem)}
          onDownload={() => contextItem && void handleDownloadFile(contextItem)}
          onRename={() => {
            if (!contextItem) return;
            setRenameValue(contextItem.name);
            setRenamingItem(contextItem);
          }}
          onCut={() => handleCut(selectedPaths.length > 1 ? undefined : contextItem)}
          onCopy={() => handleCopy(selectedPaths.length > 1 ? undefined : contextItem)}
          onPaste={() => void handlePaste()}
          onBookmarkToggle={() => contextItem && void toggleBookmarkForItem(contextItem)}
          onBookmarkSelection={() => void bookmarkSelection()}
          onDeselect={clearSelection}
          onDelete={() => void handleDelete(selectedPaths.length > 1 ? undefined : contextItem)}
          onZip={() => {
            fm.setZipArchiveName('archive.zip');
            fm.setZipModalOpen(true);
          }}
          onExtract={() => {
            fm.setExtractTargetDir(currentPath);
            fm.setExtractModalOpen(true);
          }}
          onChmod={() => {
            fm.setChmodValue('755');
            fm.setChmodModalOpen(true);
          }}
          onCreateFile={() => setCreateType('file')}
          onCreateDir={() => setCreateType('dir')}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}
