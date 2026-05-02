/**
 * Docker Manager - Advanced Dashboard Component
 * Premium container and Compose management dashboard.
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

interface ComposeFile {
  path: string;
  filename: string;
  full_path: string;
}

export default function DockerManagerDashboard() {
  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [composeFiles, setComposeFiles] = useState<ComposeFile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [composeLoading, setComposeLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Status metrics
  const [runningCount, setRunningCount] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Viewer state for Logs
  const [viewingLogs, setViewingLogs] = useState<{ id: string; name: string; content: string } | null>(null);
  const [actionOutput, setActionOutput] = useState<string | null>(null);

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

  const fetchComposeFiles = async () => {
    setComposeLoading(true);
    try {
      const r = await fetch('/api/docker_manager/scan-compose');
      if (r.ok) {
        const d = await r.json();
        setComposeFiles(d.compose_files || []);
      }
    } catch {
      // Ignore scanning fetch failures
    } finally {
      setComposeLoading(false);
    }
  };

  useEffect(() => {
    fetchContainers();
    fetchComposeFiles();
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

  // 🚀 Deploy Compose stack
  const handleBuildCompose = async (path: string) => {
    setActionOutput('Starting build stack...');
    try {
      const res = await fetch('/api/docker_manager/up-compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setActionOutput(data.message || 'Stack deployed successfully.');
        fetchContainers();
        setTimeout(() => fetchContainers(), 1500);
        setTimeout(() => fetchContainers(), 3500);
      } else {
        setActionOutput(data.message || 'Failed to bring up compose stack.');
      }
    } catch (err) {
      setActionOutput('Failed to communicate with the backend.');
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 select-none">
      {/* Top Header Banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-600/20 via-slate-900 to-slate-950 border border-slate-800 p-8 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent flex items-center gap-2">
            <Icons.Box className="w-8 h-8 text-blue-400" />
            Docker Control Center
          </h1>
          <p className="text-slate-400 text-sm md:text-base leading-relaxed max-w-xl">
            Control running containers, build stacks, and inspect live service logs directly from the web panel.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { fetchContainers(); fetchComposeFiles(); }}
            className="flex items-center bg-slate-800 hover:bg-slate-700 p-3 rounded-xl text-slate-300 transition-all border border-slate-700 shadow-lg"
            title="Refresh containers list"
          >
            <Icons.RefreshCw className={`w-5 h-5 ${loading || composeLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Auto-Scan Compose Suggestions */}
      {composeFiles.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-950/40 via-slate-900/50 to-slate-950/40 border border-indigo-900/40 p-6 rounded-2xl backdrop-blur-md space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-indigo-200 flex items-center gap-2">
              <Icons.Zap className="w-4 h-4 text-indigo-400 animate-pulse" />
              Suggested Docker Compose Files ({composeFiles.length})
            </h3>
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Scanned on Host OS</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {composeFiles.map((file, idx) => (
              <div key={idx} className="bg-slate-950/60 border border-slate-800/80 hover:border-indigo-500/30 p-4 rounded-xl flex flex-col justify-between gap-3 group transition-all">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl group-hover:bg-indigo-600/20 text-indigo-400 transition-all">
                    <Icons.FileCode className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-200 group-hover:text-white truncate max-w-xs transition-all">
                      {file.filename}
                    </h4>
                    <span className="text-[11px] font-mono text-slate-400 break-all">{file.path}</span>
                  </div>
                </div>

                <div className="flex justify-end pt-1 border-t border-slate-800/40">
                  <button
                    onClick={() => handleBuildCompose(file.path)}
                    className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] px-3.5 py-1.5 rounded-xl transition-all shadow-lg hover:shadow-indigo-500/20"
                  >
                    <Icons.Play className="w-3.5 h-3.5" />
                    Build & Deploy
                  </button>
                </div>
              </div>
            ))}
          </div>

          {actionOutput && (
            <div className="p-3.5 bg-slate-950 border border-indigo-900/30 rounded-xl text-indigo-300 font-mono text-xs max-h-40 overflow-auto whitespace-pre-wrap mt-2 flex items-center justify-between">
              <span>{actionOutput}</span>
              <button onClick={() => setActionOutput(null)} className="text-slate-500 hover:text-slate-300 font-bold px-1 select-none">✕</button>
            </div>
          )}
        </div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 select-none">
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex items-center justify-between backdrop-blur-sm">
          <div>
            <p className="text-slate-400 text-xs mb-2 uppercase font-bold tracking-widest">Total Containers</p>
            <p className="text-4xl font-extrabold text-white">{totalCount}</p>
          </div>
          <div className="w-16 h-16 bg-blue-900/10 border border-blue-500/20 rounded-2xl flex items-center justify-center text-blue-400">
            <Icons.Layers className="w-8 h-8" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex items-center justify-between backdrop-blur-sm">
          <div>
            <p className="text-slate-400 text-xs mb-2 uppercase font-bold tracking-widest">Active Containers</p>
            <p className="text-4xl font-extrabold text-white">{runningCount}</p>
          </div>
          <div className="w-16 h-16 bg-green-900/10 border border-green-500/20 rounded-2xl flex items-center justify-center text-green-400">
            <Icons.Play className="w-8 h-8" />
          </div>
        </div>
      </div>

      {/* Main Table / Loader */}
      {loading && containers.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 border border-slate-800/60 rounded-2xl bg-slate-900/30">
          <Icons.Loader className="w-10 h-10 animate-spin text-blue-500 mb-2" />
          <p className="text-slate-400 text-sm">Loading Docker containers...</p>
        </div>
      ) : error ? (
        <div className="bg-red-950/30 border border-red-500/20 p-4 rounded-xl text-red-400 text-xs flex items-center gap-2">
          <Icons.AlertCircle className="w-4 h-4 shrink-0" />
          <span>Error: {error}</span>
        </div>
      ) : (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden backdrop-blur-sm shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse select-none">
              <thead>
                <tr className="bg-slate-950/60 border-b border-slate-800/60 text-slate-300 text-xs uppercase tracking-wider">
                  <th className="p-4 font-bold select-none">Container Name & ID</th>
                  <th className="p-4 font-bold select-none">Image Name</th>
                  <th className="p-4 font-bold select-none">Status</th>
                  <th className="p-4 font-bold select-none">Ports Mapping</th>
                  <th className="p-4 font-bold text-center select-none">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30 text-sm">
                {containers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-12 text-center text-slate-400 text-xs">
                      No Docker containers active on this system.
                    </td>
                  </tr>
                )}
                {containers.map((item, idx) => {
                  const isRunning = item.status.toLowerCase().includes('running');
                  return (
                    <tr key={idx} className="hover:bg-slate-800/30 transition-all duration-200">
                      <td className="p-4">
                        <div className="text-slate-100 font-bold text-xs">{item.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono select-all mt-0.5">{item.id}</div>
                      </td>
                      <td className="p-4 text-slate-300 text-xs font-mono truncate max-w-xs" title={item.image}>
                        {item.image}
                      </td>
                      <td className="p-4">
                        <span
                          className={`px-3 py-1 text-xs font-semibold rounded-full select-none border transition-all ${
                            isRunning
                              ? 'bg-green-500/10 border-green-500/20 text-green-300'
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
                              className="p-2 bg-slate-800/60 hover:bg-slate-700 rounded-xl text-amber-400 border border-slate-700/60 transition-all"
                              title="Stop Container"
                            >
                              <Icons.Square className="w-3.5 h-3.5 fill-amber-400/20" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleStartContainer(item.id)}
                              className="p-2 bg-slate-800/60 hover:bg-slate-700 rounded-xl text-green-400 border border-slate-700/60 transition-all"
                              title="Start Container"
                            >
                              <Icons.Play className="w-3.5 h-3.5 fill-green-400/20" />
                            </button>
                          )}
                          <button
                            onClick={() => handleRestartContainer(item.id)}
                            className="p-2 bg-slate-800/60 hover:bg-slate-700 rounded-xl text-blue-400 border border-slate-700/60 transition-all"
                            title="Restart Container"
                          >
                            <Icons.RefreshCcw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleViewLogs(item)}
                            className="p-2 bg-slate-800/60 hover:bg-slate-700 rounded-xl text-slate-300 border border-slate-700/60 transition-all"
                            title="View Logs"
                          >
                            <Icons.FileText className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemoveContainer(item.id)}
                            className="p-2 bg-slate-800/60 hover:bg-slate-700 rounded-xl text-red-400 border border-slate-700/60 transition-all"
                            title="Remove Container"
                          >
                            <Icons.Trash2 className="w-3.5 h-3.5" />
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
      )}

      {/* CONTAINER LOGS MODAL */}
      {viewingLogs && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 animate-fade-in select-none">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-3xl h-[70vh] flex flex-col shadow-2xl space-y-4">
            <div className="flex items-center justify-between flex-shrink-0">
              <h3 className="text-sm font-bold flex items-center gap-2 text-slate-100 truncate max-w-md">
                <Icons.FileText className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <span>Logs for: {viewingLogs.name}</span>
              </h3>
              <button
                onClick={() => setViewingLogs(null)}
                className="text-slate-500 hover:text-slate-300 transition"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>
            <pre className="flex-1 bg-slate-950 border border-slate-800 p-4 rounded-xl text-slate-200 font-mono text-xs overflow-auto select-text">
              {viewingLogs.content}
            </pre>
            <div className="flex items-center justify-end flex-shrink-0">
              <button
                onClick={() => setViewingLogs(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all"
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
