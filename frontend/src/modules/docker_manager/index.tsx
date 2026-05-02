/**
 * Docker Manager - Advanced Dashboard Component
 * Premium container and Compose management dashboard.
 */
import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
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
  const [customPath, setCustomPath] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const [runningCount, setRunningCount] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);

  const [viewingLogs, setViewingLogs] = useState<{ id: string; name: string; content: string } | null>(null);
  const [actionOutput, setActionOutput] = useState<string | null>(null);

  const { theme, language } = useOutletContext<{ theme: 'dark' | 'light'; language: 'en' | 'vi' }>();
  const isDark = theme === 'dark';

  const t = {
    en: {
      title: 'Docker Control Center',
      desc: 'Control running containers, build stacks, and inspect live service logs directly from the web panel.',
      scanTitle: 'Discover Compose Files',
      scanDesc: 'Find local folders with compose stacks ready to be deployed.',
      scanPlaceholder: 'e.g. /home/Docker',
      scanBtn: 'Scan',
      noCompose: 'No ready compose file folders discovered yet. Enter a custom path above and click Scan!',
      buildDeploy: 'Build & Deploy',
      outputStarting: 'Starting build stack...',
      outputSuccess: 'Stack deployed successfully.',
      outputFailed: 'Failed to bring up compose stack.',
      outputCommFailed: 'Failed to communicate with the backend.',
      totalContainers: 'Total Containers',
      activeContainers: 'Active Containers',
      loadingConts: 'Loading Docker containers...',
      colName: 'Container Name & ID',
      colImage: 'Image Name',
      colStatus: 'Status',
      colPorts: 'Ports Mapping',
      colActions: 'Actions',
      noContainers: 'No Docker containers active on this system.',
      deleteConfirm: 'Are you sure you want to completely remove this container?',
      viewLogsTitle: 'Logs for',
      closeBtn: 'Close'
    },
    vi: {
      title: 'Trung tâm Docker',
      desc: 'Quản lý các container đang chạy, triển khai các ngăn xếp Compose và theo dõi log hệ thống trực tiếp từ bảng điều khiển.',
      scanTitle: 'Tìm kiếm tệp Compose',
      scanDesc: 'Tìm các thư mục cục bộ chứa compose stack sẵn sàng để triển khai.',
      scanPlaceholder: 'Ví dụ: /home/Docker',
      scanBtn: 'Quét',
      noCompose: 'Không tìm thấy tệp compose nào. Vui lòng nhập đường dẫn tùy chỉnh và bấm Quét!',
      buildDeploy: 'Xây dựng & Triển khai',
      outputStarting: 'Đang khởi chạy build stack...',
      outputSuccess: 'Triển khai stack thành công.',
      outputFailed: 'Không thể khởi chạy compose stack.',
      outputCommFailed: 'Không thể kết nối với máy chủ.',
      totalContainers: 'Tổng số Container',
      activeContainers: 'Container Đang Chạy',
      loadingConts: 'Đang tải danh sách container...',
      colName: 'Tên & ID Container',
      colImage: 'Tên Image',
      colStatus: 'Trạng thái',
      colPorts: 'Bản đồ cổng (Ports)',
      colActions: 'Hành động',
      noContainers: 'Không tìm thấy container Docker nào đang chạy trên hệ thống.',
      deleteConfirm: 'Bạn có chắc chắn muốn xóa hoàn toàn container này không?',
      viewLogsTitle: 'Logs cho',
      closeBtn: 'Đóng'
    }
  };

  const tr = t[language || 'en'];

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

      const running = list.filter((c: ContainerItem) => c.status.toLowerCase().includes('running')).length;
      setRunningCount(running);
      setTotalCount(list.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const fetchComposeFiles = async (p?: string) => {
    setComposeLoading(true);
    try {
      const url = p ? `/api/docker_manager/scan-compose?custom_path=${encodeURIComponent(p)}` : '/api/docker_manager/scan-compose';
      const r = await fetch(url);
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
  }, [language]);

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

  const handleRemoveContainer = async (container_id: string) => {
    if (!confirm(tr.deleteConfirm)) return;
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

  const handleBuildCompose = async (path: string) => {
    setActionOutput(tr.outputStarting);
    try {
      const res = await fetch('/api/docker_manager/up-compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setActionOutput(data.message || tr.outputSuccess);
        fetchContainers();
      } else {
        setActionOutput(data.message || tr.outputFailed);
      }
    } catch {
      setActionOutput(tr.outputCommFailed);
    }
  };

  return (
    <div className={`p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 select-none ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
      <div className={`relative overflow-hidden border p-6 md:p-8 rounded-2xl backdrop-blur-md shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-6 transition-all duration-300 ${
        isDark ? 'bg-gradient-to-br from-blue-600/10 via-slate-900 to-slate-950 border-slate-800' : 'bg-gradient-to-br from-blue-50/40 via-white to-slate-50 border-slate-200'
      }`}>
        <div className="space-y-2">
          <h1 className={`text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2 ${
            isDark ? 'bg-gradient-to-r from-blue-400 via-indigo-200 to-white bg-clip-text text-transparent' : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-slate-800 bg-clip-text text-transparent'
          }`}>
            <Icons.Box className={`w-7 h-7 md:w-8 md:h-8 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            {tr.title}
          </h1>
          <p className={`text-xs md:text-sm leading-relaxed max-w-xl ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {tr.desc}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { fetchContainers(); fetchComposeFiles(); }}
            className={`flex items-center p-3 rounded-xl transition border shadow-lg ${
              isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700' : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200'
            }`}
            title="Refresh"
          >
            <Icons.RefreshCw className={`w-5 h-5 ${loading || composeLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className={`border p-6 rounded-2xl backdrop-blur-md space-y-5 transition-all ${
        isDark ? 'bg-gradient-to-r from-indigo-950/20 via-slate-900/40 to-slate-950/20 border-indigo-900/40' : 'bg-gradient-to-r from-indigo-50/40 via-slate-50/30 to-white border-slate-200 shadow-sm'
      }`}>
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-indigo-200' : 'text-indigo-700'}`}>
              <Icons.Zap className="w-4 h-4 text-indigo-400 animate-pulse" />
              {tr.scanTitle} ({composeFiles.length})
            </h3>
            <p className={`text-[11px] leading-tight ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.scanDesc}</p>
          </div>
          <div className={`flex items-center gap-2 p-1.5 rounded-xl border w-full md:w-auto ${isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-white border-slate-200'}`}>
            <input
              type="text"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder={tr.scanPlaceholder}
              className={`bg-transparent text-xs focus:outline-none px-2 w-full md:w-56 font-mono ${isDark ? 'text-slate-200' : 'text-slate-800'}`}
            />
            <button
              onClick={() => fetchComposeFiles(customPath)}
              disabled={composeLoading}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-[11px] px-3.5 py-1.5 rounded-xl transition-all shadow-lg flex items-center gap-1 shrink-0"
            >
              <Icons.Search className="w-3.5 h-3.5" />
              {tr.scanBtn}
            </button>
          </div>
        </div>

        {composeFiles.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {composeFiles.map((file, idx) => (
              <div key={idx} className={`p-4 rounded-xl flex flex-col justify-between gap-3 group transition-all border ${
                isDark ? 'bg-slate-950/60 border-slate-800 hover:border-indigo-500/30' : 'bg-white border-slate-100 hover:border-indigo-500/30 hover:bg-slate-50/50 shadow-sm'
              }`}>
                <div className="flex items-start gap-3">
                  <div className={`p-2 border rounded-xl transition-all ${isDark ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 group-hover:bg-indigo-600/20' : 'bg-indigo-50 border-indigo-100 text-indigo-600'}`}>
                    <Icons.FileCode className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className={`text-xs font-bold truncate transition-all ${isDark ? 'text-slate-200 group-hover:text-white' : 'text-slate-800'}`}>
                      {file.filename}
                    </h4>
                    <span className={`text-[11px] font-mono break-all block leading-normal ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{file.path}</span>
                  </div>
                </div>

                <div className={`flex justify-end pt-1 border-t ${isDark ? 'border-slate-800/40' : 'border-slate-100'}`}>
                  <button
                    onClick={() => handleBuildCompose(file.path)}
                    className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] px-3.5 py-1.5 rounded-xl transition-all shadow-lg hover:shadow-indigo-500/20"
                  >
                    <Icons.Play className="w-3.5 h-3.5" />
                    {tr.buildDeploy}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`text-xs border p-4 rounded-xl ${isDark ? 'text-slate-500 border-slate-800/40' : 'text-slate-400 border-slate-200'}`}>
            {tr.noCompose}
          </div>
        )}

        {actionOutput && (
          <div className={`p-3.5 border rounded-xl font-mono text-xs max-h-40 overflow-auto whitespace-pre-wrap mt-2 flex items-center justify-between ${
            isDark ? 'bg-slate-950 border-indigo-900/30 text-indigo-300' : 'bg-indigo-50 border-indigo-100 text-indigo-600'
          }`}>
            <span>{actionOutput}</span>
            <button onClick={() => setActionOutput(null)} className="text-slate-500 hover:text-slate-300 font-bold px-1 select-none">✕</button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 select-none">
        <div className={`border rounded-2xl p-6 flex items-center justify-between backdrop-blur-sm transition-all duration-300 ${isDark ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
          <div>
            <p className={`text-xs mb-2 uppercase font-bold tracking-widest ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.totalContainers}</p>
            <p className={`text-4xl font-extrabold ${isDark ? 'text-white' : 'text-slate-800'}`}>{totalCount}</p>
          </div>
          <div className={`w-16 h-16 border rounded-2xl flex items-center justify-center transition ${isDark ? 'bg-blue-900/10 border-blue-500/20 text-blue-400' : 'bg-blue-50 border-blue-100 text-blue-600'}`}>
            <Icons.Layers className="w-8 h-8" />
          </div>
        </div>

        <div className={`border rounded-2xl p-6 flex items-center justify-between backdrop-blur-sm transition-all duration-300 ${isDark ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
          <div>
            <p className={`text-xs mb-2 uppercase font-bold tracking-widest ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{tr.activeContainers}</p>
            <p className={`text-4xl font-extrabold ${isDark ? 'text-white' : 'text-slate-800'}`}>{runningCount}</p>
          </div>
          <div className={`w-16 h-16 border rounded-2xl flex items-center justify-center transition ${isDark ? 'bg-green-900/10 border-green-500/20 text-green-400' : 'bg-green-50 border-green-100 text-green-600'}`}>
            <Icons.Play className="w-8 h-8" />
          </div>
        </div>
      </div>

      {loading && containers.length === 0 ? (
        <div className={`flex flex-col items-center justify-center h-64 border rounded-2xl ${isDark ? 'border-slate-800/60 bg-slate-900/30' : 'border-slate-200 bg-white'}`}>
          <Icons.Loader className="w-8 h-8 animate-spin text-blue-500 mb-2" />
          <p className="text-slate-400 text-xs">{tr.loadingConts}</p>
        </div>
      ) : error ? (
        <div className="bg-red-950/20 border border-red-600/30 p-4 rounded-xl text-red-400 text-xs flex items-center gap-2">
          <Icons.AlertCircle className="w-4 h-4 shrink-0" />
          <span>Error: {error}</span>
        </div>
      ) : (
        <div className={`border rounded-2xl overflow-hidden backdrop-blur-md shadow-xl transition-all ${isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200'}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse select-none">
              <thead>
                <tr className={`border-b text-xs uppercase tracking-wider ${isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                  <th className="p-4 font-bold">{tr.colName}</th>
                  <th className="p-4 font-bold">{tr.colImage}</th>
                  <th className="p-4 font-bold">{tr.colStatus}</th>
                  <th className="p-4 font-bold">{tr.colPorts}</th>
                  <th className="p-4 font-bold text-center w-40">{tr.colActions}</th>
                </tr>
              </thead>
              <tbody className={`divide-y text-sm ${isDark ? 'divide-slate-800/30' : 'divide-slate-100'}`}>
                {containers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-12 text-center text-xs text-slate-400">
                      {tr.noContainers}
                    </td>
                  </tr>
                )}
                {containers.map((item, idx) => {
                  const isRunning = item.status.toLowerCase().includes('running');
                  return (
                    <tr key={idx} className={`transition duration-200 ${isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50'}`}>
                      <td className="p-4">
                        <div className={`font-bold text-xs ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{item.name}</div>
                        <div className={`text-[10px] font-mono select-all mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{item.id}</div>
                      </td>
                      <td className={`p-4 font-mono text-xs truncate max-w-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`} title={item.image}>
                        {item.image}
                      </td>
                      <td className="p-4">
                        <span className={`px-3 py-1 text-xs font-semibold rounded-full select-none border transition-all ${
                          isRunning
                            ? 'bg-green-500/10 border-green-500/20 text-green-500'
                            : isDark ? 'bg-slate-800/60 border-slate-700 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-600'
                        }`}>
                          {item.status}
                        </span>
                      </td>
                      <td className={`p-4 font-mono text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{item.ports || '—'}</td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {isRunning ? (
                            <button
                              onClick={() => handleStopContainer(item.id)}
                              className={`p-2 rounded-xl border transition-all ${isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-amber-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-amber-600'}`}
                              title="Stop Container"
                            >
                              <Icons.Square className="w-3.5 h-3.5 fill-current" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleStartContainer(item.id)}
                              className={`p-2 rounded-xl border transition-all ${isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-green-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-green-600'}`}
                              title="Start Container"
                            >
                              <Icons.Play className="w-3.5 h-3.5 fill-current" />
                            </button>
                          )}
                          <button
                            onClick={() => handleRestartContainer(item.id)}
                            className={`p-2 rounded-xl border transition-all ${isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-blue-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-blue-600'}`}
                            title="Restart Container"
                          >
                            <Icons.RefreshCcw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleViewLogs(item)}
                            className={`p-2 rounded-xl border transition-all ${isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600'}`}
                            title="View Logs"
                          >
                            <Icons.FileText className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemoveContainer(item.id)}
                            className={`p-2 rounded-xl border transition-all ${isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-red-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-red-600'}`}
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

      {viewingLogs && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 animate-fade-in select-none">
          <div className={`p-6 rounded-2xl w-full max-w-3xl h-[70vh] flex flex-col shadow-2xl space-y-4 border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <div className="flex items-center justify-between flex-shrink-0">
              <h3 className={`text-sm font-bold flex items-center gap-2 truncate max-w-md ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                <Icons.FileText className={`w-5 h-5 flex-shrink-0 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                <span>{tr.viewLogsTitle}: {viewingLogs.name}</span>
              </h3>
              <button
                onClick={() => setViewingLogs(null)}
                className="text-slate-500 hover:text-red-400 transition"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>
            <pre className={`flex-1 p-4 rounded-xl font-mono text-xs overflow-auto select-text border ${isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-100 text-slate-800'}`}>
              {viewingLogs.content}
            </pre>
            <div className="flex items-center justify-end flex-shrink-0">
              <button
                onClick={() => setViewingLogs(null)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                {tr.closeBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
