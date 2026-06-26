/**
 * Audio Player — music library with folder browse and playback.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { api } from '../../core/platform';

type ViewKey = 'home' | 'folder' | 'all' | 'album' | 'artist' | 'genre' | 'recent' | 'random' | 'playlist';

interface BrowseEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
}

interface BrowseResult {
  current: string;
  parent: string | null;
  roots: string[];
  dirs: BrowseEntry[];
  files: BrowseEntry[];
  breadcrumbs: { name: string; path: string }[];
}

interface FolderPicker {
  current: string;
  parent: string | null;
  entries: { name: string; path: string; type: string }[];
  volumes: { label: string; path: string }[];
  library_roots: string[];
}

interface Settings {
  library_roots: string[];
  scan_on_startup: boolean;
  scan_interval_hours: number;
  follow_symlinks: boolean;
  max_scan_depth: number;
}

interface LibraryStats {
  tracks: number;
  albums: number;
  artists: number;
  scan: {
    status: string;
    progress: number;
    files_found: number;
    files_indexed: number;
    last_started?: string;
    last_finished?: string;
    error_message?: string;
  };
  library_roots: string[];
}

interface QueueItem {
  name: string;
  path: string;
}

interface LibraryTrack {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  album_artist?: string;
  genre: string;
  duration_sec?: number;
  track_number?: number;
  cover_hash?: string | null;
  has_cover?: boolean;
}

interface AlbumItem {
  key: string;
  album: string;
  album_artist: string;
  artist: string;
  track_count: number;
  cover_hash?: string | null;
  has_cover?: boolean;
}

interface PlaylistItem {
  id: string;
  name: string;
  kind: 'user' | 'system';
  track_count: number;
}

interface NamedGroup {
  name: string;
  track_count: number;
}

function fmtBytes(n: number): string {
  if (!n || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtTime(sec: number): string {
  if (!sec || !Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function streamUrl(path: string): string {
  const token = localStorage.getItem('copanel_token') || '';
  return `/api/audio_station/stream?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
}

function coverUrl(opts: { path?: string; id?: string; hash?: string }): string | null {
  if (!opts.hash && !opts.id && !opts.path) return null;
  const token = localStorage.getItem('copanel_token') || '';
  const params = new URLSearchParams({ token });
  if (opts.hash) params.set('hash', opts.hash);
  else if (opts.id) params.set('id', opts.id);
  else if (opts.path) params.set('path', opts.path);
  return `/api/audio_station/cover?${params.toString()}`;
}

function CoverThumb({
  track,
  album,
  className = 'w-10 h-10',
}: {
  track?: LibraryTrack | null;
  album?: AlbumItem | null;
  className?: string;
}) {
  const src =
    coverUrl({ hash: album?.cover_hash || track?.cover_hash || undefined }) ||
    (track?.path ? coverUrl({ path: track.path }) : null) ||
    (track?.id ? coverUrl({ id: track.id }) : null);
  if (!src) {
    return (
      <div className={`${className} rounded bg-teal-500/10 flex items-center justify-center shrink-0`}>
        <Icons.Disc className="w-5 h-5 text-teal-500/50" />
      </div>
    );
  }
  return <img src={src} alt="" className={`${className} rounded object-cover shrink-0 bg-slate-200`} />;
}

function Modal({
  title,
  children,
  onClose,
  isDark,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  isDark: boolean;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={`rounded-lg shadow-xl border max-h-[90vh] overflow-y-auto ${
          wide ? 'w-full max-w-2xl' : 'w-full max-w-lg'
        } ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}
      >
        <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
          <h3 className="font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-black/10">
            <Icons.X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export default function AudioStation() {
  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  const t = useMemo(
    () =>
      language === 'vi'
        ? {
            title: 'Audio Player',
            subtitle: 'Thư viện nhạc — duyệt thư mục & phát nhạc',
            search: 'Tìm nhạc…',
            settings: 'Cài đặt',
            home: 'Trang chủ',
            myMusic: 'NHẠC CỦA TÔI',
            allMusic: 'Tất cả nhạc',
            byFolder: 'Theo thư mục',
            byAlbum: 'Theo album',
            byArtist: 'Theo nghệ sĩ',
            byGenre: 'Theo thể loại',
            comingSoon: 'Cần quét thư viện — sắp có',
            noFiles: 'Không có file nhạc trong thư mục này.',
            noFolders: 'Chưa có thư mục nhạc.',
            colTitle: 'Tiêu đề',
            colAlbum: 'Album',
            colArtist: 'Nghệ sĩ',
            colDuration: 'Thời lượng',
            libraryRoots: 'Thư mục nhạc',
            addRoot: 'Thêm thư mục',
            browse: 'Duyệt',
            scanNow: 'Quét thư viện',
            scanOnStartup: 'Tự quét khi khởi động',
            save: 'Lưu',
            cancel: 'Hủy',
            selectFolder: 'Chọn thư mục',
            useThisFolder: 'Chọn thư mục này',
            tracks: 'bài',
            albums: 'album',
            artists: 'nghệ sĩ',
            scanning: 'Đang quét…',
            scanDone: 'Quét xong',
            scanError: 'Lỗi quét',
            play: 'Phát',
            pause: 'Tạm dừng',
            next: 'Tiếp',
            prev: 'Trước',
            queue: 'Hàng đợi',
            emptyQueue: 'Hàng đợi trống',
            openFolder: 'Mở thư mục',
            statsHint: 'Quét thư viện để nhóm theo album/nghệ sĩ.',
            noLibrary: 'Chưa có nhạc trong thư viện. Bấm Quét thư viện.',
            back: 'Quay lại',
            songs: 'bài hát',
            indexed: 'đã index',
            playlists: 'PLAYLIST',
            recentlyAdded: 'Mới thêm',
            random100: 'Ngẫu nhiên 100',
            newPlaylist: 'Tạo playlist',
            playlistName: 'Tên playlist',
            deletePlaylist: 'Xóa playlist',
            addToPlaylist: 'Thêm vào playlist',
          }
        : {
            title: 'Audio Player',
            subtitle: 'Music library — browse folders and play tracks',
            search: 'Search music…',
            settings: 'Settings',
            home: 'Home',
            myMusic: 'MY MUSIC',
            allMusic: 'All Music',
            byFolder: 'By Folder',
            byAlbum: 'By Album',
            byArtist: 'By Artist',
            byGenre: 'By Genre',
            comingSoon: 'Requires library scan — coming in v0.2',
            noFiles: 'No audio files in this folder.',
            noFolders: 'No music folders yet.',
            colTitle: 'Title',
            colAlbum: 'Album',
            colArtist: 'Artist',
            colDuration: 'Duration',
            libraryRoots: 'Music folders',
            addRoot: 'Add folder',
            browse: 'Browse',
            scanNow: 'Scan library',
            scanOnStartup: 'Scan on startup',
            save: 'Save',
            cancel: 'Cancel',
            selectFolder: 'Select folder',
            useThisFolder: 'Use this folder',
            tracks: 'tracks',
            albums: 'albums',
            artists: 'artists',
            scanning: 'Scanning…',
            scanDone: 'Scan complete',
            scanError: 'Scan error',
            play: 'Play',
            pause: 'Pause',
            next: 'Next',
            prev: 'Previous',
            queue: 'Queue',
            emptyQueue: 'Queue is empty',
            openFolder: 'Open folder',
            statsHint: 'Scan library to group by album/artist.',
            noLibrary: 'No music in library yet. Run Scan library.',
            back: 'Back',
            songs: 'songs',
            indexed: 'indexed',
            playlists: 'PLAYLIST',
            recentlyAdded: 'Recently Added',
            random100: 'Random 100',
            newPlaylist: 'New playlist',
            playlistName: 'Playlist name',
            deletePlaylist: 'Delete playlist',
            addToPlaylist: 'Add to playlist',
          },
    [language],
  );

  const panel = isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const hoverRow = isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-50';
  const activeNav = isDark ? 'bg-teal-900/40 text-teal-300' : 'bg-teal-50 text-teal-700';

  const [view, setView] = useState<ViewKey>('folder');
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [folderPicker, setFolderPicker] = useState<FolderPicker | null>(null);
  const [pickerMode, setPickerMode] = useState<'add' | null>(null);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showQueue, setShowQueue] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [libTracks, setLibTracks] = useState<LibraryTrack[]>([]);
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [artists, setArtists] = useState<NamedGroup[]>([]);
  const [genres, setGenres] = useState<NamedGroup[]>([]);
  const [topGenres, setTopGenres] = useState<NamedGroup[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumItem | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistItem | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);
  const [recentTracks, setRecentTracks] = useState<LibraryTrack[]>([]);
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [libLoading, setLibLoading] = useState(false);

  const currentTrack = queue[queueIndex] || null;

  const loadBrowse = useCallback(async (path = '') => {
    try {
      const data = await api<BrowseResult>(`/api/audio_station/browse?path=${encodeURIComponent(path)}`);
      setBrowse(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const data = await api<LibraryStats>('/api/audio_station/library/stats');
      setStats(data);
    } catch {
      /* ignore */
    }
  }, []);

  const loadLibraryView = useCallback(async () => {
    if (view === 'folder' || view === 'home') return;
    setLibLoading(true);
    setError(null);
    const q = search.trim();
    try {
      if (view === 'all') {
        const data = await api<{ items: LibraryTrack[] }>(
          `/api/audio_station/library/tracks?q=${encodeURIComponent(q)}&limit=1000`,
        );
        setLibTracks(data.items || []);
      } else if (view === 'recent') {
        const data = await api<{ items: LibraryTrack[] }>('/api/audio_station/library/recent?limit=100');
        setLibTracks(data.items || []);
      } else if (view === 'random') {
        const data = await api<{ items: LibraryTrack[] }>('/api/audio_station/library/random?limit=100');
        setLibTracks(data.items || []);
      } else if (view === 'playlist' && selectedPlaylist) {
        const data = await api<{ items: LibraryTrack[] }>(
          `/api/audio_station/playlists/${encodeURIComponent(selectedPlaylist.id)}/tracks`,
        );
        setLibTracks(data.items || []);
      } else if (view === 'album') {
        if (selectedAlbum) {
          const data = await api<{ items: LibraryTrack[] }>(
            `/api/audio_station/library/albums/${encodeURIComponent(selectedAlbum.key)}/tracks`,
          );
          setLibTracks(data.items || []);
        } else {
          const data = await api<{ items: AlbumItem[] }>(
            `/api/audio_station/library/albums?q=${encodeURIComponent(q)}`,
          );
          setAlbums(data.items || []);
        }
      } else if (view === 'artist') {
        if (selectedArtist) {
          const data = await api<{ items: LibraryTrack[] }>(
            `/api/audio_station/library/artists/${encodeURIComponent(selectedArtist)}/tracks`,
          );
          setLibTracks(data.items || []);
        } else {
          const data = await api<{ items: NamedGroup[] }>(
            `/api/audio_station/library/artists?q=${encodeURIComponent(q)}`,
          );
          setArtists(data.items || []);
        }
      } else if (view === 'genre') {
        if (selectedGenre) {
          const data = await api<{ items: LibraryTrack[] }>(
            `/api/audio_station/library/genres/${encodeURIComponent(selectedGenre)}/tracks`,
          );
          setLibTracks(data.items || []);
        } else {
          const data = await api<{ items: NamedGroup[] }>(
            `/api/audio_station/library/genres?q=${encodeURIComponent(q)}`,
          );
          setGenres(data.items || []);
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLibLoading(false);
    }
  }, [view, search, selectedAlbum, selectedArtist, selectedGenre, selectedPlaylist]);

  const loadPlaylists = useCallback(async () => {
    try {
      const data = await api<{ items: PlaylistItem[] }>('/api/audio_station/playlists');
      setPlaylists(data.items || []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadRecentPreview = useCallback(async () => {
    try {
      const data = await api<{ items: LibraryTrack[] }>('/api/audio_station/library/recent?limit=8');
      setRecentTracks(data.items || []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadTopGenres = useCallback(async () => {
    try {
      const data = await api<NamedGroup[]>('/api/audio_station/library/top-genres');
      setTopGenres(data || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadBrowse(''), loadStats(), loadTopGenres(), loadPlaylists(), loadRecentPreview()]);
      setLoading(false);
    })();
  }, [loadBrowse, loadStats, loadTopGenres, loadPlaylists, loadRecentPreview]);

  useEffect(() => {
    loadLibraryView();
  }, [loadLibraryView]);

  useEffect(() => {
    if (stats?.scan.status !== 'running') {
      if (view !== 'folder' && view !== 'home') loadLibraryView();
      loadTopGenres();
      loadPlaylists();
      loadRecentPreview();
      return;
    }
    const id = setInterval(() => {
      loadStats();
    }, 2000);
    return () => clearInterval(id);
  }, [stats?.scan.status, view, loadStats, loadLibraryView, loadTopGenres, loadPlaylists, loadRecentPreview]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !currentTrack) return;
    el.src = streamUrl(currentTrack.path);
    el.load();
    if (playing) el.play().catch(() => setPlaying(false));
  }, [currentTrack?.path]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) el.play().catch(() => setPlaying(false));
    else el.pause();
  }, [playing]);

  function playTracks(tracks: QueueItem[], startIndex = 0) {
    if (!tracks.length) return;
    setQueue(tracks);
    setQueueIndex(startIndex);
    setPlaying(true);
  }

  function playLibraryTracks(tracks: LibraryTrack[], startIndex = 0) {
    playTracks(
      tracks.map((tr) => ({ name: tr.title || tr.path, path: tr.path })),
      startIndex,
    );
  }

  function playLibraryTrack(track: LibraryTrack, list: LibraryTrack[]) {
    const idx = list.findIndex((x) => x.path === track.path);
    playLibraryTracks(list, idx >= 0 ? idx : 0);
  }

  function playFile(file: BrowseEntry) {
    if (!browse) return;
    const tracks = browse.files.map((f) => ({ name: f.name, path: f.path }));
    const idx = tracks.findIndex((x) => x.path === file.path);
    playTracks(tracks, idx >= 0 ? idx : 0);
  }

  function playAllInFolder() {
    if (!browse?.files.length) return;
    playTracks(browse.files.map((f) => ({ name: f.name, path: f.path })));
  }

  function onEnded() {
    if (queueIndex < queue.length - 1) {
      setQueueIndex((i) => i + 1);
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  }

  function skipNext() {
    if (queueIndex < queue.length - 1) {
      setQueueIndex((i) => i + 1);
      setPlaying(true);
    }
  }

  function skipPrev() {
    const el = audioRef.current;
    if (el && el.currentTime > 3) {
      el.currentTime = 0;
      return;
    }
    if (queueIndex > 0) {
      setQueueIndex((i) => i - 1);
      setPlaying(true);
    }
  }

  async function openSettings() {
    const data = await api<Settings>('/api/audio_station/settings');
    setSettings(data);
    setSettingsDraft({ ...data, library_roots: [...data.library_roots] });
    setSettingsOpen(true);
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    const saved = await api<Settings>('/api/audio_station/settings', {
      method: 'PUT',
      body: settingsDraft,
    });
    setSettings(saved);
    setSettingsDraft({ ...saved, library_roots: [...saved.library_roots] });
    setSettingsOpen(false);
    await Promise.all([loadBrowse(''), loadStats()]);
  }

  async function createPlaylist() {
    const name = newPlaylistName.trim();
    if (!name) return;
    const pl = await api<PlaylistItem>('/api/audio_station/playlists', {
      method: 'POST',
      body: { name },
    });
    setNewPlaylistName('');
    setNewPlaylistOpen(false);
    await loadPlaylists();
    setSelectedPlaylist(pl);
    setView('playlist');
  }

  async function deleteSelectedPlaylist() {
    if (!selectedPlaylist || selectedPlaylist.kind === 'system') return;
    await api(`/api/audio_station/playlists/${encodeURIComponent(selectedPlaylist.id)}`, { method: 'DELETE' });
    setSelectedPlaylist(null);
    setView('home');
    await loadPlaylists();
  }

  function openPlaylist(pl: PlaylistItem) {
    setSelectedAlbum(null);
    setSelectedArtist(null);
    setSelectedGenre(null);
    setSelectedPlaylist(pl);
    setView('playlist');
  }

  function openSystemPlaylist(kind: 'recent' | 'random') {
    const pl = playlists.find((p) => p.id === (kind === 'recent' ? '__recent__' : '__random__'));
    if (pl) openPlaylist(pl);
    else setView(kind);
  }

  async function runScan() {
    await api('/api/audio_station/library/scan', { method: 'POST' });
    await loadStats();
  }

  async function openFolderPicker() {
    setPickerMode('add');
    const data = await api<FolderPicker>('/api/audio_station/folders/browse');
    setFolderPicker(data);
  }

  async function browsePicker(path: string) {
    const data = await api<FolderPicker>(`/api/audio_station/folders/browse?path=${encodeURIComponent(path)}`);
    setFolderPicker(data);
  }

  function pickFolder(path: string) {
    if (!settingsDraft || pickerMode !== 'add') return;
    if (!settingsDraft.library_roots.includes(path)) {
      setSettingsDraft({
        ...settingsDraft,
        library_roots: [...settingsDraft.library_roots, path],
      });
    }
    setFolderPicker(null);
    setPickerMode(null);
  }

  function removeRoot(path: string) {
    if (!settingsDraft || settingsDraft.library_roots.length <= 1) return;
    setSettingsDraft({
      ...settingsDraft,
      library_roots: settingsDraft.library_roots.filter((r) => r !== path),
    });
  }

  const filteredFiles = useMemo(() => {
    if (!browse) return [];
    const q = search.trim().toLowerCase();
    if (!q) return browse.files;
    return browse.files.filter((f) => f.name.toLowerCase().includes(q));
  }, [browse, search]);

  const navItem = (key: ViewKey, label: string, icon: keyof typeof Icons, disabled = false) => {
    const Icon = Icons[icon] as React.ComponentType<{ className?: string }>;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setSelectedAlbum(null);
          setSelectedArtist(null);
          setSelectedGenre(null);
          setSelectedPlaylist(null);
          setView(key);
        }}
        className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 ${
          view === key ? activeNav : `${muted} ${disabled ? 'opacity-40 cursor-not-allowed' : hoverRow}`
        }`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        {label}
      </button>
    );
  };

  const viewTitle = useMemo(() => {
    if (view === 'folder') return t.byFolder;
    if (view === 'all') return t.allMusic;
    if (view === 'recent') return t.recentlyAdded;
    if (view === 'random') return t.random100;
    if (view === 'playlist') return selectedPlaylist?.name || t.playlists;
    if (view === 'album') return selectedAlbum ? selectedAlbum.album : t.byAlbum;
    if (view === 'artist') return selectedArtist || t.byArtist;
    if (view === 'genre') return selectedGenre || t.byGenre;
    return t.home;
  }, [view, selectedAlbum, selectedArtist, selectedGenre, selectedPlaylist, t]);

  function renderTrackTable(tracks: LibraryTrack[], emptyMsg: string) {
    if (libLoading) {
      return (
        <div className={`flex-1 flex items-center justify-center ${muted}`}>
          <Icons.Loader2 className="w-8 h-8 animate-spin" />
        </div>
      );
    }
    if (!tracks.length) {
      return <div className={`flex-1 flex items-center justify-center p-8 ${muted}`}>{emptyMsg}</div>;
    }
    return (
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className={`sticky top-0 z-10 ${isDark ? 'bg-slate-900' : 'bg-white'}`}>
            <tr className={`border-b text-left ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
              <th className="px-4 py-2 font-medium">{t.colTitle}</th>
              <th className="px-4 py-2 font-medium hidden md:table-cell">{t.colAlbum}</th>
              <th className="px-4 py-2 font-medium hidden lg:table-cell">{t.colArtist}</th>
              <th className="px-4 py-2 font-medium w-24 text-right">{t.colDuration}</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((tr) => (
              <tr
                key={tr.path}
                className={`border-b cursor-pointer ${
                  currentTrack?.path === tr.path ? (isDark ? 'bg-teal-900/30' : 'bg-teal-50') : hoverRow
                } ${isDark ? 'border-slate-800' : 'border-slate-100'}`}
                onClick={() => playLibraryTrack(tr, tracks)}
                onDoubleClick={() => playLibraryTrack(tr, tracks)}
              >
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <CoverThumb track={tr} className="w-8 h-8" />
                    <span className="truncate">{tr.title}</span>
                  </div>
                </td>
                <td className={`px-4 py-2 hidden md:table-cell truncate ${muted}`}>{tr.album || '—'}</td>
                <td className={`px-4 py-2 hidden lg:table-cell truncate ${muted}`}>{tr.artist || '—'}</td>
                <td className={`px-4 py-2 text-right ${muted}`}>
                  {tr.duration_sec ? fmtTime(tr.duration_sec) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-[calc(100vh-4rem)] min-h-[32rem] border rounded-lg overflow-hidden ${panel}`}>
      {/* Top bar */}
      <div className={`flex items-center gap-3 px-4 py-3 border-b shrink-0 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
        <Icons.Music className="w-6 h-6 text-teal-500" />
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-lg leading-tight">{t.title}</h1>
          <p className={`text-xs ${muted}`}>{t.subtitle}</p>
        </div>
        <div className="relative hidden sm:block">
          <Icons.Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 ${muted}`} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
            className={`pl-8 pr-3 py-1.5 text-sm rounded-md border w-48 lg:w-64 ${
              isDark ? 'bg-slate-800 border-slate-600' : 'bg-slate-50 border-slate-300'
            }`}
          />
        </div>
        <button
          type="button"
          onClick={openSettings}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border ${
            isDark ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-50'
          }`}
        >
          <Icons.Settings className="w-4 h-4" />
          {t.settings}
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside
          className={`w-52 shrink-0 border-r overflow-y-auto p-3 space-y-4 ${isDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-200 bg-slate-50/80'}`}
        >
          {navItem('home', t.home, 'Home')}
          <div>
            <div className={`text-[10px] font-bold tracking-wider px-3 mb-1 ${muted}`}>{t.myMusic}</div>
            {navItem('all', t.allMusic, 'ListMusic')}
            {navItem('folder', t.byFolder, 'FolderOpen')}
            {navItem('album', t.byAlbum, 'Disc')}
            {navItem('artist', t.byArtist, 'Mic2')}
            {navItem('genre', t.byGenre, 'Tags')}
          </div>
          <div>
            <div className={`flex items-center justify-between px-3 mb-1`}>
              <div className={`text-[10px] font-bold tracking-wider ${muted}`}>{t.playlists}</div>
              <button
                type="button"
                onClick={() => setNewPlaylistOpen(true)}
                className={`p-0.5 rounded hover:bg-teal-500/20 text-teal-500`}
                title={t.newPlaylist}
              >
                <Icons.Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            {playlists.map((pl) => (
              <button
                key={pl.id}
                type="button"
                onClick={() => openPlaylist(pl)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 ${
                  view === 'playlist' && selectedPlaylist?.id === pl.id
                    ? activeNav
                    : `${muted} ${hoverRow}`
                }`}
              >
                {pl.kind === 'system' ? (
                  <Icons.Clock className="w-4 h-4 shrink-0" />
                ) : (
                  <Icons.ListMusic className="w-4 h-4 shrink-0" />
                )}
                <span className="truncate">{pl.name}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          {error && (
            <div className="mx-4 mt-3 px-3 py-2 text-sm rounded bg-red-500/10 text-red-500 border border-red-500/30">
              {error}
            </div>
          )}

          {view === 'home' && (
            <div className="p-6 space-y-6 overflow-y-auto">
              <h2 className="text-xl font-semibold">{t.home}</h2>
              {stats && (
                <div className="grid grid-cols-3 gap-4 max-w-lg">
                  <div className={`p-4 rounded-lg border ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
                    <div className="text-2xl font-bold text-teal-500">{stats.tracks}</div>
                    <div className={`text-sm ${muted}`}>{t.tracks}</div>
                  </div>
                  <div className={`p-4 rounded-lg border ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
                    <div className="text-2xl font-bold text-teal-500">{stats.albums}</div>
                    <div className={`text-sm ${muted}`}>{t.albums}</div>
                  </div>
                  <div className={`p-4 rounded-lg border ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
                    <div className="text-2xl font-bold text-teal-500">{stats.artists}</div>
                    <div className={`text-sm ${muted}`}>{t.artists}</div>
                  </div>
                </div>
              )}
              <p className={`text-sm ${muted}`}>{t.statsHint}</p>
              {recentTracks.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold">{t.recentlyAdded}</h3>
                    <button
                      type="button"
                      onClick={() => openSystemPlaylist('recent')}
                      className="text-xs text-teal-500 hover:underline"
                    >
                      {t.allMusic}
                    </button>
                  </div>
                  <div className="space-y-1 max-w-xl">
                    {recentTracks.slice(0, 5).map((tr) => (
                      <button
                        key={tr.path}
                        type="button"
                        onClick={() => playLibraryTrack(tr, recentTracks)}
                        className={`w-full flex items-center gap-3 p-2 rounded-lg text-left ${hoverRow}`}
                      >
                        <CoverThumb track={tr} className="w-10 h-10" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{tr.title}</div>
                          <div className={`text-xs truncate ${muted}`}>{tr.artist || tr.album}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {topGenres.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">{t.byGenre}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-w-3xl">
                    {topGenres.map((g) => (
                      <button
                        key={g.name}
                        type="button"
                        onClick={() => {
                          setSelectedGenre(g.name);
                          setView('genre');
                        }}
                        className={`p-3 rounded-lg border text-left text-sm hover:border-teal-500 ${
                          isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="font-medium truncate">{g.name}</div>
                        <div className={`text-xs ${muted}`}>{g.track_count} {t.tracks}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setView('folder')}
                  className="px-4 py-2 text-sm rounded-md bg-teal-600 text-white hover:bg-teal-500"
                >
                  {t.byFolder}
                </button>
                <button
                  type="button"
                  onClick={runScan}
                  disabled={stats?.scan.status === 'running'}
                  className="px-4 py-2 text-sm rounded-md border border-teal-600 text-teal-600 hover:bg-teal-500/10 disabled:opacity-50"
                >
                  {stats?.scan.status === 'running' ? t.scanning : t.scanNow}
                </button>
              </div>
            </div>
          )}

          {(view === 'folder' || view === 'all' || view === 'album' || view === 'artist' || view === 'genre' || view === 'recent' || view === 'random' || view === 'playlist') && (
            <>
              <div
                className={`flex items-center justify-between px-4 py-2 border-b shrink-0 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  {(selectedAlbum || selectedArtist || selectedGenre) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAlbum(null);
                        setSelectedArtist(null);
                        setSelectedGenre(null);
                      }}
                      className="text-sm text-teal-500 hover:underline flex items-center gap-1"
                    >
                      <Icons.ArrowLeft className="w-4 h-4" />
                      {t.back}
                    </button>
                  )}
                  <h2 className="font-semibold">{viewTitle}</h2>
                  {view === 'folder' && browse?.breadcrumbs.map((b, i) => (
                    <span key={b.path} className="flex items-center gap-1 text-sm">
                      {i > 0 && <span className={muted}>/</span>}
                      <button
                        type="button"
                        onClick={() => loadBrowse(b.path)}
                        className="text-teal-500 hover:underline truncate max-w-[8rem]"
                      >
                        {b.name}
                      </button>
                    </span>
                  ))}
                </div>
                {view === 'folder' && browse && browse.files.length > 0 && (
                  <button
                    type="button"
                    onClick={playAllInFolder}
                    className="flex items-center gap-1 text-sm text-teal-600 hover:underline shrink-0"
                  >
                    <Icons.Play className="w-4 h-4" />
                    {t.play}
                  </button>
                )}
                {view === 'all' && libTracks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => playLibraryTracks(libTracks)}
                    className="flex items-center gap-1 text-sm text-teal-600 hover:underline shrink-0"
                  >
                    <Icons.Play className="w-4 h-4" />
                    {t.play}
                  </button>
                )}
                {(view === 'recent' || view === 'random' || view === 'playlist') && libTracks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => playLibraryTracks(libTracks)}
                    className="flex items-center gap-1 text-sm text-teal-600 hover:underline shrink-0"
                  >
                    <Icons.Play className="w-4 h-4" />
                    {t.play}
                  </button>
                )}
                {view === 'playlist' && selectedPlaylist?.kind === 'user' && (
                  <button
                    type="button"
                    onClick={deleteSelectedPlaylist}
                    className="flex items-center gap-1 text-sm text-red-500 hover:underline shrink-0"
                  >
                    <Icons.Trash2 className="w-4 h-4" />
                    {t.deletePlaylist}
                  </button>
                )}
              </div>

              {(view === 'all' || view === 'recent' || view === 'random' || view === 'playlist') &&
                renderTrackTable(libTracks, t.noLibrary)}

              {view === 'album' && !selectedAlbum && (
                libLoading ? (
                  <div className={`flex-1 flex items-center justify-center ${muted}`}>
                    <Icons.Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                ) : albums.length === 0 ? (
                  <div className={`flex-1 flex items-center justify-center p-8 ${muted}`}>{t.noLibrary}</div>
                ) : (
                  <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {albums.map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => setSelectedAlbum(a)}
                        className={`p-3 rounded-lg border text-left hover:border-teal-500 ${
                          isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className={`w-full aspect-square rounded mb-2 overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
                          {a.has_cover && a.cover_hash ? (
                            <img
                              src={coverUrl({ hash: a.cover_hash }) || ''}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Icons.Disc className="w-10 h-10 text-teal-500/60" />
                            </div>
                          )}
                        </div>
                        <div className="font-medium text-sm truncate">{a.album}</div>
                        <div className={`text-xs truncate ${muted}`}>{a.album_artist || a.artist}</div>
                        <div className={`text-xs ${muted}`}>{a.track_count} {t.songs}</div>
                      </button>
                    ))}
                  </div>
                )
              )}

              {view === 'album' && selectedAlbum && renderTrackTable(libTracks, t.noFiles)}

              {view === 'artist' && !selectedArtist && (
                libLoading ? (
                  <div className={`flex-1 flex items-center justify-center ${muted}`}>
                    <Icons.Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                ) : artists.length === 0 ? (
                  <div className={`flex-1 flex items-center justify-center p-8 ${muted}`}>{t.noLibrary}</div>
                ) : (
                  <div className="flex-1 overflow-y-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {artists.map((a) => (
                          <tr
                            key={a.name}
                            className={`border-b cursor-pointer ${hoverRow} ${isDark ? 'border-slate-800' : 'border-slate-100'}`}
                            onClick={() => setSelectedArtist(a.name)}
                          >
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <Icons.Mic2 className="w-4 h-4 text-teal-500" />
                                {a.name}
                              </div>
                            </td>
                            <td className={`px-4 py-2 text-right ${muted}`}>{a.track_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {view === 'artist' && selectedArtist && renderTrackTable(libTracks, t.noFiles)}

              {view === 'genre' && !selectedGenre && (
                libLoading ? (
                  <div className={`flex-1 flex items-center justify-center ${muted}`}>
                    <Icons.Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                ) : genres.length === 0 ? (
                  <div className={`flex-1 flex items-center justify-center p-8 ${muted}`}>{t.noLibrary}</div>
                ) : (
                  <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {genres.map((g) => (
                      <button
                        key={g.name}
                        type="button"
                        onClick={() => setSelectedGenre(g.name)}
                        className={`p-3 rounded-lg border text-left hover:border-teal-500 ${
                          isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="font-medium truncate">{g.name}</div>
                        <div className={`text-xs ${muted}`}>{g.track_count} {t.tracks}</div>
                      </button>
                    ))}
                  </div>
                )
              )}

              {view === 'genre' && selectedGenre && renderTrackTable(libTracks, t.noFiles)}

              {view === 'folder' && (
                loading && !browse ? (
                  <div className={`flex-1 flex items-center justify-center ${muted}`}>
                    <Icons.Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className={`sticky top-0 z-10 ${isDark ? 'bg-slate-900' : 'bg-white'}`}>
                        <tr className={`border-b text-left ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
                          <th className="px-4 py-2 font-medium">{t.colTitle}</th>
                          <th className="px-4 py-2 font-medium hidden md:table-cell">{t.colAlbum}</th>
                          <th className="px-4 py-2 font-medium hidden lg:table-cell">{t.colArtist}</th>
                          <th className="px-4 py-2 font-medium w-24 text-right">{t.colDuration}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {browse?.dirs.map((d) => (
                          <tr
                            key={d.path}
                            className={`border-b cursor-pointer ${hoverRow} ${isDark ? 'border-slate-800' : 'border-slate-100'}`}
                            onDoubleClick={() => loadBrowse(d.path)}
                          >
                            <td className="px-4 py-2" colSpan={4}>
                              <div className="flex items-center gap-2">
                                <Icons.Folder className="w-4 h-4 text-amber-500 shrink-0" />
                                <span>{d.name}</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    loadBrowse(d.path);
                                  }}
                                  className={`ml-auto text-xs ${muted} hover:text-teal-500`}
                                >
                                  {t.openFolder}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {filteredFiles.map((f) => (
                          <tr
                            key={f.path}
                            className={`border-b cursor-pointer ${
                              currentTrack?.path === f.path ? (isDark ? 'bg-teal-900/30' : 'bg-teal-50') : hoverRow
                            } ${isDark ? 'border-slate-800' : 'border-slate-100'}`}
                            onDoubleClick={() => playFile(f)}
                            onClick={() => playFile(f)}
                          >
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <Icons.Music2 className="w-4 h-4 text-teal-500 shrink-0" />
                                <span className="truncate">{f.name}</span>
                              </div>
                            </td>
                            <td className={`px-4 py-2 hidden md:table-cell ${muted}`}>—</td>
                            <td className={`px-4 py-2 hidden lg:table-cell ${muted}`}>—</td>
                            <td className={`px-4 py-2 text-right ${muted}`}>{f.size ? fmtBytes(f.size) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {browse && !browse.dirs.length && !filteredFiles.length && (
                      <div className={`p-8 text-center ${muted}`}>{t.noFiles}</div>
                    )}
                  </div>
                )
              )}
            </>
          )}
        </main>
      </div>

      {/* Player bar */}
      <div className={`border-t px-4 py-2 shrink-0 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50'}`}>
        <audio
          ref={audioRef}
          onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
          onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
          onEnded={onEnded}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={skipPrev} className="p-2 rounded-full hover:bg-black/10" title={t.prev}>
              <Icons.SkipBack className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="p-2 rounded-full bg-teal-600 text-white hover:bg-teal-500"
              title={playing ? t.pause : t.play}
            >
              {playing ? <Icons.Pause className="w-5 h-5" /> : <Icons.Play className="w-5 h-5" />}
            </button>
            <button type="button" onClick={skipNext} className="p-2 rounded-full hover:bg-black/10" title={t.next}>
              <Icons.SkipForward className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-3">
            {currentTrack && (
              <CoverThumb
                track={libTracks.find((x) => x.path === currentTrack.path) || { id: '', path: currentTrack.path, title: currentTrack.name, artist: '', album: '', genre: '' }}
                className="w-10 h-10 hidden sm:block"
              />
            )}
            <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{currentTrack?.name || '—'}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs tabular-nums ${muted}`}>{fmtTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                value={currentTime}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (audioRef.current) audioRef.current.currentTime = v;
                  setCurrentTime(v);
                }}
                className="flex-1 h-1 accent-teal-600"
              />
              <span className={`text-xs tabular-nums ${muted}`}>{fmtTime(duration)}</span>
            </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowQueue((s) => !s)}
            className={`p-2 rounded-md ${showQueue ? 'bg-teal-600/20 text-teal-500' : hoverRow}`}
            title={t.queue}
          >
            <Icons.ListMusic className="w-5 h-5" />
          </button>
        </div>
        {showQueue && (
          <div className={`mt-2 max-h-32 overflow-y-auto rounded border text-sm ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
            {queue.length === 0 ? (
              <div className={`p-3 ${muted}`}>{t.emptyQueue}</div>
            ) : (
              queue.map((item, i) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => {
                    setQueueIndex(i);
                    setPlaying(true);
                  }}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${
                    i === queueIndex ? (isDark ? 'bg-teal-900/40' : 'bg-teal-50') : hoverRow
                  }`}
                >
                  <span className={`w-5 text-xs ${muted}`}>{i + 1}</span>
                  <span className="truncate">{item.name}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* New playlist */}
      {newPlaylistOpen && (
        <Modal title={t.newPlaylist} onClose={() => setNewPlaylistOpen(false)} isDark={isDark}>
          <input
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.target.value)}
            placeholder={t.playlistName}
            className={`w-full px-3 py-2 text-sm rounded border mb-3 ${
              isDark ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-300'
            }`}
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setNewPlaylistOpen(false)} className={`px-3 py-1.5 text-sm rounded border ${isDark ? 'border-slate-600' : 'border-slate-300'}`}>
              {t.cancel}
            </button>
            <button type="button" onClick={createPlaylist} className="px-3 py-1.5 text-sm rounded bg-teal-600 text-white hover:bg-teal-500">
              {t.save}
            </button>
          </div>
        </Modal>
      )}

      {/* Settings */}
      {settingsOpen && settingsDraft && (
        <Modal title={t.settings} onClose={() => setSettingsOpen(false)} isDark={isDark} wide>
          <div className="space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${muted}`}>{t.libraryRoots}</label>
              <div className="space-y-2">
                {settingsDraft.library_roots.map((root) => (
                  <div key={root} className="flex items-center gap-2">
                    <code className={`flex-1 text-xs px-2 py-1.5 rounded border truncate ${isDark ? 'bg-slate-800 border-slate-600' : 'bg-slate-50 border-slate-300'}`}>
                      {root}
                    </code>
                    <button
                      type="button"
                      disabled={settingsDraft.library_roots.length <= 1}
                      onClick={() => removeRoot(root)}
                      className="p-1.5 text-red-500 hover:bg-red-500/10 rounded disabled:opacity-30"
                    >
                      <Icons.Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={openFolderPicker}
                className="mt-2 text-sm text-teal-600 hover:underline flex items-center gap-1"
              >
                <Icons.Plus className="w-4 h-4" />
                {t.addRoot}
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={settingsDraft.scan_on_startup}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, scan_on_startup: e.target.checked })}
              />
              {t.scanOnStartup}
            </label>
            {stats?.scan.status === 'running' && (
              <div className={`text-sm ${muted} flex items-center gap-2`}>
                <Icons.Loader2 className="w-4 h-4 animate-spin" />
                {t.scanning} ({stats.scan.files_indexed}/{stats.scan.files_found} {t.indexed})
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={runScan}
                disabled={stats?.scan.status === 'running'}
                className="px-3 py-1.5 text-sm rounded border border-teal-600 text-teal-600 hover:bg-teal-500/10 disabled:opacity-50"
              >
                {t.scanNow}
              </button>
              <div className="flex-1" />
              <button type="button" onClick={() => setSettingsOpen(false)} className={`px-3 py-1.5 text-sm rounded border ${isDark ? 'border-slate-600' : 'border-slate-300'}`}>
                {t.cancel}
              </button>
              <button type="button" onClick={saveSettings} className="px-3 py-1.5 text-sm rounded bg-teal-600 text-white hover:bg-teal-500">
                {t.save}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Folder picker */}
      {folderPicker && (
        <Modal title={t.selectFolder} onClose={() => { setFolderPicker(null); setPickerMode(null); }} isDark={isDark}>
          <div className={`text-xs mb-2 font-mono truncate ${muted}`}>{folderPicker.current}</div>
          <div className="flex flex-wrap gap-1 mb-2">
            {folderPicker.volumes.map((v) => (
              <button key={v.path} type="button" onClick={() => browsePicker(v.path)} className="text-xs px-2 py-0.5 rounded bg-teal-600/20 text-teal-600">
                {v.label}
              </button>
            ))}
          </div>
          {folderPicker.parent && (
            <button type="button" onClick={() => browsePicker(folderPicker.parent!)} className="text-sm text-teal-500 mb-2 flex items-center gap-1">
              <Icons.ArrowUp className="w-4 h-4" /> ..
            </button>
          )}
          <div className={`max-h-48 overflow-y-auto border rounded mb-3 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
            {folderPicker.entries.map((e) => (
              <button
                key={e.path}
                type="button"
                onClick={() => browsePicker(e.path)}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${hoverRow}`}
              >
                <Icons.Folder className="w-4 h-4 text-amber-500" />
                {e.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => pickFolder(folderPicker.current)}
            className="w-full py-2 text-sm rounded bg-teal-600 text-white hover:bg-teal-500"
          >
            {t.useThisFolder}
          </button>
        </Modal>
      )}
    </div>
  );
}
