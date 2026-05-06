/**
 * System Monitor Dashboard Component
 * Real-time resource charts, processes, and PM2 management.
 */
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import * as Icons from 'lucide-react';

interface ProcessInfo {
  pid: number;
  name: string;
  username?: string;
  cpu_percent?: number;
  memory_percent?: number;
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

const TEXT: Record<Language, Record<string, string>> = {
  en: {
    fetchStatsFailed: 'Failed to fetch stats',
    unknownError: 'Unknown error',
    pm2ActionFailed: 'Failed to perform {action} on PM2.',
    loadingRealtime: 'Loading real-time stats...',
    errorLabel: 'Error',
    heroTitle: 'System Resource Monitor',
    heroSubtitle: 'Track resource history, monitor running processes, and perform advanced PM2 lifecycles.',
    uptime: 'Uptime',
    cpuCores: 'CPU Cores',
    connections: 'Connections',
    hostname: 'Hostname',
    os: 'OS',
    resources: 'Resources',
    activeProcesses: 'Active Processes',
    pm2Manager: 'PM2 Manager',
    cpuUsage: 'CPU Usage',
    memoryUsage: 'Memory Usage',
    diskUsage: 'Disk Usage',
    noDiskData: 'No disk data',
    activePids: 'Active PIDs',
    runningSleep: 'running {running} / sleep {sleeping}',
    resourceHistory: 'Resource History (Last 30s)',
    memoryDistribution: 'Memory Distribution',
    used: 'Used',
    free: 'Free',
    available: 'Available',
    network: 'Network',
    upload: 'Upload',
    download: 'Download',
    packetsTxRx: 'Packets (TX/RX)',
    topDiskUsage: 'Top Disk Usage',
    noDiskPartitionInfo: 'No disk partition information available.',
    top20Processes: 'Top 20 Processes',
    pid: 'PID',
    name: 'Name',
    user: 'User',
    cpuPercent: 'CPU %',
    memPercent: 'Mem %',
    na: 'N/A',
    noActiveProcesses: 'No active processes captured.',
    pm2AppProcesses: 'PM2 Application Processes',
    pm2Subtitle: 'Advanced process lifecycle dashboard for node applications.',
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
  },
  vi: {
    fetchStatsFailed: 'Khong the lay thong ke',
    unknownError: 'Loi khong xac dinh',
    pm2ActionFailed: 'Khong the thuc hien {action} tren PM2.',
    loadingRealtime: 'Dang tai thong ke thoi gian thuc...',
    errorLabel: 'Loi',
    heroTitle: 'Giam sat tai nguyen he thong',
    heroSubtitle: 'Theo doi lich su tai nguyen, giam sat tien trinh dang chay va quan ly vong doi PM2 nang cao.',
    uptime: 'Thoi gian hoat dong',
    cpuCores: 'So nhan CPU',
    connections: 'Ket noi',
    hostname: 'Ten may',
    os: 'He dieu hanh',
    resources: 'Tai nguyen',
    activeProcesses: 'Tien trinh dang chay',
    pm2Manager: 'Quan ly PM2',
    cpuUsage: 'Muc dung CPU',
    memoryUsage: 'Muc dung RAM',
    diskUsage: 'Muc dung o dia',
    noDiskData: 'Khong co du lieu o dia',
    activePids: 'PID dang hoat dong',
    runningSleep: 'dang chay {running} / ngu {sleeping}',
    resourceHistory: 'Lich su tai nguyen (30 giay gan nhat)',
    memoryDistribution: 'Phan bo bo nho',
    used: 'Da dung',
    free: 'Con trong',
    available: 'Kha dung',
    network: 'Mang',
    upload: 'Tai len',
    download: 'Tai xuong',
    packetsTxRx: 'Goi tin (TX/RX)',
    topDiskUsage: 'Su dung o dia cao nhat',
    noDiskPartitionInfo: 'Khong co thong tin phan vung o dia.',
    top20Processes: 'Top 20 tien trinh',
    pid: 'PID',
    name: 'Ten',
    user: 'Nguoi dung',
    cpuPercent: 'CPU %',
    memPercent: 'RAM %',
    na: 'Khong co',
    noActiveProcesses: 'Khong co tien trinh dang chay.',
    pm2AppProcesses: 'Tien trinh ung dung PM2',
    pm2Subtitle: 'Bang dieu khien vong doi tien trinh nang cao cho ung dung Node.',
    refreshPm2: 'Lam moi PM2',
    appName: 'Ten app',
    id: 'ID',
    status: 'Trang thai',
    memory: 'Bo nho',
    cpu: 'CPU',
    restarts: 'So lan khoi dong lai',
    actions: 'Hanh dong',
    stop: 'Dung',
    start: 'Chay',
    restart: 'Khoi dong lai',
    delete: 'Xoa',
    pm2Empty: 'PM2 chua duoc cai dat hoac khong co app nao dang chay.',
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

const formatUptime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

export default function SystemMonitorDashboard() {
  const outlet = useOutletContext<{ language?: Language } | null>();
  const language: Language = outlet?.language === 'vi' ? 'vi' : 'en';
  const tr = TEXT[language];
  const trf = (key: string, vars: Record<string, string | number> = {}) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), tr[key] || key);

  const [stats, setStats] = useState<SystemStats | null>(null);
  const [history, setHistory] = useState<HistoryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'resources' | 'processes' | 'pm2'>('resources');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const token = localStorage.getItem('copanel_token');

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/system_monitor/stats', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!response.ok) throw new Error(tr.fetchStatsFailed);
      const data = await response.json();
      setStats(data.data as SystemStats);

      // Keep last 30 history points
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
      setError(err instanceof Error ? err.message : tr.unknownError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, []);

  const handlePm2Action = async (action: string, id: string | number) => {
    setActionLoading(`${action}-${id}`);
    try {
      const res = await fetch(`/api/system_monitor/pm2/${action}/${id}`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
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

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-screen select-none bg-slate-950 text-slate-50">
        <div className="text-center">
          <Icons.Loader className="w-12 h-12 mx-auto mb-4 animate-spin text-blue-500" />
          <p className="text-slate-400 text-sm">{tr.loadingRealtime}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-900/20 border border-red-600/30 p-4 rounded-xl max-w-xl">
          <p className="text-red-300 text-xs font-bold flex items-center gap-2">
            <Icons.AlertCircle className="w-4 h-4 shrink-0" />
            {tr.errorLabel}: {error}
          </p>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const diskData = stats.disk.partitions || [];
  const cpuPercent = stats.cpu.percent || 0;
  const memPercent = stats.memory.percent || 0;
  const diskPercent = diskData.length
    ? Math.max(...diskData.map((partition) => partition.percent || 0))
    : 0;
  const busiestDisk = diskData.length
    ? diskData.reduce((max, partition) => ((partition.percent || 0) > (max.percent || 0) ? partition : max), diskData[0])
    : null;

  const memoryChartData = [
    { name: tr.used, value: stats.memory.used, fill: '#ef4444' },
    { name: tr.free, value: stats.memory.free, fill: '#10b981' },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 select-none">
      {/* Premium Ambient Background Banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-600/20 via-slate-900 to-slate-950 border border-slate-800 p-8 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent">
            {tr.heroTitle}
          </h2>
          <p className="text-slate-400 text-sm md:text-base leading-relaxed">
            {tr.heroSubtitle}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 pt-2">
            <span className="px-2.5 py-1 rounded-full border border-slate-700 bg-slate-900/60">
              {tr.uptime}: {formatUptime(stats.system.uptime_seconds)}
            </span>
            <span className="px-2.5 py-1 rounded-full border border-slate-700 bg-slate-900/60">
              {tr.cpuCores}: {stats.cpu.count}
            </span>
            <span className="px-2.5 py-1 rounded-full border border-slate-700 bg-slate-900/60">
              {tr.connections}: {stats.network.connections}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right bg-slate-900/50 p-4 rounded-xl border border-slate-800 backdrop-blur-sm self-stretch md:self-auto min-w-[200px]">
          <span className="text-xs font-semibold text-blue-400 uppercase tracking-widest">{tr.hostname}</span>
          <span className="text-lg font-mono font-bold text-slate-100">{stats.system.hostname}</span>
          <span className="text-xs text-slate-400">{tr.os}: {stats.system.system}</span>
        </div>
      </div>

      {/* Tabs Menu Navigation */}
      <div className="flex items-center gap-1.5 border-b border-slate-800/80 pb-1">
        <button
          onClick={() => setActiveTab('resources')}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 border-b-2 rounded-t-lg flex items-center gap-2 ${
            activeTab === 'resources'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Icons.Activity className="w-4 h-4" />
          {tr.resources}
        </button>
        <button
          onClick={() => setActiveTab('processes')}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 border-b-2 rounded-t-lg flex items-center gap-2 ${
            activeTab === 'processes'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Icons.Cpu className="w-4 h-4" />
          {tr.activeProcesses} ({stats.top_processes?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('pm2')}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 border-b-2 rounded-t-lg flex items-center gap-2 ${
            activeTab === 'pm2'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Icons.Terminal className="w-4 h-4" />
          {tr.pm2Manager} ({stats.pm2?.length || 0})
        </button>
      </div>

      {/* Resource Stats Tab */}
      {activeTab === 'resources' && (
        <div className="space-y-8">
          {/* Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl backdrop-blur-sm hover:border-blue-500/30 transition-all">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-xs font-bold tracking-wider uppercase mb-1">{tr.cpuUsage}</p>
                  <p className="text-3xl font-extrabold text-white">{cpuPercent.toFixed(1)}%</p>
                </div>
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400">
                  <Icons.Cpu className="w-6 h-6" />
                </div>
              </div>
              <div className="mt-4 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${cpuPercent}%` }}
                />
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl backdrop-blur-sm hover:border-red-500/30 transition-all">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-xs font-bold tracking-wider uppercase mb-1">{tr.memoryUsage}</p>
                  <p className="text-3xl font-extrabold text-white">{memPercent.toFixed(1)}%</p>
                </div>
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
                  <Icons.BarChart3 className="w-6 h-6" />
                </div>
              </div>
              <div className="mt-4 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-red-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${memPercent}%` }}
                />
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl backdrop-blur-sm hover:border-yellow-500/30 transition-all">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-xs font-bold tracking-wider uppercase mb-1">{tr.diskUsage}</p>
                  <p className="text-3xl font-extrabold text-white">{diskPercent.toFixed(1)}%</p>
                  <p className="text-[11px] text-slate-400 mt-1 truncate">
                    {busiestDisk ? busiestDisk.mountpoint : tr.noDiskData}
                  </p>
                </div>
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-yellow-400">
                  <Icons.HardDrive className="w-6 h-6" />
                </div>
              </div>
              <div className="mt-4 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-yellow-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${diskPercent}%` }}
                />
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl backdrop-blur-sm hover:border-purple-500/30 transition-all">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-xs font-bold tracking-wider uppercase mb-1">{tr.activePids}</p>
                  <p className="text-3xl font-extrabold text-white">{stats.processes.total}</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {trf('runningSleep', { running: stats.processes.running, sleeping: stats.processes.sleeping || 0 })}
                  </p>
                </div>
                <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-400">
                  <Icons.Zap className="w-6 h-6" />
                </div>
              </div>
            </div>
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl backdrop-blur-sm">
              <h2 className="text-sm font-bold text-slate-200 tracking-wide uppercase mb-4">{tr.resourceHistory}</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="time" stroke="#64748b" />
                  <YAxis stroke="#64748b" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '0.5rem',
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="cpu"
                    stroke="#3b82f6"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="memory"
                    stroke="#ef4444"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl backdrop-blur-sm">
              <h2 className="text-sm font-bold text-slate-200 tracking-wide uppercase mb-4">{tr.memoryDistribution}</h2>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={memoryChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {memoryChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: any) => `${(Number(value) / (1024 * 1024 * 1024)).toFixed(2)} GB`}
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '0.5rem',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 border-t border-slate-800/80 pt-2 space-y-1">
                {memoryChartData.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-xs">
                    <span className="text-slate-400">{item.name}</span>
                    <span className="font-semibold text-slate-200">
                      {formatBytes(item.value)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between text-xs pt-1 border-t border-slate-800/60 mt-2">
                  <span className="text-slate-400">{tr.available}</span>
                  <span className="font-semibold text-slate-200">{formatBytes(stats.memory.available)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl backdrop-blur-sm">
              <h2 className="text-sm font-bold text-slate-200 tracking-wide uppercase mb-4">{tr.network}</h2>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">{tr.upload}</span>
                  <span className="font-semibold text-slate-100">{formatBytes(stats.network.bytes_sent)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">{tr.download}</span>
                  <span className="font-semibold text-slate-100">{formatBytes(stats.network.bytes_recv)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">{tr.packetsTxRx}</span>
                  <span className="font-semibold text-slate-100">
                    {stats.network.packets_sent.toLocaleString()} / {stats.network.packets_recv.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl backdrop-blur-sm">
              <h2 className="text-sm font-bold text-slate-200 tracking-wide uppercase mb-4">{tr.topDiskUsage}</h2>
              <div className="space-y-3">
                {diskData.slice(0, 5).map((partition) => (
                  <div key={`${partition.device}-${partition.mountpoint}`}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300 truncate pr-2">{partition.mountpoint}</span>
                      <span className="text-slate-400">{partition.percent.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-yellow-500 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${partition.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
                {!diskData.length && <p className="text-xs text-slate-400">{tr.noDiskPartitionInfo}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Processes Tab */}
      {activeTab === 'processes' && (
        <div className="bg-slate-900/50 border border-slate-800/80 p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">{tr.top20Processes}</h3>
          {stats.top_processes && stats.top_processes.length > 0 ? (
            <div className="overflow-x-auto border border-slate-800/60 rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-950/60 border-b border-slate-800/60 text-xs font-bold text-slate-300 uppercase tracking-widest">
                    <th className="p-4">{tr.pid}</th>
                    <th className="p-4">{tr.name}</th>
                    <th className="p-4">{tr.user}</th>
                    <th className="p-4">{tr.cpuPercent}</th>
                    <th className="p-4">{tr.memPercent}</th>
                  </tr>
                </thead>
                <tbody className="text-xs text-slate-200 divide-y divide-slate-800/40 font-mono">
                  {stats.top_processes.map((proc) => (
                    <tr key={proc.pid} className="hover:bg-slate-800/30 transition-all">
                      <td className="p-4 text-indigo-400 font-bold">{proc.pid}</td>
                      <td className="p-4 text-slate-100">{proc.name}</td>
                      <td className="p-4 text-slate-400">{proc.username || tr.na}</td>
                      <td className="p-4 text-blue-400">{(proc.cpu_percent || 0).toFixed(1)}%</td>
                      <td className="p-4 text-red-400">{(proc.memory_percent || 0).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-slate-400 text-xs">{tr.noActiveProcesses}</p>
          )}
        </div>
      )}

      {/* PM2 Advanced Manager Tab */}
      {activeTab === 'pm2' && (
        <div className="bg-slate-900/50 border border-slate-800/80 p-6 md:p-8 rounded-2xl backdrop-blur-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">{tr.pm2AppProcesses}</h3>
              <p className="text-xs text-slate-400">{tr.pm2Subtitle}</p>
            </div>
            <button
              onClick={fetchStats}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 font-bold"
            >
              <Icons.RefreshCw className="w-3.5 h-3.5" /> {tr.refreshPm2}
            </button>
          </div>

          {stats.pm2 && stats.pm2.length > 0 ? (
            <div className="overflow-x-auto border border-slate-800/60 rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-950/60 border-b border-slate-800/60 text-xs font-bold text-slate-300 uppercase tracking-widest">
                    <th className="p-4">{tr.appName}</th>
                    <th className="p-4">{tr.id}</th>
                    <th className="p-4">{tr.status}</th>
                    <th className="p-4">{tr.memory}</th>
                    <th className="p-4">{tr.cpu}</th>
                    <th className="p-4">{tr.restarts}</th>
                    <th className="p-4 text-right">{tr.actions}</th>
                  </tr>
                </thead>
                <tbody className="text-xs text-slate-200 divide-y divide-slate-800/40 font-mono">
                  {stats.pm2.map((app) => {
                    const isRunning = app.pm2_env?.status === 'online';
                    return (
                      <tr key={`${app.pm_id}-${app.name}`} className="hover:bg-slate-800/30 transition-all">
                        <td className="p-4 font-bold text-blue-400">{app.name}</td>
                        <td className="p-4">{app.pm_id}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded border ${
                            isRunning ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}>
                            {app.pm2_env?.status || tr.na}
                          </span>
                        </td>
                        <td className="p-4">{formatBytes(app.monit?.memory || 0)}</td>
                        <td className="p-4">{app.monit?.cpu || 0}%</td>
                        <td className="p-4">{app.pm2_env?.restart_time || 0}</td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isRunning ? (
                              <button
                                onClick={() => handlePm2Action('stop', app.name)}
                                disabled={actionLoading !== null}
                                className="px-2.5 py-1.5 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold rounded-xl"
                              >
                                {tr.stop}
                              </button>
                            ) : (
                              <button
                                onClick={() => handlePm2Action('start', app.name)}
                                disabled={actionLoading !== null}
                                className="px-2.5 py-1.5 text-[10px] bg-green-950/40 hover:bg-green-900/40 text-green-400 border border-green-900/40 font-bold rounded-xl"
                              >
                                {tr.start}
                              </button>
                            )}
                            <button
                              onClick={() => handlePm2Action('restart', app.name)}
                              disabled={actionLoading !== null}
                              className="px-2.5 py-1.5 text-[10px] bg-indigo-950/40 hover:bg-indigo-900/40 text-indigo-400 border border-indigo-900/40 font-bold rounded-xl"
                            >
                              {tr.restart}
                            </button>
                            <button
                              onClick={() => handlePm2Action('delete', app.name)}
                              disabled={actionLoading !== null}
                              className="px-2.5 py-1.5 text-[10px] bg-red-950/40 hover:bg-red-900/40 text-red-400 border border-red-900/40 font-bold rounded-xl"
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
            <div className="p-4 bg-slate-950/40 border border-slate-800/60 rounded-xl text-slate-400 text-xs">
              {tr.pm2Empty}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
