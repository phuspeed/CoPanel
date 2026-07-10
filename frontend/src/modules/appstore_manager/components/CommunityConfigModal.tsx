import * as Icons from 'lucide-react';
import { cn } from '../../../lib/utils';
import WindowModal from '../../../core/shell/WindowModal';

interface Props {
  open: boolean;
  isDark: boolean;
  language: 'en' | 'vi';
  communityUrls: string[];
  newUrl: string;
  onNewUrlChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (url: string) => void;
  onClose: () => void;
}

export default function CommunityConfigModal({
  open,
  isDark,
  language,
  communityUrls,
  newUrl,
  onNewUrlChange,
  onAdd,
  onRemove,
  onClose,
}: Props) {
  return (
    <WindowModal
      open={open}
      onClose={onClose}
      title={language === 'vi' ? 'AppStore cộng đồng' : 'Community AppStores'}
      maxWidth="lg"
    >
      <div className="space-y-4 p-4">
        <div className="space-y-2">
          <label className="text-xs font-bold">{language === 'vi' ? 'Thêm URL packages.json:' : 'Add packages.json URL:'}</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newUrl}
              onChange={(e) => onNewUrlChange(e.target.value)}
              placeholder="https://github.com/..."
              className={cn(
                'flex-1 rounded-xl border px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40',
                isDark ? 'border-slate-700 bg-slate-800 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-800',
              )}
            />
            <button type="button" onClick={onAdd} className="rounded-xl bg-indigo-600 px-3 py-2 text-white hover:bg-indigo-500">
              <Icons.Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[25vh] space-y-2 overflow-y-auto">
          {communityUrls.length === 0 ? (
            <p className={cn('py-4 text-center text-xs italic', isDark ? 'text-slate-500' : 'text-slate-400')}>
              {language === 'vi' ? 'Chưa có AppStore cộng đồng.' : 'No community catalogs yet.'}
            </p>
          ) : (
            communityUrls.map((url) => (
              <div
                key={url}
                className={cn(
                  'flex items-center justify-between rounded-xl border p-3',
                  isDark ? 'border-slate-700/60 bg-slate-800/40' : 'border-slate-200 bg-slate-50',
                )}
              >
                <span className="line-clamp-1 flex-1 break-all font-mono text-xs">{url}</span>
                <button type="button" onClick={() => onRemove(url)} className="p-1.5 text-red-400 hover:text-red-500">
                  <Icons.Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </WindowModal>
  );
}
