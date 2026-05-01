/**
 * System Monitor Dashboard Component
 * Real-time visualization of system resources using Recharts
 */
import { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
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

interface SystemStats {
  system: any;
  cpu: any;
  memory: any;
  disk: any;
  network: any;
  processes: any;
}

interface HistoryData {
  time: string;
  cpu: number;
  memory: number;
}

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];

export default function SystemMonitorDashboard() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [history, setHistory] = useState<HistoryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/system_monitor/stats');
        if (!response.ok) throw new Error('Failed to fetch stats');
        const data = await response.json();
        setStats(data.data);

        // Update history (keep last 30 data points)
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
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 3000); // Refresh every 3 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <Icons.Loader className="w-12 h-12 mx-auto mb-4 animate-spin" />
          <p className="text-slate-400">Loading system stats...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-900/20 border border-red-600 p-4 rounded-lg">
          <p className="text-red-200">Error: {error}</p>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const diskData = stats.disk.partitions || [];
  const cpuPercent = stats.cpu.percent || 0;
  const memPercent = stats.memory.percent || 0;
  const diskPercent = diskData[0]?.percent || 0;

  const memoryChartData = [
    { name: 'Used', value: stats.memory.used, fill: '#ef4444' },
    { name: 'Free', value: stats.memory.free, fill: '#10b981' },
  ];

  const diskChartData = diskData.map((disk: any) => ({
    name: disk.device,
    used: disk.used,
    free: disk.free,
  }));

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">System Monitor</h1>
        <p className="text-slate-400">Real-time system resource monitoring</p>
      </div>

      {/* System Info Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-400 uppercase">Hostname</p>
            <p className="text-lg font-semibold">{stats.system.hostname}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase">Platform</p>
            <p className="text-lg font-semibold">{stats.system.system}</p>
          </div>
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* CPU */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-2">CPU Usage</p>
              <p className="text-3xl font-bold">{cpuPercent.toFixed(1)}%</p>
            </div>
            <div className="w-16 h-16 bg-blue-900/20 rounded-full flex items-center justify-center">
              <Icons.Cpu className="w-8 h-8 text-blue-400" />
            </div>
          </div>
          <div className="mt-4 w-full bg-slate-800 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${cpuPercent}%` }}
            />
          </div>
        </div>

        {/* Memory */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-2">Memory Usage</p>
              <p className="text-3xl font-bold">{memPercent.toFixed(1)}%</p>
            </div>
            <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center">
              <Icons.BarChart3 className="w-8 h-8 text-red-400" />
            </div>
          </div>
          <div className="mt-4 w-full bg-slate-800 rounded-full h-2">
            <div
              className="bg-red-500 h-2 rounded-full transition-all"
              style={{ width: `${memPercent}%` }}
            />
          </div>
        </div>

        {/* Disk */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-2">Disk Usage</p>
              <p className="text-3xl font-bold">{diskPercent.toFixed(1)}%</p>
            </div>
            <div className="w-16 h-16 bg-yellow-900/20 rounded-full flex items-center justify-center">
              <Icons.HardDrive className="w-8 h-8 text-yellow-400" />
            </div>
          </div>
          <div className="mt-4 w-full bg-slate-800 rounded-full h-2">
            <div
              className="bg-yellow-500 h-2 rounded-full transition-all"
              style={{ width: `${diskPercent}%` }}
            />
          </div>
        </div>

        {/* Processes */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-2">Processes</p>
              <p className="text-3xl font-bold">{stats.processes.total}</p>
            </div>
            <div className="w-16 h-16 bg-purple-900/20 rounded-full flex items-center justify-center">
              <Icons.Zap className="w-8 h-8 text-purple-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* CPU & Memory History */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Resource History (30s)</h2>
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

        {/* Memory Distribution */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Memory Distribution</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={memoryChartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
              >
                {memoryChartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`}
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '0.5rem',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-4 space-y-2">
            {memoryChartData.map((item, idx) => (
              <div key={idx} className="flex justify-between text-sm">
                <span className="text-slate-400">{item.name}</span>
                <span className="font-semibold">
                  {(item.value / (1024 * 1024 * 1024)).toFixed(2)} GB
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts Row 2 - Disk */}
      {diskChartData.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Disk Usage by Partition</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={diskChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" stroke="#64748b" />
              <YAxis stroke="#64748b" />
              <Tooltip
                formatter={(value) => `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`}
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '0.5rem',
                }}
              />
              <Legend />
              <Bar dataKey="used" fill="#3b82f6" name="Used" />
              <Bar dataKey="free" fill="#10b981" name="Free" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
