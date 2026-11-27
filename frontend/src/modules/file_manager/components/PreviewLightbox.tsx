import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatSize, previewKind } from '../utils';
import { fetchFileBlob, mimeFor } from '../media';
import type { FileManagerState } from '../hooks/useFileManager';
import type { PreviewKind } from '../types';

/** Lightbox sits above desktop windows (z-100) and the dock (z-120). Preview is a full in-memory blob fetch, so keep it bounded per type. */
const LIMITS: Record<PreviewKind, number> = {
  image: 40 * 1024 * 1024,
  pdf: 80 * 1024 * 1024,
  audio: 150 * 1024 * 1024,
  video: 300 * 1024 * 1024,
};

export default function PreviewLightbox({ fm }: { fm: FileManagerState }) {
  const { tr, previewPath, setPreviewPath, previewItems } = fm;
  const index = previewItems.findIndex((i) => i.path === previewPath);
  const item = index >= 0 ? previewItems[index] : undefined;
  const kind = item ? previewKind(item.name) : null;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [rotation, setRotation] = useState(0);

  const tooLarge = !!(item && kind && item.size > LIMITS[kind]);

  useEffect(() => {
    setUrl(null);
    setError(null);
    setZoom('fit');
    setRotation(0);
    if (!item || !kind || tooLarge) return;
    const ctrl = new AbortController();
    let objectUrl: string | null = null;
    setLoading(true);
    fetchFileBlob(item.path, ctrl.signal, mimeFor(item.name))
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : tr.previewFailed);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => {
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.path, item?.modified]);

  // A preview of something that left the listing (deleted / filtered) just closes.
  useEffect(() => {
    if (previewPath && !item) setPreviewPath(null);
  }, [previewPath, item, setPreviewPath]);

  const go = useMemo(
    () => (delta: number) => {
      if (!previewItems.length || index < 0) return;
      const next = previewItems[(index + delta + previewItems.length) % previewItems.length];
      setPreviewPath(next.path);
    },
    [previewItems, index, setPreviewPath],
  );

  const zoomBy = (f: number) => setZoom((z) => Math.min(8, Math.max(0.1, (z === 'fit' ? 1 : z) * f)));

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      const media = (e.target as HTMLElement | null)?.closest?.('video,audio');
      if (e.key === 'Escape') setPreviewPath(null);
      else if (e.key === 'ArrowLeft' && !media) go(-1);
      else if (e.key === 'ArrowRight' && !media) go(1);
      else if (kind === 'image' && (e.key === '+' || e.key === '=')) zoomBy(1.25);
      else if (kind === 'image' && e.key === '-') zoomBy(0.8);
      else if (kind === 'image' && e.key === '0') setZoom('fit');
      else if (kind === 'image' && e.key.toLowerCase() === 'r') setRotation((r) => (r + 90) % 360);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [item, kind, go, setPreviewPath]);

  if (!item || !kind) return null;

  const tool = 'flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white';

  const body = () => {
    if (tooLarge)
      return (
        <div className="flex flex-col items-center gap-3 text-sm text-white/80">
          <Icons.FileWarning className="h-10 w-10" />
          {tr.previewTooLarge(formatSize(item.size))}
          <button type="button" onClick={() => void fm.handleDownloadFile(item)} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25">
            {tr.downloadFile}
          </button>
        </div>
      );
    if (error)
      return (
        <div className="flex items-center gap-2 text-sm text-red-300">
          <Icons.AlertCircle className="h-5 w-5" /> {tr.previewFailed} {error}
        </div>
      );
    if (loading || !url) return <Icons.Loader className="h-8 w-8 animate-spin text-white/70" />;
    if (kind === 'image')
      return (
        <img
          src={url}
          alt={item.name}
          data-testid="fm-preview-image"
          draggable={false}
          onDoubleClick={() => setZoom((z) => (z === 'fit' ? 1 : 'fit'))}
          style={{
            transform: `rotate(${rotation}deg)${zoom === 'fit' ? '' : ` scale(${zoom})`}`,
            transformOrigin: 'center center',
          }}
          className={cn('select-none transition-transform', zoom === 'fit' ? 'max-h-full max-w-full object-contain' : 'max-w-none')}
        />
      );
    if (kind === 'video') return <video src={url} controls autoPlay data-testid="fm-preview-video" className="max-h-full max-w-full rounded-lg bg-black" />;
    if (kind === 'audio')
      return (
        <div className="flex w-[min(480px,90%)] flex-col items-center gap-4 text-white/80">
          <Icons.Music className="h-14 w-14" />
          <audio src={url} controls autoPlay data-testid="fm-preview-audio" className="w-full" />
        </div>
      );
    return <iframe src={url} title={item.name} data-testid="fm-preview-pdf" className="h-full w-full rounded-lg bg-white" />;
  };

  return createPortal(
    <div className="fixed inset-0 z-[125] flex flex-col bg-black/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={item.name} data-testid="fm-preview">
      <div className="flex shrink-0 items-center gap-1 px-3 py-2 text-white">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{item.name}</p>
          <p className="text-[10px] text-white/50">
            {formatSize(item.size)} · {index + 1}/{previewItems.length}
          </p>
        </div>
        {kind === 'image' && (
          <>
            <button type="button" className={tool} title={`${tr.zoomOut} (-)`} onClick={() => zoomBy(0.8)}>
              <Icons.ZoomOut className="h-4 w-4" />
            </button>
            <button type="button" className={cn(tool, 'w-auto px-2 text-[11px] font-mono')} title={zoom === 'fit' ? tr.actualSize : tr.fitToWindow} onClick={() => setZoom((z) => (z === 'fit' ? 1 : 'fit'))}>
              {zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}
            </button>
            <button type="button" className={tool} title={`${tr.zoomIn} (+)`} onClick={() => zoomBy(1.25)}>
              <Icons.ZoomIn className="h-4 w-4" />
            </button>
            <button type="button" className={tool} title={`${tr.rotate} (R)`} onClick={() => setRotation((r) => (r + 90) % 360)}>
              <Icons.RotateCw className="h-4 w-4" />
            </button>
          </>
        )}
        <button type="button" className={tool} title={tr.downloadFile} onClick={() => void fm.handleDownloadFile(item)}>
          <Icons.Download className="h-4 w-4" />
        </button>
        <button type="button" className={tool} title={`${tr.close} (Esc)`} onClick={() => setPreviewPath(null)} data-testid="fm-preview-close">
          <Icons.X className="h-5 w-5" />
        </button>
      </div>
      <div
        className={cn('relative flex min-h-0 flex-1 items-center justify-center p-2 sm:px-14', zoom !== 'fit' ? 'overflow-auto' : 'overflow-hidden')}
        onClick={(e) => {
          if (e.target === e.currentTarget) setPreviewPath(null);
        }}
      >
        {body()}
        {previewItems.length > 1 && (
          <>
            <button type="button" aria-label={tr.previous} onClick={() => go(-1)} className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 sm:block">
              <Icons.ChevronLeft className="h-6 w-6" />
            </button>
            <button type="button" aria-label={tr.next} onClick={() => go(1)} className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 sm:block" data-testid="fm-preview-next">
              <Icons.ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>
      {previewItems.length > 1 && (
        <div className="flex shrink-0 justify-center gap-6 pb-3 sm:hidden">
          <button type="button" aria-label={tr.previous} onClick={() => go(-1)} className="rounded-full bg-white/10 p-2 text-white">
            <Icons.ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" aria-label={tr.next} onClick={() => go(1)} className="rounded-full bg-white/10 p-2 text-white">
            <Icons.ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
