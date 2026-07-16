/**
 * System Monitor Dashboard — mobile-first, light/dark, superadmin PID signals.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import ModuleViewport from '../../core/shell/ModuleViewport';
import WindowModal from '../../core/shell/WindowModal';
import { useIsWindowedModule } from '../../core/shell/WindowViewportContext';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import * as Icons from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  chromeContentBg,
  chromeNavIcon,
  chromeNavItem,
  chromePanel,
  chromeSidebar,
  chromeSidebarNav,
} from '../../core/desktopChrome';

interface ProcessInfo {
  pid: number;
  name: string;
  username?: string;
  cpu_percent?: number;
  memory_percent?: number;
  rss?: number;
  status?: string;
  num_threads?: number;
  create_time?: number;
  ppid?: number;
  cmdline_preview?: string;
}

interface ProcessDetail extends ProcessInfo {
  vms?: number;
  exe?: string;
  cwd?: string;
  cmdline?: string[];
  connections_tcp_udp?: number | null;
}

interface Pm2Process {
  name: string;
  pm_id: number;
  monit?: {
    memory?: number;
    cpu?: number;
  };
  pm2_env?: {
    status?: string;
    restart_time?: number;
  };
}

interface SystemStats {
  system: {
    system: string;
    platform: string;
    hostname: string;
    processor: string;
    cpu_model?: string;
    machine?: string;
    boot_time: number;
    uptime_seconds: number;
  };
  cpu: {
    percent: number;
    count: number;
    frequency?: {
      current: number;
      min: number;
      max: number;
    } | null;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percent: number;
    available: number;
    swap: {
      total: number;
      used: number;
      free: number;
      percent: number;
    };
  };
  disk: {
    partitions: Array<{
      device: string;
      mountpoint: string;
      fstype: string;
      total: number;
      used: number;
      free: number;
      percent: number;
    }>;
    aggregate?: {
      total: number;
      used: number;
      free: number;
      percent: number;
      filesystems_count: number;
    };
  };
  network: {
    bytes_sent: number;
    bytes_recv: number;
    packets_sent: number;
    packets_recv: number;
    connections: number;
  };
  processes: {
    total: number;
    running: number;
    sleeping?: number;
    stopped?: number;
    zombie?: number;
  };
  top_processes?: ProcessInfo[];
  pm2?: Pm2Process[];
}

interface HistoryData {
  time: string;
  cpu: number;
  memory: number;
}

type Language = 'en' | 'vi';
type ThemeMode = 'dark' | 'light';

const TEXT: Record<Language, Record<string, string>> = {
  en: {
    fetchStatsFailed: 'Failed to fetch stats',
    unknownError: 'Unknown error',
    pm2ActionFailed: 'Failed to perform {action} on PM2.',
    loadingRealtime: 'Loading real-time stats...',
    errorLabel: 'Error',
    heroTitle: 'System Information',
    heroSubtitle: 'Hardware, uptime, and live resource gauges.',
    uptime: 'Uptime',
    cpuCores: 'CPU Cores',
    connections: 'Connections',
    hostname: 'Hostname',
    os: 'OS',
    arch: 'Arch',
    model: 'Model',
    healthy: 'Healthy',
    systemStatus: 'Status',
    cpuModel: 'CPU',
    ramTotal: 'RAM total',
    diskTotal: 'Disk capacity',
    diskUsedFreeOf: '{used} used · {free} free · {total} total ({n} vol.)',
    storage: 'Storage',
    resources: 'Resources',
    activeProcesses: 'Processes',
    pm2Manager: 'PM2',
    cpuUsage: 'CPU Usage',
    memoryUsage: 'Memory Usage',
    diskUsage: 'Disk Usage',
    noDiskData: 'No disk data',
    activePids: 'Active PIDs',
    runningSleep: 'running {running} / sleep {sleeping}',
    resourceHistory: 'Resource history (last ~30s)',
    memoryDistribution: 'Memory distribution',
    used: 'Used',
    free: 'Free',
    available: 'Available',
    network: 'Network',
    upload: 'Upload',
    download: 'Download',
    packetsTxRx: 'Packets (TX/RX)',
    topDiskUsage: 'Disk usage',
    noDiskPartitionInfo: 'No disk partition information available.',
    topProcesses: 'Top processes',
    pid: 'PID',
    name: 'Name',
    user: 'User',
    cpuPercent: 'CPU %',
    memPercent: 'Mem %',
    rss: 'RSS',
    st: 'State',
    na: 'N/A',
    noActiveProcesses: 'No active processes captured.',
    pm2AppProcesses: 'PM2 Application Processes',
    pm2Subtitle: 'Lifecycle controls for Node apps.',
    refreshPm2: 'Refresh PM2',
    appName: 'App Name',
    id: 'Id',
    status: 'Status',
    memory: 'Memory',
    cpu: 'CPU',
    restarts: 'Restarts',
    actions: 'Actions',
    stop: 'Stop',
    start: 'Start',
    restart: 'Restart',
    delete: 'Delete',
    pm2Empty: 'PM2 is not installed or no running apps found.',
    details: 'Details',
    gracefulEnd: 'End (SIGTERM)',
    forceKill: 'Force kill (SIGKILL)',
    confirmAction: 'Confirm signal',
    confirmTerm: 'Send SIGTERM to PID {pid} ({name})? The process can shut down cleanly.',
    confirmKill: 'Send SIGKILL to PID {pid} ({name})? This cannot be undone. Use for stuck processes.',
    cancel: 'Cancel',
    apply: 'Confirm',
    processDetail: 'Process detail',
    threads: 'Threads',
    ppid: 'Parent PID',
    cmdline: 'Command line',
    copyPid: 'Copy PID',
    signalOk: 'Signal sent.',
    signalFail: 'Action failed',
    adminPidHint: 'Only superadmins can send signals to processes.',
    close: 'Close',
    searchPlaceholder: 'Filter by name or PID…',
    detailFromList: 'From process list (snapshot)',
    detailBadResponse: 'Invalid response from server.',
  },
  vi: {
    fetchStatsFailed: 'Không thể lấy thống kê',
    unknownError: 'Lỗi không xác định',
    pm2ActionFailed: 'Không thể thực hiện {action} trên PM2.',
    loadingRealtime: 'Đang tải thống kê thời gian thực...',
    errorLabel: 'Lỗi',
    heroTitle: 'Thông tin hệ thống',
    heroSubtitle: 'Phần cứng, uptime và đồng hồ tài nguyên thời gian thực.',
    uptime: 'Thời gian hoạt động',
    cpuCores: 'Số nhân CPU',
    connections: 'Kết nối',
    hostname: 'Tên máy',
    os: 'Hệ điều hành',
    arch: 'Kiến trúc',
    model: 'Model',
    healthy: 'Ổn định',
    systemStatus: 'Trạng thái',
    cpuModel: 'CPU',
    ramTotal: 'Tổng RAM',
    diskTotal: 'Dung lượng ổ đĩa',
    diskUsedFreeOf: '{used} đã dùng · {free} trống · {total} tổng ({n} phân vùng)',
    storage: 'Lưu trữ',
    resources: 'Tài nguyên',
    activeProcesses: 'Tiến trình',
    pm2Manager: 'PM2',
    cpuUsage: 'Mức dùng CPU',
    memoryUsage: 'Mức dùng RAM',
    diskUsage: 'Mức dùng ổ đĩa',
    noDiskData: 'Không có dữ liệu ổ đĩa',
    activePids: 'PID đang hoạt động',
    runningSleep: 'đang chạy {running} / ngủ {sleeping}',
    resourceHistory: 'Lịch sử tài nguyên (~30 giây gần nhất)',
    memoryDistribution: 'Phân bổ bộ nhớ',
    used: 'Đã dùng',
    free: 'Còn trống',
    available: 'Khả dụng',
    network: 'Mạng',
    upload: 'Tải lên',
    download: 'Tải xuống',
    packetsTxRx: 'Gói tin (TX/RX)',
    topDiskUsage: 'Ổ đĩa',
    noDiskPartitionInfo: 'Không có thông tin phân vùng ổ đĩa.',
    topProcesses: 'Tiến trình hàng đầu',
    pid: 'PID',
    name: 'Tên',
    user: 'Người dùng',
    cpuPercent: 'CPU %',
    memPercent: 'RAM %',
    rss: 'RSS',
    st: 'TT',
    na: 'Không có',
    noActiveProcesses: 'Không có tiến trình.',
    pm2AppProcesses: 'Tiến trình PM2',
    pm2Subtitle: 'Điều khiển vòng đời ứng dụng Node.',
    refreshPm2: 'Làm mới PM2',
    appName: 'Tên ứng dụng',
    id: 'ID',
    status: 'Trạng thái',
    memory: 'Bộ nhớ',
    cpu: 'CPU',
    restarts: 'Khởi động lại',
    actions: 'Thao tác',
    stop: 'Dừng',
    start: 'Chạy',
    restart: 'Khởi động lại',
    delete: 'Xóa',
    pm2Empty: 'PM2 chưa cài hoặc không có ứng dụng.',
    details: 'Chi tiết',
    gracefulEnd: 'Kết thúc (SIGTERM)',
    forceKill: 'Buộc dừng (SIGKILL)',
    confirmAction: 'Xác nhận tín hiệu',
    confirmTerm: 'Gửi SIGTERM tới PID {pid} ({name})? Tiến trình có thể thoát gọn.',
    confirmKill: 'Gửi SIGKILL tới PID {pid} ({name})? Không hoàn tác. Dùng khi tiến trình bị kẹt.',
    cancel: 'Hủy',
    apply: 'Xác nhận',
    processDetail: 'Chi tiết tiến trình',
    threads: 'Luồng',
    ppid: 'PID cha',
    cmdline: 'Dòng lệnh',
    copyPid: 'Copy PID',
    signalOk: 'Đã gửi tín hiệu.',
    signalFail: 'Thất bại',
    adminPidHint: 'Chỉ superadmin mới gửi tín hiệu tới tiến trình.',
    close: 'Đóng',
    searchPlaceholder: 'Lọc theo tên hoặc PID…',
    detailFromList: 'Từ danh sách (ảnh chụp)',
    detailBadResponse: 'Phản hồi từ máy chủ không hợp lệ.',
  },
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

function RingGauge({
  percent,
  label,
  sub,
  color,
  track,
}: {
  percent: number;
  label: string;
  sub?: string;
  color: string;
  track: string;
}) {
  const p = Math.max(0, Math.min(100, percent));
  const r = 42;
  const c = 2 * Math.PI * r;
  const offset = c - (p / 100) * c;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke={track} strokeWidth="8" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            className="transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums">{p.toFixed(1)}%</span>
        </div>
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      {sub && <p className="max-w-[11rem] truncate text-center text-[10px] opacity-70">{sub}</p>}
    </div>
  );
}

const formatUptime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

function diskAggregateFromPartitions(
  parts: SystemStats['disk']['partitions']
): NonNullable<SystemStats['disk']['aggregate']> {
  const seen = new Set<string>();
  let total = 0;
  let used = 0;
  let free = 0;
  for (const p of parts) {
    const key = p.device || p.mountpoint;
    if (seen.has(key)) continue;
    seen.add(key);
    total += p.total || 0;
    used += p.used || 0;
    free += p.free || 0;
  }
  const percent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
  return { total, used, free, percent, filesystems_count: seen.size };
}

export default function SystemMonitorDashboard() {
  const { theme: outletTheme, language: outletLanguage } = useAppShellContext();
  const isWindowed = useIsWindowedModule();
  const language: Language = outletLanguage === 'vi' ? 'vi' : 'en';
  const theme: ThemeMode = outletTheme === 'dark' ? 'dark' : 'light';
  const isDark = theme === 'dark';
  const tr = TEXT[language];
  const trf = (key: string, vars: Record<string, string | number> = {}) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), tr[key] || key);

  const token = localStorage.getItem('copanel_token');
  const authHeaders = useMemo((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

  const [stats, setStats] = useState<SystemStats | null>(null);
  const [history, setHistory] = useState<HistoryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'resources' | 'processes' | 'pm2'>('resources');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [procFilter, setProcFilter] = useState('');
  const [detailPid, setDetailPid] = useState<number | null>(null);
  const [detailPreview, setDetailPreview] = useState<ProcessInfo | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<ProcessDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [signalModal, setSignalModal] = useState<{
    pid: number;
    name: string;
    signal: 'term' | 'kill';
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const chartStroke = {
    grid: isDark ? '#334155' : '#e2e8f0',
    axis: isDark ? '#64748b' : '#64748b',
    tooltipBg: isDark ? '#1e293b' : '#ffffff',
    tooltipBorder: isDark ? '#475569' : '#cbd5e1',
    tooltipText: isDark ? '#f1f5f9' : '#0f172a',
  };

  useEffect(() => {
    if (!token) return;
    fetch('/api/auth/me', { headers: { ...authHeaders } })
      .then((r) => r.json())
      .then((d) => setIsSuperadmin(d?.user?.role === 'superadmin'))
      .catch(() => setIsSuperadmin(false));
  }, [token, authHeaders]);

  const fetchStats = useCallback(async () => {
    const t = TEXT[language];
    try {
      const response = await fetch('/api/system_monitor/stats', { headers: { ...authHeaders } });
      if (!response.ok) throw new Error(t.fetchStatsFailed);
      const data = await response.json();
      setStats(data.data as SystemStats);

      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      setHistory((prev) => [
        ...prev.slice(-29),
        {
          time: timeStr,
          cpu: data.data.cpu.percent || 0,
          memory: data.data.memory.percent || 0,
        },
      ]);

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.unknownError);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, language]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 4000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  useEffect(() => {
    if (detailPid === null) {
      setDetailData(null);
      setDetailError(null);
      setDetailPreview(null);
      return;
    }
    const ac = new AbortController();
    const t = TEXT[language];
    setDetailLoading(true);
    setDetailError(null);
    setDetailData(null);

    const parseDetail = (body: unknown): ProcessDetail => {
      if (!body || typeof body !== 'object') throw new Error(t.detailBadResponse);
      const o = body as Record<string, unknown>;
      if (o.status === 'success' && o.data && typeof o.data === 'object') {
        return o.data as ProcessDetail;
      }
      if (o.data && typeof o.data === 'object') return o.data as ProcessDetail;
      throw new Error(t.detailBadResponse);
    };

    const isAbort = (e: unknown) =>
      (e instanceof DOMException && e.name === 'AbortError') ||
      (typeof e === 'object' && e !== null && 'name' in e && (e as { name: string }).name === 'AbortError');

    fetch(`/api/system_monitor/process/${detailPid}`, { headers: { ...authHeaders }, signal: ac.signal })
      .then(async (r) => {
        const text = await r.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = null;
        }
        if (!r.ok) {
          const b = body as Record<string, unknown> | null;
          const det = b?.detail;
          let msg: string;
          if (typeof det === 'string') msg = det;
          else if (Array.isArray(det))
            msg = det.map((x: { msg?: string }) => x?.msg || '').filter(Boolean).join('; ') || `HTTP ${r.status}`;
          else msg = `HTTP ${r.status}`;
          throw new Error(msg);
        }
        setDetailData(parseDetail(body));
      })
      .catch((e: unknown) => {
        if (isAbort(e)) return;
        setDetailData(null);
        setDetailError(e instanceof Error ? e.message : t.unknownError);
      })
      .finally(() => {
        if (!ac.signal.aborted) setDetailLoading(false);
      });

    return () => ac.abort();
  }, [detailPid, authHeaders, language]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const handlePm2Action = async (action: string, id: string | number) => {
    setActionLoading(`${action}-${id}`);
    try {
      const res = await fetch(`/api/system_monitor/pm2/${action}/${id}`, {
        method: 'POST',
        headers: { ...authHeaders },
      });
      if (res.ok) {
        fetchStats();
      } else {
        const d = await res.json();
        alert(d.detail || trf('pm2ActionFailed', { action }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const sendSignal = async () => {
    if (!signalModal || !token) return;
    const { pid, signal } = signalModal;
    try {
      const res = await fetch(`/api/system_monitor/process/${pid}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ signal }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast(tr.signalOk);
        setSignalModal(null);
        setDetailPid((p) => (p === pid ? null : p));
        fetchStats();
      } else {
        setToast(`${tr.signalFail}: ${d.detail || res.status}`);
      }
    } catch {
      setToast(tr.signalFail);
    }
  };

  const shellText = isDark ? 'text-slate-50' : 'text-slate-900';
  const cardMuted = isDark ? 'bg-slate-900/50 border-slate-800/80' : 'bg-white/90 border-slate-200';
  const textMuted = isDark ? 'text-slate-400' : 'text-slate-600';
  const textHeading = isDark ? 'text-slate-200' : 'text-slate-800';
  const btnSecondary = isDark
    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'
    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200';

  if (loading && !stats) {
    return (
      <ModuleViewport constrained>
        <div className={cn('flex flex-col h-full min-h-0 items-center justify-center', shellText)}>
          <Icons.Loader className={cn('w-12 h-12 mb-4 animate-spin', isDark ? 'text-blue-400' : 'text-blue-600')} />
          <p className={cn('text-sm', textMuted)}>{tr.loadingRealtime}</p>
        </div>
      </ModuleViewport>
    );
  }

  if (error) {
    return (
      <ModuleViewport constrained>
        <div className={cn('flex flex-col h-full min-h-0 p-4', shellText)}>
          <div
            className={cn(
              'max-w-xl rounded-xl border p-4',
              isDark ? 'bg-red-950/30 border-red-800/50 text-red-300' : 'bg-red-50 border-red-200 text-red-800'
            )}
          >
            <p className="text-xs font-bold flex items-center gap-2">
              <Icons.AlertCircle className="w-4 h-4 shrink-0" />
              {tr.errorLabel}: {error}
            </p>
          </div>
        </div>
      </ModuleViewport>
    );
  }

  if (!stats) return null;

  const diskData = stats.disk.partitions || [];
  const cpuPercent = stats.cpu.percent || 0;
  const memPercent = stats.memory.percent || 0;
  const diskPercent = diskData.length ? Math.max(...diskData.map((p) => p.percent || 0)) : 0;

  const diskAgg =
    stats.disk.aggregate && stats.disk.aggregate.total > 0
      ? stats.disk.aggregate
      : diskAggregateFromPartitions(diskData);

  const cpuDisplayName = (stats.system.cpu_model || stats.system.processor || '').trim();

  const filteredProcesses = (stats.top_processes || []).filter((p) => {
    const q = procFilter.trim().toLowerCase();
    if (!q) return true;
    return String(p.pid).includes(q) || (p.name || '').toLowerCase().includes(q);
  });

  const procCount = stats.top_processes?.length ?? 0;

  const sidebarTabs = [
    { id: 'resources' as const, label: tr.resources, icon: Icons.Activity },
    { id: 'processes' as const, label: `${tr.activeProcesses} (${procCount})`, icon: Icons.Cpu },
    { id: 'pm2' as const, label: `${tr.pm2Manager} (${stats.pm2?.length || 0})`, icon: Icons.Terminal },
  ];

  return (
    <ModuleViewport constrained>
      <div className={cn('flex flex-col h-full min-h-0', shellText)}>
        {toast && (
          <div
            className={cn(
              'shrink-0 mx-4 mt-2 rounded-xl px-4 py-2 text-xs font-bold border',
              isDark ? 'bg-slate-900 border-slate-700 text-emerald-400' : 'bg-white border-slate-200 text-emerald-700'
            )}
          >
            {toast}
          </div>
        )}

        <header
          className={cn(
            'shrink-0 px-4 py-3 border-b flex items-center justify-between gap-3',
            isDark ? 'border-slate-700' : 'border-slate-200'
          )}
        >
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate">{tr.heroTitle}</h1>
            <p className={cn('text-xs truncate', textMuted)}>{tr.heroSubtitle}</p>
          </div>
          <div className={cn('shrink-0 rounded-lg border px-3 py-1.5 text-right', isDark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-200 bg-white')}>
            <span className={cn('text-[10px] font-semibold uppercase tracking-wider', isDark ? 'text-sky-400' : 'text-sky-600')}>
              {tr.hostname}
            </span>
            <p className={cn('text-sm font-mono font-bold truncate max-w-[10rem]', isDark ? 'text-slate-100' : 'text-slate-900')}>
              {stats.system.hostname}
            </p>
          </div>
        </header>

        <div className="flex flex-1 min-h-0">
          <aside className={chromeSidebar(isDark, 'sm')}>
            <nav className={chromeSidebarNav()} aria-label="System monitor sections">
              {sidebarTabs.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={chromeNavItem(isDark, isActive, 'sky')}
                  >
                    <Icon className={chromeNavIcon(isDark, isActive, 'sky')} />
                    <span className="truncate text-left text-xs font-semibold">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className={cn('flex-1 min-h-0 overflow-y-auto p-4 space-y-4', chromeContentBg(isDark), isWindowed ? '' : 'max-w-7xl')}>
      {activeTab === 'resources' && (
        <div className="space-y-4">
          {/* ADM-style 2×2 overview */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className={cn(chromePanel(isDark), 'p-4 flex gap-4 items-start')}>
              <div
                className={cn(
                  'flex h-16 w-16 shrink-0 items-center justify-center rounded-xl',
                  isDark ? 'bg-slate-800' : 'bg-slate-100',
                )}
              >
                <Icons.Server className={cn('h-8 w-8', isDark ? 'text-sky-400' : 'text-sky-600')} />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                <div>
                  <p className={cn('text-[10px] font-bold uppercase tracking-wider', textMuted)}>{tr.model}</p>
                  <p className={cn('font-semibold truncate', textHeading)}>{stats.system.hostname}</p>
                </div>
                <div className="grid grid-cols-1 gap-1 text-xs">
                  <p>
                    <span className={textMuted}>{tr.os}: </span>
                    <span className="font-medium">{stats.system.system}</span>
                  </p>
                  {stats.system.machine && (
                    <p>
                      <span className={textMuted}>{tr.arch}: </span>
                      <span className="font-mono font-medium">{stats.system.machine}</span>
                    </p>
                  )}
                  {cpuDisplayName && (
                    <p className="line-clamp-2">
                      <span className={textMuted}>{tr.cpuModel}: </span>
                      <span className="font-medium">{cpuDisplayName}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className={cn(chromePanel(isDark), 'p-4 flex gap-4 items-center')}>
              <div
                className={cn(
                  'flex h-16 w-16 shrink-0 items-center justify-center rounded-full',
                  isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-50 text-emerald-600',
                )}
              >
                <Icons.CheckCircle2 className="h-9 w-9" />
              </div>
              <div className="min-w-0 space-y-1">
                <p className={cn('text-[10px] font-bold uppercase tracking-wider', textMuted)}>{tr.systemStatus}</p>
                <p className={cn('text-xl font-bold', isDark ? 'text-emerald-400' : 'text-emerald-600')}>{tr.healthy}</p>
                <p className={cn('text-xs', textMuted)}>
                  {tr.uptime}: {formatUptime(stats.system.uptime_seconds)}
                </p>
                <p className={cn('text-xs', textMuted)}>
                  {tr.cpuCores}: {stats.cpu.count} · {tr.connections}: {stats.network.connections}
                </p>
              </div>
            </div>

            <div className={cn(chromePanel(isDark), 'p-5 flex flex-wrap items-center justify-around gap-6')}>
              <RingGauge
                percent={cpuPercent}
                label={tr.cpuUsage}
                sub={cpuDisplayName || undefined}
                color={isDark ? '#38bdf8' : '#0284c7'}
                track={isDark ? '#1e293b' : '#e2e8f0'}
              />
              <RingGauge
                percent={memPercent}
                label={tr.memoryUsage}
                sub={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
                color={isDark ? '#34d399' : '#059669'}
                track={isDark ? '#1e293b' : '#e2e8f0'}
              />
            </div>

            <div className={cn(chromePanel(isDark), 'p-4 space-y-4')}>
              <div>
                <h2 className={cn('text-xs font-bold uppercase tracking-wide mb-2', textHeading)}>{tr.network}</h2>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className={textMuted}>{tr.upload}</span>
                    <span className="font-mono font-semibold">{formatBytes(stats.network.bytes_sent)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className={textMuted}>{tr.download}</span>
                    <span className="font-mono font-semibold">{formatBytes(stats.network.bytes_recv)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className={textMuted}>{tr.packetsTxRx}</span>
                    <span className="font-semibold">
                      {stats.network.packets_sent.toLocaleString()} / {stats.network.packets_recv.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
              <div className={cn('border-t pt-3', isDark ? 'border-slate-700' : 'border-slate-200')}>
                <h2 className={cn('text-xs font-bold uppercase tracking-wide mb-2', textHeading)}>{tr.storage}</h2>
                <div className="flex items-center justify-between gap-2 text-xs mb-2">
                  <span className={cn('font-medium', isDark ? 'text-emerald-400' : 'text-emerald-600')}>{tr.healthy}</span>
                  <span className={textMuted}>{diskPercent.toFixed(1)}%</span>
                </div>
                <div className={cn('w-full rounded-full h-1.5 overflow-hidden mb-2', isDark ? 'bg-slate-800' : 'bg-slate-200')}>
                  <div className="h-1.5 rounded-full bg-amber-500 transition-all" style={{ width: `${Math.min(100, diskPercent)}%` }} />
                </div>
                <p className={cn('text-[11px] leading-snug', textMuted)}>
                  {trf('diskUsedFreeOf', {
                    used: formatBytes(diskAgg.used),
                    free: formatBytes(diskAgg.free),
                    total: formatBytes(diskAgg.total),
                    n: diskAgg.filesystems_count,
                  })}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className={cn(chromePanel(isDark), 'p-4')}>
              <h2 className={cn('text-xs font-bold uppercase tracking-wide mb-3', textHeading)}>{tr.resourceHistory}</h2>
              <div className="h-[200px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartStroke.grid} />
                    <XAxis dataKey="time" stroke={chartStroke.axis} tick={{ fontSize: 10 }} />
                    <YAxis stroke={chartStroke.axis} tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: chartStroke.tooltipBg,
                        border: `1px solid ${chartStroke.tooltipBorder}`,
                        borderRadius: '0.5rem',
                        color: chartStroke.tooltipText,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="cpu" stroke={isDark ? '#38bdf8' : '#0284c7'} dot={false} isAnimationActive={false} name="CPU" />
                    <Line type="monotone" dataKey="memory" stroke={isDark ? '#34d399' : '#059669'} dot={false} isAnimationActive={false} name="RAM" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className={cn(chromePanel(isDark), 'p-4')}>
              <h2 className={cn('text-xs font-bold uppercase tracking-wide mb-3', textHeading)}>{tr.topDiskUsage}</h2>
              <div className="space-y-3">
                {diskData.slice(0, 5).map((partition) => (
                  <div key={`${partition.device}-${partition.mountpoint}`}>
                    <div className="flex justify-between text-[10px] sm:text-xs mb-1 gap-2">
                      <span className={cn('truncate', isDark ? 'text-slate-300' : 'text-slate-700')}>{partition.mountpoint}</span>
                      <span className={textMuted}>{partition.percent.toFixed(1)}%</span>
                    </div>
                    <div className={cn('w-full rounded-full h-1.5 overflow-hidden', isDark ? 'bg-slate-800' : 'bg-slate-200')}>
                      <div className="bg-amber-500 h-1.5 rounded-full transition-all" style={{ width: `${partition.percent}%` }} />
                    </div>
                  </div>
                ))}
                {!diskData.length && <p className={cn('text-xs', textMuted)}>{tr.noDiskPartitionInfo}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'processes' && (
        <div className={cn('rounded-2xl p-3 sm:p-6 space-y-3', cardMuted)}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
            <h3 className={cn('text-xs sm:text-sm font-bold uppercase tracking-wider', textHeading)}>{tr.topProcesses}</h3>
            <input
              type="search"
              value={procFilter}
              onChange={(e) => setProcFilter(e.target.value)}
              placeholder={tr.searchPlaceholder}
              className={cn(
                'w-full sm:max-w-xs rounded-xl border px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500/40',
                isDark ? 'bg-slate-950/50 border-slate-700 text-slate-100 placeholder:text-slate-500' : 'bg-white border-slate-200 text-slate-900'
              )}
            />
          </div>
          {!isSuperadmin && (
            <p className={cn('text-[10px] sm:text-xs', textMuted)}>{tr.adminPidHint}</p>
          )}
          {filteredProcesses.length > 0 ? (
            <div className={cn('overflow-x-auto rounded-xl border', isDark ? 'border-slate-800/60' : 'border-slate-200')}>
              <table className="w-full text-left border-collapse min-w-[640px]">
                <thead>
                  <tr
                    className={cn(
                      'text-[10px] font-bold uppercase tracking-widest border-b',
                      isDark ? 'bg-slate-950/60 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
                    )}
                  >
                    <th className={cn('p-2 sm:p-3 sticky left-0 z-10', isDark ? 'bg-slate-950/95' : 'bg-slate-50')}>{tr.pid}</th>
                    <th className="p-2 sm:p-3">{tr.name}</th>
                    <th className="p-2 sm:p-3 hidden md:table-cell">{tr.user}</th>
                    <th className="p-2 sm:p-3">{tr.cpuPercent}</th>
                    <th className="p-2 sm:p-3">{tr.memPercent}</th>
                    <th className="p-2 sm:p-3 hidden lg:table-cell">{tr.rss}</th>
                    <th className="p-2 sm:p-3 hidden lg:table-cell">{tr.st}</th>
                    <th className="p-2 sm:p-3 text-right">{tr.actions}</th>
                  </tr>
                </thead>
                <tbody className={cn('text-[10px] sm:text-xs divide-y font-mono', isDark ? 'divide-slate-800/50 text-slate-200' : 'divide-slate-100 text-slate-800')}>
                  {filteredProcesses.map((proc) => (
                    <tr key={proc.pid} className={isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}>
                      <td
                        className={cn(
                          'p-2 sm:p-3 sticky left-0 z-[1] font-bold text-indigo-500',
                          isDark ? 'bg-slate-900/98' : 'bg-white'
                        )}
                      >
                        {proc.pid}
                      </td>
                      <td className={cn('p-2 sm:p-3 max-w-[140px] sm:max-w-xs truncate', isDark ? 'text-slate-100' : 'text-slate-900')}>{proc.name}</td>
                      <td className={cn('p-2 sm:p-3 hidden md:table-cell max-w-[100px] truncate', textMuted)}>{proc.username || tr.na}</td>
                      <td className="p-2 sm:p-3 text-blue-500">{((proc.cpu_percent || 0)).toFixed(1)}%</td>
                      <td className="p-2 sm:p-3 text-red-500">{((proc.memory_percent || 0)).toFixed(1)}%</td>
                      <td className={cn('p-2 sm:p-3 hidden lg:table-cell', textMuted)}>{formatBytes(proc.rss || 0)}</td>
                      <td className={cn('p-2 sm:p-3 hidden lg:table-cell', textMuted)}>{proc.status || tr.na}</td>
                      <td className="p-2 sm:p-3 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setDetailPreview(proc);
                              setDetailPid(proc.pid);
                            }}
                            className={cn(
                              'px-2 py-1 rounded-lg text-[10px] font-bold border',
                              isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-100 border-slate-200 text-slate-800'
                            )}
                          >
                            {tr.details}
                          </button>
                          {isSuperadmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => setSignalModal({ pid: proc.pid, name: proc.name, signal: 'term' })}
                                className={cn(
                                  'px-2 py-1 rounded-lg text-[10px] font-bold border',
                                  isDark ? 'bg-amber-950/40 border-amber-800/50 text-amber-400' : 'bg-amber-50 border-amber-200 text-amber-800'
                                )}
                              >
                                SIGTERM
                              </button>
                              <button
                                type="button"
                                onClick={() => setSignalModal({ pid: proc.pid, name: proc.name, signal: 'kill' })}
                                className={cn(
                                  'px-2 py-1 rounded-lg text-[10px] font-bold border',
                                  isDark ? 'bg-red-950/50 border-red-800/50 text-red-400' : 'bg-red-50 border-red-200 text-red-700'
                                )}
                              >
                                SIGKILL
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={cn('text-xs', textMuted)}>{tr.noActiveProcesses}</p>
          )}
        </div>
      )}

      {activeTab === 'pm2' && (
        <div className={cn('rounded-2xl p-3 sm:p-6 space-y-4', cardMuted)}>
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-3">
            <div>
              <h3 className={cn('text-xs sm:text-sm font-bold uppercase tracking-wider', textHeading)}>{tr.pm2AppProcesses}</h3>
              <p className={cn('text-[10px] sm:text-xs', textMuted)}>{tr.pm2Subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => fetchStats()}
              className={cn(
                'flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-xl border font-bold',
                isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
              )}
            >
              <Icons.RefreshCw className="w-3.5 h-3.5" /> {tr.refreshPm2}
            </button>
          </div>

          {stats.pm2 && stats.pm2.length > 0 ? (
            <div className={cn('overflow-x-auto rounded-xl border', isDark ? 'border-slate-800/60' : 'border-slate-200')}>
              <table className="w-full text-left border-collapse min-w-[560px]">
                <thead>
                  <tr
                    className={cn(
                      'text-[10px] font-bold uppercase tracking-widest border-b',
                      isDark ? 'bg-slate-950/60 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
                    )}
                  >
                    <th className="p-3">{tr.appName}</th>
                    <th className="p-3">{tr.id}</th>
                    <th className="p-3">{tr.status}</th>
                    <th className="p-3">{tr.memory}</th>
                    <th className="p-3">{tr.cpu}</th>
                    <th className="p-3">{tr.restarts}</th>
                    <th className="p-3 text-right">{tr.actions}</th>
                  </tr>
                </thead>
                <tbody className={cn('text-xs divide-y', isDark ? 'divide-slate-800/50 text-slate-200' : 'divide-slate-100 text-slate-800')}>
                  {stats.pm2.map((app) => {
                    const isRunning = app.pm2_env?.status === 'online';
                    return (
                      <tr key={`${app.pm_id}-${app.name}`} className={isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}>
                        <td className="p-3 font-bold text-blue-500">{app.name}</td>
                        <td className="p-3 font-mono">{app.pm_id}</td>
                        <td className="p-3">
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded border text-[10px]',
                              isRunning
                                ? isDark
                                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                  : 'bg-green-50 text-green-700 border-green-200'
                                : isDark
                                  ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                  : 'bg-red-50 text-red-700 border-red-200'
                            )}
                          >
                            {app.pm2_env?.status || tr.na}
                          </span>
                        </td>
                        <td className="p-3">{formatBytes(app.monit?.memory || 0)}</td>
                        <td className="p-3">{app.monit?.cpu || 0}%</td>
                        <td className="p-3">{app.pm2_env?.restart_time || 0}</td>
                        <td className="p-3 text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            {isRunning ? (
                              <button
                                type="button"
                                onClick={() => handlePm2Action('stop', app.name)}
                                disabled={actionLoading !== null}
                                className={cn(
                                  'px-2 py-1 text-[10px] font-bold rounded-lg border',
                                  isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'
                                )}
                              >
                                {tr.stop}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handlePm2Action('start', app.name)}
                                disabled={actionLoading !== null}
                                className={cn(
                                  'px-2 py-1 text-[10px] font-bold rounded-lg border',
                                  isDark
                                    ? 'border-green-800/50 bg-green-950/40 text-green-400'
                                    : 'border-green-200 bg-green-50 text-green-800'
                                )}
                              >
                                {tr.start}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handlePm2Action('restart', app.name)}
                              disabled={actionLoading !== null}
                              className={cn(
                                'px-2 py-1 text-[10px] font-bold rounded-lg border',
                                isDark ? 'bg-indigo-950/40 border-indigo-800 text-indigo-400' : 'bg-indigo-50 border-indigo-200 text-indigo-800'
                              )}
                            >
                              {tr.restart}
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePm2Action('delete', app.name)}
                              disabled={actionLoading !== null}
                              className={cn(
                                'px-2 py-1 text-[10px] font-bold rounded-lg border',
                                isDark ? 'bg-red-950/40 border-red-800 text-red-400' : 'bg-red-50 border-red-200 text-red-700'
                              )}
                            >
                              {tr.delete}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={cn('p-4 rounded-xl border text-xs', isDark ? 'border-slate-800 bg-slate-950/40 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600')}>
              {tr.pm2Empty}
            </div>
          )}
        </div>
      )}
          </main>
        </div>
      </div>

      <WindowModal open={!!signalModal} onClose={() => setSignalModal(null)} title={tr.confirmAction} maxWidth="md">
        <div className="space-y-4 p-4">
            <p className={cn('text-xs leading-relaxed', textMuted)}>
              {signalModal?.signal === 'kill'
                ? trf('confirmKill', { pid: signalModal.pid, name: signalModal.name })
                : signalModal
                  ? trf('confirmTerm', { pid: signalModal.pid, name: signalModal.name })
                  : ''}
            </p>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button
                type="button"
                onClick={() => setSignalModal(null)}
                className={cn(
                  'px-4 py-2 rounded-xl text-xs font-bold',
                  isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                )}
              >
                {tr.cancel}
              </button>
              <button
                type="button"
                onClick={sendSignal}
                className={cn(
                  'px-4 py-2 rounded-xl text-xs font-bold text-white',
                  signalModal?.signal === 'kill' ? 'bg-red-600 hover:bg-red-500' : 'bg-amber-600 hover:bg-amber-500'
                )}
              >
                {tr.apply}
              </button>
            </div>
        </div>
      </WindowModal>

      <WindowModal
        open={detailPid !== null}
        onClose={() => setDetailPid(null)}
        title={tr.processDetail}
        maxWidth="md"
        className="flex max-h-[85vh] flex-col overflow-hidden"
      >
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {detailLoading && (
              <div className="flex flex-col items-center gap-2 py-6">
                <Icons.Loader className="w-8 h-8 animate-spin text-blue-500" />
                {detailPreview && (
                  <p className={cn('text-center text-[11px]', textMuted)}>
                    PID {detailPreview.pid} · {detailPreview.name}
                  </p>
                )}
              </div>
            )}
            {!detailLoading && detailData && (
              <div className={cn('space-y-3 text-xs', textMuted)}>
                <div className="flex flex-wrap gap-2">
                  <span className={cn('font-mono font-bold text-lg', isDark ? 'text-indigo-400' : 'text-indigo-600')}>PID {detailData.pid}</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(String(detailData.pid))}
                    className={cn('text-[10px] font-bold underline', isDark ? 'text-blue-400' : 'text-blue-600')}
                  >
                    {tr.copyPid}
                  </button>
                </div>
                <p className={cn('font-semibold', isDark ? 'text-slate-100' : 'text-slate-900')}>{detailData.name}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="block text-[10px] uppercase">{tr.cpuPercent}</span>
                    <span className={cn('font-mono', isDark ? 'text-slate-200' : 'text-slate-800')}>{(detailData.cpu_percent || 0).toFixed(1)}%</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase">{tr.memPercent}</span>
                    <span className={cn('font-mono', isDark ? 'text-slate-200' : 'text-slate-800')}>{(detailData.memory_percent || 0).toFixed(1)}%</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase">{tr.rss}</span>
                    <span className="font-mono">{formatBytes(detailData.rss || 0)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase">VMS</span>
                    <span className="font-mono">{formatBytes(detailData.vms || 0)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase">{tr.status}</span>
                    <span>{detailData.status || tr.na}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase">{tr.threads}</span>
                    <span>{detailData.num_threads ?? tr.na}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase">{tr.ppid}</span>
                    <span>{detailData.ppid ?? tr.na}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase">TCP/UDP</span>
                    <span>{detailData.connections_tcp_udp ?? tr.na}</span>
                  </div>
                </div>
                {detailData.exe && (
                  <div>
                    <span className="block text-[10px] uppercase mb-1">Exe</span>
                    <p className={cn('break-all font-mono text-[10px]', isDark ? 'text-slate-300' : 'text-slate-700')}>{detailData.exe}</p>
                  </div>
                )}
                {detailData.cwd && (
                  <div>
                    <span className="block text-[10px] uppercase mb-1">CWD</span>
                    <p className={cn('break-all font-mono text-[10px]', isDark ? 'text-slate-300' : 'text-slate-700')}>{detailData.cwd}</p>
                  </div>
                )}
                <div>
                  <span className="block text-[10px] uppercase mb-1">{tr.cmdline}</span>
                  <pre
                    className={cn(
                      'whitespace-pre-wrap break-all rounded-lg p-2 text-[10px] font-mono max-h-40 overflow-y-auto',
                      isDark ? 'bg-slate-950 border border-slate-800 text-slate-300' : 'bg-slate-50 border border-slate-200 text-slate-800'
                    )}
                  >
                    {(detailData.cmdline || []).join(' ') || detailData.cmdline_preview || tr.na}
                  </pre>
                </div>
                {isSuperadmin && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDetailPid(null);
                        setSignalModal({ pid: detailData.pid, name: detailData.name, signal: 'term' });
                      }}
                      className="flex-1 min-w-[120px] px-3 py-2 rounded-xl text-[10px] font-bold bg-amber-600 text-white"
                    >
                      {tr.gracefulEnd}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDetailPid(null);
                        setSignalModal({ pid: detailData.pid, name: detailData.name, signal: 'kill' });
                      }}
                      className="flex-1 min-w-[120px] px-3 py-2 rounded-xl text-[10px] font-bold bg-red-600 text-white"
                    >
                      {tr.forceKill}
                    </button>
                  </div>
                )}
              </div>
            )}
            {!detailLoading && !detailData && detailError && (
              <div className="space-y-3">
                <p className="text-xs text-red-500 font-medium">{detailError}</p>
                {detailPreview && (
                  <div
                    className={cn(
                      'rounded-xl border p-3 space-y-2 text-[11px]',
                      isDark ? 'border-slate-700 bg-slate-950/50' : 'border-slate-200 bg-slate-50'
                    )}
                  >
                    <p className={cn('font-bold uppercase tracking-wide text-[10px]', textMuted)}>{tr.detailFromList}</p>
                    <p className={cn('font-mono font-bold', isDark ? 'text-indigo-400' : 'text-indigo-600')}>
                      PID {detailPreview.pid}
                    </p>
                    <p className={cn('font-semibold', isDark ? 'text-slate-100' : 'text-slate-900')}>{detailPreview.name}</p>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <span className={cn('block uppercase', textMuted)}>{tr.cpuPercent}</span>
                        <span className="font-mono">{(detailPreview.cpu_percent ?? 0).toFixed(1)}%</span>
                      </div>
                      <div>
                        <span className={cn('block uppercase', textMuted)}>{tr.memPercent}</span>
                        <span className="font-mono">{(detailPreview.memory_percent ?? 0).toFixed(1)}%</span>
                      </div>
                      {detailPreview.username && (
                        <div className="col-span-2">
                          <span className={cn('block uppercase', textMuted)}>{tr.user}</span>
                          <span>{detailPreview.username}</span>
                        </div>
                      )}
                      {detailPreview.cmdline_preview && (
                        <div className="col-span-2">
                          <span className={cn('block uppercase mb-0.5', textMuted)}>{tr.cmdline}</span>
                          <pre
                            className={cn(
                              'whitespace-pre-wrap break-all rounded p-2 font-mono max-h-24 overflow-y-auto',
                              isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white border border-slate-200'
                            )}
                          >
                            {detailPreview.cmdline_preview}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
      </WindowModal>
    </ModuleViewport>
  );
}
