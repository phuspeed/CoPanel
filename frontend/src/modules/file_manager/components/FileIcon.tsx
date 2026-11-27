import { useEffect, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import { fileIconKind, previewKind, type FileIconKind } from '../utils';
import { fetchFileBlob } from '../media';
import type { FileItem } from '../types';

const ICONS: Record<FileIconKind, Icons.LucideIcon> = {
  folder: Icons.Folder,
  archive: Icons.FileArchive,
  image: Icons.FileImage,
  code: Icons.FileCode2,
  video: Icons.FileVideo,
  audio: Icons.FileAudio,
  pdf: Icons.FileText,
  text: Icons.FileText,
  file: Icons.File,
};

const COLORS: Record<FileIconKind, string> = {
  folder: 'text-sky-400',
  archive: 'text-amber-500',
  image: 'text-emerald-500',
  code: 'text-violet-400',
  video: 'text-rose-400',
  audio: 'text-pink-400',
  pdf: 'text-red-500',
  text: 'text-slate-400',
  file: 'text-slate-400',
};

export function FileIcon({ item, className }: { item: FileItem; className?: string }) {
  const kind = fileIconKind(item.name, item.is_dir);
  const Icon = ICONS[kind];
  return (
    <span className="relative inline-flex shrink-0">
      <Icon className={cn(COLORS[kind], className)} />
      {item.is_symlink && <Icons.CornerDownRight className="absolute -bottom-0.5 -right-1 h-2.5 w-2.5 rounded-sm bg-white/90 text-slate-600" />}
    </span>
  );
}

/** Grid thumbnail: small images are fetched lazily once visible; everything else shows an icon. */
const THUMB_MAX = 5 * 1024 * 1024;

export function FileThumb({ item, iconClass }: { item: FileItem; iconClass: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const eligible = !item.is_dir && previewKind(item.name) === 'image' && item.size > 0 && item.size <= THUMB_MAX;

  useEffect(() => {
    if (!eligible || !ref.current) return;
    let objectUrl: string | null = null;
    const ctrl = new AbortController();
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      fetchFileBlob(item.path, ctrl.signal)
        .then((blob) => {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch(() => undefined);
    });
    io.observe(ref.current);
    return () => {
      io.disconnect();
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [eligible, item.path, item.modified]);

  return (
    <div ref={ref} className="flex h-14 w-full items-center justify-center overflow-hidden">
      {url ? (
        <img src={url} alt="" draggable={false} className="max-h-14 max-w-full rounded object-contain shadow-sm" />
      ) : (
        <FileIcon item={item} className={iconClass} />
      )}
    </div>
  );
}
