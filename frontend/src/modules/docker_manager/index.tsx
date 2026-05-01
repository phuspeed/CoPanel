/**
 * Docker Manager - Dashboard Component
 * Premium container management dashboard.
 */
import { useState, useEffect } from 'react';
import * as Icons from 'lucide-react';

interface ContainerItem {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
}

export default function DockerManagerDashboard() {
  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Status metrics
  const [runningCount, setRunningCount] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Viewer state for Logs
  const [viewingLogs, setViewingLogs] = useState<{ id: string; name: string; content: string } | null>(null);

  const fetchContainers = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/docker_manager/list');
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to fetch containers');
      }
      const data = await response.json();
      const list = data.containers || [];
      setContainers(list);

      // Extract running and total
      const running = list.filter((c: ContainerItem) => c.status.toLowerCase().includes('running')).length;
      setRunningCount(running);
      setTotalCount(list.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContainers();
  }, []);

  // ▶️ Start Container
  const handleStartContainer = async (container_id: string) => {
    try {
      const response = await fetch('/api/docker_manager/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container_id }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to start container');
      }
      fetchContainers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error starting container');
    }
  };

  // ⏹️ Stop Container
  const handleStopContainer = async (container_id: string) => {
    try {
      const response = await fetch('/api/docker_manager/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container_id }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to stop container');
      }
      fetchContainers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error stopping container');
    }
  };

  // 🔄 Restart Container
  const handleRestartContainer = async (container_id: string) => {
    try {
      const response = await fetch('/api/docker_manager/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container_id }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to restart container');
      }
      fetchContainers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error restarting container');
    }
  };

  // 🗑️ Remove Container
  const handleRemoveContainer = async (container_id: string) => {
    if (!confirm('Are you sure you want to completely remove this container?')) return;
    try {
      const response = await fetch('/api/docker_manager/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container_id }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to remove container');
      }
      fetchContainers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error removing container');
    }
  };

  // 📜 View Container Logs
  const handleViewLogs = async (item: ContainerItem) => {
    try {
      const response = await fetch(`/api/docker_manager/logs?container_id=${encodeURIComponent(item.id)}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to fetch container logs');
      }
      const data = await response.json();
      setViewingLogs({
        id: item.id,
        name: item.name,
        content: data.logs || 'No logs recorded.',
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error retrieving logs');
    }
  };

  return (
    <div className="p-8">
      {/* Top Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
            <Icons.Box className="w-8 h-8 text-blue-400" />
            Docker Manager
          </h1>
          <p className="text-slate-400">View and manage containers, logs, and services</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchContainers}
            className="flex items-center bg-slate-800 hover:bg-slate-700 p-2.5 rounded-lg text-slate-300 transition"
            title="Refresh containers list"
          >
            <Icons.RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 select-none">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm mb-2 uppercase font-semibold">Total Containers</p>
            <p className="text-4xl font-bold text-white">{totalCount}</p>
          </div>
          <div className="w-16 h-16 bg-blue-900/20 rounded-full flex items-center justify-center">
            <Icons.Layers className="w-8 h-8 text-blue-400" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm mb-2 uppercase font-semibold">Running Containers</p>
            <p className="text-4xl font-bold text-white">{runningCount}</p>
          </div>
          <div className="w-16 h-16 bg-green-900/20 rounded-full flex items-center justify-center">
            <Icons.Play className="w-8 h-8 text-green-400" />
          </div>
        </div>
      </div>

      {/* Main Table / Loader */}
      {loading && containers.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64">
          <Icons.Loader className="w-10 h-10 animate-spin text-blue-500 mb-2" />
          <p className="text-slate-400">Loading containers...</p>
        </div>
      ) : error ? (
        <div className="bg-red-900/20 border border-red-600 p-4 rounded-lg">
          <p className="text-red-200">Error: {error}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse select-none">
                <thead>
                  <tr className="bg-slate-800/50 border-b border-slate-800 text-slate-300 text-xs uppercase">
                    <th className="p-4 font-semibold">Name / ID</th>
                    <th className="p-4 font-semibold">Image</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 font-semibold">Ports</th>
                    <th className="p-4 font-semibold text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/30 text-sm">
                  {containers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400">
                        No containers found on this system
                      </td>
                    </tr>
                  )}
                  {containers.map((item, idx) => {
                    const isRunning = item.status.toLowerCase().includes('running');
                    return (
                      <tr key={idx} className="hover:bg-slate-800/40 transition">
                        <td className="p-4">
                          <div className="text-slate-200 font-medium">{item.name}</div>
                          <div className="text-xs text-slate-500 font-mono">{item.id}</div>
                        </td>
                        <td className="p-4 text-slate-300 text-xs font-mono truncate max-w-xs" title={item.image}>
                          {item.image}
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-3 py-1 text-xs font-semibold rounded-full select-none border transition-all ${
                              isRunning
                                ? 'bg-green-600/20 border-green-500/50 text-green-300'
                                : 'bg-slate-800/60 border-slate-700 text-slate-400'
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="p-4 text-slate-400 font-mono text-xs">{item.ports || '—'}</td>
                        <td className="p-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {isRunning ? (
                              <button
                                onClick={() => handleStopContainer(item.id)}
                                className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-amber-400 transition"
                                title="Stop Container"
                              >
                                <Icons.Square className="w-4 h-4 fill-amber-400/20" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleStartContainer(item.id)}
                                className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-green-400 transition"
                                title="Start Container"
                              >
                                <Icons.Play className="w-4 h-4 fill-green-400/20" />
                              </button>
                            )}
                            <button
                              onClick={() => handleRestartContainer(item.id)}
                              className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-blue-400 transition"
                              title="Restart Container"
                            >
                              <Icons.RefreshCcw className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleViewLogs(item)}
                              className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 transition"
                              title="View Logs"
                            >
                              <Icons.FileText className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleRemoveContainer(item.id)}
                              className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-red-400 transition"
                              title="Remove Container"
                            >
                              <Icons.Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CONTAINER LOGS MODAL */}
      {viewingLogs && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in select-none">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl w-full max-w-3xl h-[70vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h3 className="text-lg font-bold flex items-center gap-2 text-slate-100 truncate max-w-md">
                <Icons.FileText className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <span>Logs: {viewingLogs.name}</span>
              </h3>
              <button
                onClick={() => setViewingLogs(null)}
                className="text-slate-500 hover:text-slate-300 transition"
              >
                &times;
              </button>
            </div>
            <pre className="flex-1 bg-slate-950 border border-slate-800 p-4 rounded-lg text-slate-200 font-mono text-xs overflow-auto select-text">
              {viewingLogs.content}
            </pre>
            <div className="flex items-center justify-end gap-3 mt-4 flex-shrink-0">
              <button
                onClick={() => setViewingLogs(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
