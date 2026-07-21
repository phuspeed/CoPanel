import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import { MAX_WALLPAPERS, type WallpaperItem } from '../../../core/brandingTypes';

interface Props {
  isDark: boolean;
  language: 'en' | 'vi';
  wallpapers: WallpaperItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onUpload: (files: FileList | null) => void;
  uploading?: boolean;
}

const T = {
  en: {
    title: 'Desktop wallpapers',
    desc: 'Upload multiple images and pick one for the Desktop home screen. PNG/JPEG/WebP/GIF, max 2 MB each.',
    defaultGradient: 'Default gradient',
    upload: 'Upload images',
    selected: 'Active',
    remove: 'Remove',
    empty: 'No custom wallpapers yet.',
    limit: (n: number) => `${n} / ${MAX_WALLPAPERS} images`,
  },
  vi: {
    title: 'Hình nền Desktop',
    desc: 'Tải lên nhiều ảnh và chọn một ảnh làm nền màn hình Desktop. PNG/JPEG/WebP/GIF, tối đa 2 MB/ảnh.',
    defaultGradient: 'Gradient mặc định',
    upload: 'Tải ảnh lên',
    selected: 'Đang dùng',
    remove: 'Xóa',
    empty: 'Chưa có hình nền tùy chỉnh.',
    limit: (n: number) => `${n} / ${MAX_WALLPAPERS} ảnh`,
  },
} as const;

export default function WallpaperGallery({
  isDark,
  language,
  wallpapers,
  selectedId,
  onSelect,
  onRemove,
  onUpload,
  uploading,
}: Props) {
  const tr = T[language === 'vi' ? 'vi' : 'en'];
  const atLimit = wallpapers.length >= MAX_WALLPAPERS;
  const defaultActive = !selectedId;

  return (
    <div className="mt-6 space-y-3">
      <div>
        <h3 className={cn('text-sm font-semibold', isDark ? 'text-slate-100' : 'text-slate-900')}>{tr.title}</h3>
        <p className={cn('mt-1 text-xs leading-relaxed', isDark ? 'text-slate-400' : 'text-slate-500')}>{tr.desc}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label
          className={cn(
            'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
            atLimit || uploading
              ? 'cursor-not-allowed opacity-50'
              : 'cursor-pointer',
            isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100',
          )}
        >
          {uploading ? <Icons.Loader2 className="h-4 w-4 animate-spin" /> : <Icons.ImagePlus className="h-4 w-4" />}
          {tr.upload}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            disabled={atLimit || uploading}
            className="hidden"
            onChange={(e) => {
              onUpload(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <span className={cn('text-xs', isDark ? 'text-slate-500' : 'text-slate-500')}>{tr.limit(wallpapers.length)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            'group relative aspect-[16/10] overflow-hidden rounded-xl border-2 text-left transition',
            defaultActive
              ? 'border-sky-500 ring-2 ring-sky-500/30'
              : isDark
                ? 'border-slate-700 hover:border-slate-500'
                : 'border-slate-200 hover:border-slate-300',
          )}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[#e8d5d8] via-[#e8eef5] to-[#c8e4e8] dark:from-slate-950 dark:via-slate-900 dark:to-cyan-950/40" />
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900/10 to-slate-900/25" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2">
            <p className="text-[11px] font-semibold text-white">{tr.defaultGradient}</p>
          </div>
          {defaultActive && (
            <span className="absolute right-2 top-2 rounded-full bg-sky-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {tr.selected}
            </span>
          )}
        </button>

        {wallpapers.map((wp) => {
          const active = selectedId === wp.id;
          return (
            <div key={wp.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(wp.id)}
                className={cn(
                  'relative aspect-[16/10] w-full overflow-hidden rounded-xl border-2 transition',
                  active
                    ? 'border-sky-500 ring-2 ring-sky-500/30'
                    : isDark
                      ? 'border-slate-700 hover:border-slate-500'
                      : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <img src={wp.data_url} alt={wp.label || 'Wallpaper'} className="h-full w-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <p className="truncate text-[11px] font-medium text-white">{wp.label || wp.id}</p>
                </div>
                {active && (
                  <span className="absolute right-2 top-2 rounded-full bg-sky-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {tr.selected}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onRemove(wp.id)}
                className={cn(
                  'absolute right-1.5 top-1.5 rounded-lg p-1 opacity-0 shadow transition group-hover:opacity-100',
                  isDark ? 'bg-slate-900/90 text-red-400 hover:bg-red-950' : 'bg-white/95 text-red-600 hover:bg-red-50',
                )}
                title={tr.remove}
                aria-label={tr.remove}
              >
                <Icons.Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {wallpapers.length === 0 && (
        <p className={cn('text-xs', isDark ? 'text-slate-500' : 'text-slate-500')}>{tr.empty}</p>
      )}
    </div>
  );
}
