/**
 * Docker Manager — Desktop sidebar shell with containers, compose, images, networks, volumes.
 */
import { useState, useEffect, useMemo, useCallback, useRef, Fragment, type ReactNode } from 'react';
import { useAppShellContext } from '../../core/hooks/useAppShellContext';
import { apiFetch } from '../../core/authHeaders';
import { useJobs, jobsApi } from '../../core/platform';
import { useIsWindowedModule } from '../../core/shell/WindowViewportContext';
import ModuleViewport from '../../core/shell/ModuleViewport';
import ModuleSidebarLayout from '../../core/shell/ModuleSidebarLayout';
import WindowModal from '../../core/shell/WindowModal';
import DockerManagerSidebar, { type DockerTab } from './components/DockerManagerSidebar';
import CreateProjectModal from './components/CreateProjectModal';
import ProjectManagerPanel from './components/ProjectManagerPanel';
import OperationStatusBanner, { useBusyContainerIds } from './components/OperationStatusBanner';
import { cn } from '../../lib/utils';
import * as Icons from 'lucide-react';

interface ContainerItem {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  project?: string;
}

interface ContainerStats {
  id: string;
  name: string;
  cpu: string;
  mem_usage: string;
  mem_percent: string;
  net_io: string;
}

interface ImageItem {
  repository: string;
  tag: string;
  id: string;
  size: string;
}

interface NetworkItem {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

interface VolumeItem {
  name: string;
  driver: string;
  mountpoint: string;
}

interface LogLine {
  timestamp: string | null;
  message: string;
}

const DOCKER_LOG_TS_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.*)$/;

function parseDockerLogs(raw: string): LogLine[] {
  if (!raw) return [];
  const lines = raw.split('\n').map((line) => {
    const m = line.match(DOCKER_LOG_TS_RE);
    if (m) return { timestamp: m[1], message: m[2] };
    return { timestamp: null, message: line };
  });
  if (lines.length > 0 && lines[lines.length - 1].message === '' && lines[lines.length - 1].timestamp === null) {
    lines.pop();
  }
  return lines.reverse();
}

function formatLogTimestamp(iso: string, language: 'en' | 'vi'): string {
  try {
    return new Date(iso).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

export default function DockerManagerDashboard() {
  const { theme, language } = useAppShellContext();
  const isDark = theme === 'dark';
  const windowed = useIsWindowedModule();

  const [tab, setTab] = useState<DockerTab>('containers');
  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [projectsCount, setProjectsCount] = useState(0);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [networks, setNetworks] = useState<NetworkItem[]>([]);
  const [volumes, setVolumes] = useState<VolumeItem[]>([]);

  const [loading, setLoading] = useState(false);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [networksLoading, setNetworksLoading] = useState(false);
  const [volumesLoading, setVolumesLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [runningCount, setRunningCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [viewingLogs, setViewingLogs] = useState<{ id: string; name: string; content: string } | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsTail, setLogsTail] = useState(500);
  const [logsAutoRefresh, setLogsAutoRefresh] = useState(false);
  const [statsById, setStatsById] = useState<Record<string, ContainerStats>>({});
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const busyContainerIds = useBusyContainerIds();
  const { jobs } = useJobs();
  const prevJobStatuses = useRef<Record<string, string>>({});

  const tr = useMemo(
    () =>
      ({
        en: {
          title: 'Docker Manager',
          subtitle: 'Containers, Compose & resources',
          containers: 'Containers',
          compose: 'Compose',
          images: 'Images',
          networks: 'Networks',
          volumes: 'Volumes',
          tabContainersTitle: 'Running Containers',
          tabContainersDesc: 'Start, stop, restart containers and inspect live logs.',
          tabComposeTitle: 'Projects & Compose',
          tabComposeDesc: 'Manage panel projects (edit, deploy, logs) and discover external compose files.',
          tabImagesTitle: 'Docker Images',
          tabImagesDesc: 'View and manage images stored on this host.',
          tabNetworksTitle: 'Docker Networks',
          tabNetworksDesc: 'Inspect and remove user-defined networks.',
          tabVolumesTitle: 'Docker Volumes',
          tabVolumesDesc: 'Inspect and remove unused volumes.',
          refresh: 'Refresh',
          createProject: 'New Project',
          scanTitle: 'Discover Compose Files',
          scanDesc: 'Find local folders with compose stacks ready to be deployed.',
          scanPlaceholder: 'e.g. /home/Docker',
          scanBtn: 'Scan',
          noCompose: 'No compose files found. Enter a custom path above and click Scan.',
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
          colCpu: 'CPU',
          colMem: 'Memory',
          colNet: 'Network I/O',
          colPorts: 'Ports Mapping',
          colProject: 'Project',
          colActions: 'Actions',
          filterAllProjects: 'All projects',
          filterStandalone: 'Standalone',
          standaloneProject: 'Standalone',
          noContainers: 'No Docker containers on this system.',
          deleteConfirm: 'Are you sure you want to completely remove this container?',
          removeImageConfirm: 'Remove this image?',
          removeNetworkConfirm: 'Remove this network?',
          removeVolumeConfirm: 'Remove this volume?',
          viewLogsTitle: 'Logs for',
          logTime: 'Time',
          logMessage: 'Message',
          closeBtn: 'Close',
          loadingLogs: 'Loading logs...',
          refreshLogs: 'Refresh',
          autoRefresh: 'Auto-refresh',
          logTail: 'Lines',
          jobQueued: 'Task queued — follow progress in Task Center.',
          actionBusy: 'Busy',
          composeColFile: 'Compose file',
          composeColPath: 'Directory',
          composeColAction: 'Action',
          composeHide: 'Hide list',
          composeShow: 'Show list',
          composeCollapsed: '{count} compose file(s) — click "Show list" to view.',
          colRepo: 'Repository',
          colTag: 'Tag',
          colSize: 'Size',
          colDriver: 'Driver',
          colScope: 'Scope',
          colMount: 'Mount point',
          noImages: 'No images found.',
          noNetworks: 'No networks found.',
          noVolumes: 'No volumes found.',
          loading: 'Loading...',
          remove: 'Remove',
        },
        vi: {
          title: 'Docker Manager',
          subtitle: 'Container, Compose & tài nguyên',
          containers: 'Container',
          compose: 'Compose',
          images: 'Image',
          networks: 'Mạng',
          volumes: 'Volume',
          tabContainersTitle: 'Container đang chạy',
          tabContainersDesc: 'Khởi động, dừng, khởi động lại container và xem log trực tiếp.',
          tabComposeTitle: 'Project & Compose',
          tabComposeDesc: 'Quản lý project (sửa, triển khai, log) và quét compose bên ngoài.',
          tabImagesTitle: 'Docker Image',
          tabImagesDesc: 'Xem và quản lý image trên máy chủ.',
          tabNetworksTitle: 'Docker Network',
          tabNetworksDesc: 'Xem và xóa mạng do người dùng tạo.',
          tabVolumesTitle: 'Docker Volume',
          tabVolumesDesc: 'Xem và xóa volume không dùng.',
          refresh: 'Làm mới',
          createProject: 'Tạo Project',
          scanTitle: 'Tìm tệp Compose',
          scanDesc: 'Tìm thư mục chứa compose stack sẵn sàng triển khai.',
          scanPlaceholder: 'Ví dụ: /home/Docker',
          scanBtn: 'Quét',
          noCompose: 'Không tìm thấy tệp compose. Nhập đường dẫn và bấm Quét.',
          buildDeploy: 'Xây dựng & Triển khai',
          outputStarting: 'Đang khởi chạy build stack...',
          outputSuccess: 'Triển khai stack thành công.',
          outputFailed: 'Không thể khởi chạy compose stack.',
          outputCommFailed: 'Không thể kết nối với máy chủ.',
          totalContainers: 'Tổng Container',
          activeContainers: 'Container đang chạy',
          loadingConts: 'Đang tải danh sách container...',
          colName: 'Tên & ID Container',
          colImage: 'Tên Image',
          colStatus: 'Trạng thái',
          colCpu: 'CPU',
          colMem: 'RAM',
          colNet: 'Network I/O',
          colPorts: 'Bản đồ cổng',
          colProject: 'Project',
          colActions: 'Hành động',
          filterAllProjects: 'Tất cả project',
          filterStandalone: 'Độc lập',
          standaloneProject: 'Độc lập',
          noContainers: 'Không có container Docker trên hệ thống.',
          deleteConfirm: 'Bạn có chắc muốn xóa hoàn toàn container này?',
          removeImageConfirm: 'Xóa image này?',
          removeNetworkConfirm: 'Xóa mạng này?',
          removeVolumeConfirm: 'Xóa volume này?',
          viewLogsTitle: 'Logs cho',
          logTime: 'Thời gian',
          logMessage: 'Nội dung',
          closeBtn: 'Đóng',
          loadingLogs: 'Đang tải log...',
          refreshLogs: 'Làm mới',
          autoRefresh: 'Tự làm mới',
          logTail: 'Số dòng',
          jobQueued: 'Đã xếp hàng — theo dõi tiến trình ở Task Center.',
          actionBusy: 'Đang xử lý',
          composeColFile: 'Tệp Compose',
          composeColPath: 'Thư mục',
          composeColAction: 'Hành động',
          composeHide: 'Ẩn danh sách',
          composeShow: 'Hiện danh sách',
          composeCollapsed: '{count} tệp compose — bấm "Hiện danh sách" để xem.',
          colRepo: 'Repository',
          colTag: 'Tag',
          colSize: 'Kích thước',
          colDriver: 'Driver',
          colScope: 'Phạm vi',
          colMount: 'Điểm mount',
          noImages: 'Không tìm thấy image.',
          noNetworks: 'Không tìm thấy mạng.',
          noVolumes: 'Không tìm thấy volume.',
          loading: 'Đang tải...',
          remove: 'Xóa',
        },
      })[language || 'en'],
    [language],
  );

  const labels = useMemo(
    () => ({
      containers: tr.containers,
      compose: tr.compose,
      images: tr.images,
      networks: tr.networks,
      volumes: tr.volumes,
    }),
    [tr],
  );

  const tabMeta = useMemo(
    () => ({
      containers: { title: tr.tabContainersTitle, desc: tr.tabContainersDesc },
      compose: { title: tr.tabComposeTitle, desc: tr.tabComposeDesc },
      images: { title: tr.tabImagesTitle, desc: tr.tabImagesDesc },
      networks: { title: tr.tabNetworksTitle, desc: tr.tabNetworksDesc },
      volumes: { title: tr.tabVolumesTitle, desc: tr.tabVolumesDesc },
    }),
    [tr],
  );

  const fetchContainers = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await apiFetch('/api/docker_manager/list');
      if (!response.ok) {
        const data = await response.json();
        const detail = data.detail;
        throw new Error(typeof detail === 'object' ? detail?.message || 'Failed to fetch containers' : detail || 'Failed to fetch containers');
      }
      const data = await response.json();
      const list = data.containers || [];
      setContainers(list);
      const running = list.filter((c: ContainerItem) => c.status.toLowerCase().includes('running')).length;
      setRunningCount(running);
      setTotalCount(list.length);
    } catch (err) {
      if (!opts?.silent) setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const response = await apiFetch('/api/docker_manager/stats');
      if (!response.ok) return;
      const data = await response.json();
      const rows: ContainerStats[] = data.data || [];
      const map: Record<string, ContainerStats> = {};
      for (const row of rows) {
        if (row.id) map[row.id] = row;
        if (row.name) map[row.name] = row;
      }
      setStatsById(map);
    } catch {
      // stats are best-effort; list still works without them
    }
  }, []);

  const lookupStats = useCallback(
    (item: ContainerItem): ContainerStats | undefined => {
      return (
        statsById[item.id] ||
        statsById[item.name] ||
        Object.values(statsById).find(
          (s) =>
            (s.id && (item.id.startsWith(s.id) || s.id.startsWith(item.id))) ||
            s.name === item.name ||
            s.name?.endsWith(`/${item.name}`) ||
            s.name?.endsWith(`_${item.name}`),
        )
      );
    },
    [statsById],
  );

  const isContainerBusy = useCallback(
    (containerId: string) => {
      for (const id of busyContainerIds) {
        if (id === containerId || id.startsWith(containerId) || containerId.startsWith(id)) return true;
      }
      return false;
    },
    [busyContainerIds],
  );

  const fetchProjectsCount = useCallback(async () => {
    try {
      const r = await apiFetch('/api/docker_manager/projects/list');
      if (r.ok) {
        const d = await r.json();
        setProjectsCount((d.data || []).length);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchImages = useCallback(async () => {
    setImagesLoading(true);
    try {
      const r = await apiFetch('/api/docker_manager/images');
      if (r.ok) {
        const d = await r.json();
        setImages(d.data || []);
      }
    } catch {
      // ignore
    } finally {
      setImagesLoading(false);
    }
  }, []);

  const fetchNetworks = useCallback(async () => {
    setNetworksLoading(true);
    try {
      const r = await apiFetch('/api/docker_manager/networks');
      if (r.ok) {
        const d = await r.json();
        setNetworks(d.data || []);
      }
    } catch {
      // ignore
    } finally {
      setNetworksLoading(false);
    }
  }, []);

  const fetchVolumes = useCallback(async () => {
    setVolumesLoading(true);
    try {
      const r = await apiFetch('/api/docker_manager/volumes');
      if (r.ok) {
        const d = await r.json();
        setVolumes(d.data || []);
      }
    } catch {
      // ignore
    } finally {
      setVolumesLoading(false);
    }
  }, []);

  const refreshTab = useCallback(() => {
    if (tab === 'containers') fetchContainers();
    else if (tab === 'compose') fetchProjectsCount();
    else if (tab === 'images') fetchImages();
    else if (tab === 'networks') fetchNetworks();
    else if (tab === 'volumes') fetchVolumes();
  }, [tab, fetchContainers, fetchProjectsCount, fetchImages, fetchNetworks, fetchVolumes]);

  useEffect(() => {
    fetchContainers();
    fetchProjectsCount();
    fetchStats();
    jobsApi.refresh(50).catch(() => {});
  }, [language, fetchContainers, fetchProjectsCount, fetchStats]);

  useEffect(() => {
    if (tab === 'images' && images.length === 0) fetchImages();
    if (tab === 'networks' && networks.length === 0) fetchNetworks();
    if (tab === 'volumes' && volumes.length === 0) fetchVolumes();
  }, [tab, images.length, networks.length, volumes.length, fetchImages, fetchNetworks, fetchVolumes]);

  // Poll live stats while Containers tab is visible.
  useEffect(() => {
    if (tab !== 'containers') return;
    fetchStats();
    const timer = window.setInterval(() => fetchStats(), 5000);
    return () => window.clearInterval(timer);
  }, [tab, fetchStats]);

  // Soft-refresh container list periodically so status stays current during jobs.
  useEffect(() => {
    if (tab !== 'containers') return;
    const timer = window.setInterval(() => fetchContainers({ silent: true }), 8000);
    return () => window.clearInterval(timer);
  }, [tab, fetchContainers]);

  // When a docker_manager job finishes, refresh lists.
  useEffect(() => {
    const prev = prevJobStatuses.current;
    const next: Record<string, string> = { ...prev };
    let shouldRefresh = false;
    for (const job of jobs) {
      if (job.module !== 'docker_manager') continue;
      const was = prev[job.id];
      if (
        was &&
        (was === 'queued' || was === 'running') &&
        (job.status === 'success' || job.status === 'failed' || job.status === 'cancelled')
      ) {
        shouldRefresh = true;
      }
      next[job.id] = job.status;
    }
    prevJobStatuses.current = next;
    if (shouldRefresh) {
      fetchContainers({ silent: true });
      fetchStats();
      fetchProjectsCount();
    }
  }, [jobs, fetchContainers, fetchStats, fetchProjectsCount]);

  const queueContainerAction = async (endpoint: string, container_id: string, failMsg: string) => {
    try {
      const response = await apiFetch(`/api/docker_manager/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container_id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = data.detail;
        throw new Error(typeof detail === 'object' ? detail?.message || failMsg : detail || failMsg);
      }
      setActionNotice(tr.jobQueued);
      window.setTimeout(() => setActionNotice(null), 4000);
      fetchContainers({ silent: true });
    } catch (err) {
      alert(err instanceof Error ? err.message : failMsg);
    }
  };

  const handleStartContainer = (container_id: string) => queueContainerAction('start', container_id, 'Failed to start container');
  const handleStopContainer = (container_id: string) => queueContainerAction('stop', container_id, 'Failed to stop container');
  const handleRestartContainer = (container_id: string) => queueContainerAction('restart', container_id, 'Failed to restart container');

  const handleRemoveContainer = async (container_id: string) => {
    if (!confirm(tr.deleteConfirm)) return;
    await queueContainerAction('remove', container_id, 'Failed to remove container');
  };

  const loadContainerLogs = useCallback(
    async (containerId: string, name: string, tail: number, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLogsLoading(true);
      try {
        const params = new URLSearchParams({
          container_id: containerId,
          tail: String(tail),
          timestamps: 'true',
        });
        const response = await apiFetch(`/api/docker_manager/logs?${params}`);
        if (!response.ok) {
          const data = await response.json();
          const detail = data.detail;
          throw new Error(typeof detail === 'object' ? detail?.message || 'Failed to fetch container logs' : detail || 'Failed to fetch container logs');
        }
        const data = await response.json();
        setViewingLogs({
          id: containerId,
          name,
          content: data.logs || 'No logs recorded.',
        });
      } catch (err) {
        if (!opts?.silent) {
          setViewingLogs(null);
          alert(err instanceof Error ? err.message : 'Error retrieving logs');
        }
      } finally {
        if (!opts?.silent) setLogsLoading(false);
      }
    },
    [],
  );

  const handleViewLogs = (item: ContainerItem) => {
    setViewingLogs({ id: item.id, name: item.name, content: '' });
    setLogsAutoRefresh(false);
    loadContainerLogs(item.id, item.name, logsTail);
  };

  useEffect(() => {
    if (!viewingLogs || !logsAutoRefresh) return;
    const timer = window.setInterval(() => {
      loadContainerLogs(viewingLogs.id, viewingLogs.name, logsTail, { silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [viewingLogs?.id, viewingLogs?.name, logsAutoRefresh, logsTail, loadContainerLogs]);


  const handleRemoveImage = async (imageRef: string) => {
    if (!confirm(tr.removeImageConfirm)) return;
    try {
      const res = await apiFetch(`/api/docker_manager/images/remove?image_ref=${encodeURIComponent(imageRef)}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to remove image');
      fetchImages();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  };

  const handleRemoveNetwork = async (name: string) => {
    if (!confirm(tr.removeNetworkConfirm)) return;
    try {
      const res = await apiFetch(`/api/docker_manager/networks/remove?name=${encodeURIComponent(name)}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to remove network');
      fetchNetworks();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  };

  const handleRemoveVolume = async (name: string) => {
    if (!confirm(tr.removeVolumeConfirm)) return;
    try {
      const res = await apiFetch(`/api/docker_manager/volumes/remove?name=${encodeURIComponent(name)}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to remove volume');
      fetchVolumes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  };

  const isRefreshing =
    (tab === 'containers' && loading) ||
    (tab === 'images' && imagesLoading) ||
    (tab === 'networks' && networksLoading) ||
    (tab === 'volumes' && volumesLoading);

  const projectNames = useMemo(
    () => [...new Set(containers.map((c) => c.project).filter((p): p is string => !!p))].sort(),
    [containers],
  );

  const filteredContainers = useMemo(() => {
    if (projectFilter === 'all') return containers;
    if (projectFilter === '__standalone__') return containers.filter((c) => !c.project);
    return containers.filter((c) => c.project === projectFilter);
  }, [containers, projectFilter]);

  const containerGroups = useMemo((): [string, ContainerItem[]][] => {
    if (projectFilter !== 'all') return [['', filteredContainers]];
    const map = new Map<string, ContainerItem[]>();
    for (const c of filteredContainers) {
      const key = c.project || '__standalone__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredContainers, projectFilter]);

  const card = cn(
    'border rounded-2xl overflow-hidden backdrop-blur-md transition-all',
    isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm',
  );

  const renderContainers = () => (
    <div className="space-y-6">
      <OperationStatusBanner isDark={isDark} language={language || 'en'} />
      {actionNotice && (
        <div
          className={cn(
            'rounded-xl border px-3 py-2 text-xs font-medium flex items-center justify-between gap-2',
            isDark ? 'bg-emerald-950/30 border-emerald-500/25 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-700',
          )}
        >
          <span>{actionNotice}</span>
          <button type="button" onClick={() => setActionNotice(null)} className="opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div
          className={cn(
            'border rounded-2xl p-5 flex items-center justify-between',
            isDark ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200',
          )}
        >
          <div>
            <p className={cn('text-[10px] mb-1 uppercase font-bold tracking-widest', isDark ? 'text-slate-400' : 'text-slate-500')}>
              {tr.totalContainers}
            </p>
            <p className={cn('text-3xl font-extrabold', isDark ? 'text-white' : 'text-slate-800')}>{totalCount}</p>
          </div>
          <div
            className={cn(
              'w-12 h-12 border rounded-xl flex items-center justify-center',
              isDark ? 'bg-blue-900/10 border-blue-500/20 text-blue-400' : 'bg-blue-50 border-blue-100 text-blue-600',
            )}
          >
            <Icons.Layers className="w-6 h-6" />
          </div>
        </div>
        <div
          className={cn(
            'border rounded-2xl p-5 flex items-center justify-between',
            isDark ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200',
          )}
        >
          <div>
            <p className={cn('text-[10px] mb-1 uppercase font-bold tracking-widest', isDark ? 'text-slate-400' : 'text-slate-500')}>
              {tr.activeContainers}
            </p>
            <p className={cn('text-3xl font-extrabold', isDark ? 'text-white' : 'text-slate-800')}>{runningCount}</p>
          </div>
          <div
            className={cn(
              'w-12 h-12 border rounded-xl flex items-center justify-center',
              isDark ? 'bg-green-900/10 border-green-500/20 text-green-400' : 'bg-green-50 border-green-100 text-green-600',
            )}
          >
            <Icons.Play className="w-6 h-6" />
          </div>
        </div>
      </div>

      {loading && containers.length === 0 ? (
        <div
          className={cn(
            'flex flex-col items-center justify-center h-48 border rounded-2xl',
            isDark ? 'border-slate-800/60 bg-slate-900/30' : 'border-slate-200 bg-white',
          )}
        >
          <Icons.Loader className="w-7 h-7 animate-spin text-blue-500 mb-2" />
          <p className="text-slate-400 text-xs">{tr.loadingConts}</p>
        </div>
      ) : error ? (
        <div className="bg-red-950/20 border border-red-600/30 p-4 rounded-xl text-red-400 text-xs flex items-center gap-2">
          <Icons.AlertCircle className="w-4 h-4 shrink-0" />
          <span>Error: {error}</span>
        </div>
      ) : (
        <div className={card}>
          <div className={cn('flex items-center justify-end gap-2 px-3 py-2 border-b', isDark ? 'border-slate-800' : 'border-slate-100')}>
            <label className={cn('text-[10px] font-bold uppercase', isDark ? 'text-slate-500' : 'text-slate-400')}>{tr.colProject}</label>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className={cn(
                'rounded-lg border px-2 py-1 text-xs font-medium focus:outline-none',
                isDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-200 bg-white text-slate-800',
              )}
            >
              <option value="all">{tr.filterAllProjects}</option>
              <option value="__standalone__">{tr.filterStandalone}</option>
              {projectNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr
                  className={cn(
                    'border-b text-xs uppercase tracking-wider',
                    isDark ? 'bg-slate-950/60 border-slate-800/60 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-600',
                  )}
                >
                  <th className="p-3 font-bold">{tr.colName}</th>
                  <th className="p-3 font-bold">{tr.colProject}</th>
                  <th className="p-3 font-bold">{tr.colImage}</th>
                  <th className="p-3 font-bold">{tr.colStatus}</th>
                  <th className="p-3 font-bold">{tr.colCpu}</th>
                  <th className="p-3 font-bold">{tr.colMem}</th>
                  <th className="p-3 font-bold">{tr.colNet}</th>
                  <th className="p-3 font-bold">{tr.colPorts}</th>
                  <th className="p-3 font-bold text-center w-36">{tr.colActions}</th>
                </tr>
              </thead>
              <tbody className={cn('divide-y text-sm', isDark ? 'divide-slate-800/30' : 'divide-slate-100')}>
                {filteredContainers.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-10 text-center text-xs text-slate-400">
                      {tr.noContainers}
                    </td>
                  </tr>
                )}
                {containerGroups.map(([groupKey, items]) => (
                  <Fragment key={groupKey || 'flat'}>
                    {projectFilter === 'all' && (
                      <tr key={`group-${groupKey}`} className={isDark ? 'bg-slate-900/60' : 'bg-slate-50/80'}>
                        <td colSpan={9} className={cn('px-3 py-2 text-[10px] font-bold uppercase tracking-wider', isDark ? 'text-slate-400' : 'text-slate-500')}>
                          {groupKey === '__standalone__' ? tr.standaloneProject : groupKey}
                          <span className="ml-2 font-normal tabular-nums">({items.length})</span>
                        </td>
                      </tr>
                    )}
                    {items.map((item, idx) => {
                      const isRunning = item.status.toLowerCase().includes('running');
                      const busy = isContainerBusy(item.id);
                      const stats = lookupStats(item);
                      return (
                        <tr key={`${groupKey}-${idx}`} className={cn('transition', isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50')}>
                          <td className="p-3">
                            <div className={cn('font-bold text-xs', isDark ? 'text-slate-100' : 'text-slate-800')}>{item.name}</div>
                            <div className={cn('text-[10px] font-mono select-all mt-0.5', isDark ? 'text-slate-500' : 'text-slate-400')}>
                              {item.id}
                            </div>
                          </td>
                          <td className={cn('p-3 text-xs font-medium', isDark ? 'text-slate-400' : 'text-slate-600')}>
                            {item.project || '—'}
                          </td>
                          <td className={cn('p-3 font-mono text-xs truncate max-w-[10rem]', isDark ? 'text-slate-300' : 'text-slate-600')} title={item.image}>
                            {item.image}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col gap-1">
                              <span
                                className={cn(
                                  'px-2.5 py-0.5 text-xs font-semibold rounded-full border w-fit',
                                  isRunning
                                    ? 'bg-green-500/10 border-green-500/20 text-green-500'
                                    : isDark
                                      ? 'bg-slate-800/60 border-slate-700 text-slate-400'
                                      : 'bg-slate-100 border-slate-200 text-slate-600',
                                )}
                              >
                                {item.status}
                              </span>
                              {busy && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-500">
                                  <Icons.Loader2 className="w-3 h-3 animate-spin" />
                                  {tr.actionBusy}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={cn('p-3 font-mono text-xs tabular-nums', isDark ? 'text-slate-300' : 'text-slate-700')}>
                            {isRunning ? stats?.cpu || '…' : '—'}
                          </td>
                          <td className={cn('p-3 font-mono text-[11px]', isDark ? 'text-slate-400' : 'text-slate-600')} title={stats?.mem_usage}>
                            {isRunning ? (
                              <div>
                                <div>{stats?.mem_percent || '…'}</div>
                                <div className="opacity-70 truncate max-w-[7rem]">{stats?.mem_usage || ''}</div>
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={cn('p-3 font-mono text-[11px] truncate max-w-[7rem]', isDark ? 'text-slate-400' : 'text-slate-600')} title={stats?.net_io}>
                            {isRunning ? stats?.net_io || '…' : '—'}
                          </td>
                          <td className={cn('p-3 font-mono text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>{item.ports || '—'}</td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {isRunning ? (
                                <button
                                  onClick={() => handleStopContainer(item.id)}
                                  disabled={busy}
                                  className={cn(
                                    'p-1.5 rounded-lg border transition disabled:opacity-40 disabled:pointer-events-none',
                                    isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-amber-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-amber-600',
                                  )}
                                  title="Stop"
                                >
                                  <Icons.Square className="w-3.5 h-3.5 fill-current" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleStartContainer(item.id)}
                                  disabled={busy}
                                  className={cn(
                                    'p-1.5 rounded-lg border transition disabled:opacity-40 disabled:pointer-events-none',
                                    isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-green-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-green-600',
                                  )}
                                  title="Start"
                                >
                                  <Icons.Play className="w-3.5 h-3.5 fill-current" />
                                </button>
                              )}
                              <button
                                onClick={() => handleRestartContainer(item.id)}
                                disabled={busy}
                                className={cn(
                                  'p-1.5 rounded-lg border transition disabled:opacity-40 disabled:pointer-events-none',
                                  isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-blue-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-blue-600',
                                )}
                                title="Restart"
                              >
                                <Icons.RefreshCcw className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleViewLogs(item)}
                                className={cn(
                                  'p-1.5 rounded-lg border transition',
                                  isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600',
                                )}
                                title="Logs"
                              >
                                <Icons.FileText className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleRemoveContainer(item.id)}
                                disabled={busy}
                                className={cn(
                                  'p-1.5 rounded-lg border transition disabled:opacity-40 disabled:pointer-events-none',
                                  isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-red-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-red-600',
                                )}
                                title="Remove"
                              >
                                <Icons.Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  const renderSimpleTable = (
    loadingState: boolean,
    headers: string[],
    rows: ReactNode,
  ) => (
    <div className={card}>
      {loadingState ? (
        <div className="flex items-center justify-center gap-2 h-40 text-xs text-slate-400">
          <Icons.Loader2 className="w-5 h-5 animate-spin" />
          {tr.loading}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr
                className={cn(
                  'border-b text-xs uppercase tracking-wider',
                  isDark ? 'bg-slate-950/60 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-600',
                )}
              >
                {headers.map((h) => (
                  <th key={h} className="p-3 font-bold">
                    {h}
                  </th>
                ))}
                <th className="p-3 font-bold text-center w-24">{tr.colActions}</th>
              </tr>
            </thead>
            <tbody className={cn('divide-y', isDark ? 'divide-slate-800/30' : 'divide-slate-100')}>{rows}</tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderImages = () =>
    renderSimpleTable(
      imagesLoading && images.length === 0,
      [tr.colRepo, tr.colTag, tr.colSize],
      images.length === 0 ? (
        <tr>
          <td colSpan={4} className="p-10 text-center text-xs text-slate-400">
            {tr.noImages}
          </td>
        </tr>
      ) : (
        images.map((img, idx) => {
          const ref = img.repository === '<none>' ? img.id : `${img.repository}:${img.tag}`;
          return (
            <tr key={idx} className={cn('transition', isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50')}>
              <td className={cn('p-3 font-mono text-xs', isDark ? 'text-slate-200' : 'text-slate-800')}>{img.repository}</td>
              <td className={cn('p-3 text-xs', isDark ? 'text-slate-400' : 'text-slate-600')}>{img.tag}</td>
              <td className={cn('p-3 text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>{img.size}</td>
              <td className="p-3 text-center">
                <button
                  onClick={() => handleRemoveImage(ref)}
                  className={cn(
                    'p-1.5 rounded-lg border transition',
                    isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-red-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-red-600',
                  )}
                  title={tr.remove}
                >
                  <Icons.Trash2 className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          );
        })
      ),
    );

  const renderNetworks = () =>
    renderSimpleTable(
      networksLoading && networks.length === 0,
      [tr.colName, tr.colDriver, tr.colScope],
      networks.length === 0 ? (
        <tr>
          <td colSpan={4} className="p-10 text-center text-xs text-slate-400">
            {tr.noNetworks}
          </td>
        </tr>
      ) : (
        networks.map((net, idx) => (
          <tr key={idx} className={cn('transition', isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50')}>
            <td className={cn('p-3 text-xs font-medium', isDark ? 'text-slate-200' : 'text-slate-800')}>{net.name}</td>
            <td className={cn('p-3 text-xs', isDark ? 'text-slate-400' : 'text-slate-600')}>{net.driver}</td>
            <td className={cn('p-3 text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>{net.scope}</td>
            <td className="p-3 text-center">
              {net.name !== 'bridge' && net.name !== 'host' && net.name !== 'none' && (
                <button
                  onClick={() => handleRemoveNetwork(net.name)}
                  className={cn(
                    'p-1.5 rounded-lg border transition',
                    isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-red-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-red-600',
                  )}
                  title={tr.remove}
                >
                  <Icons.Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </td>
          </tr>
        ))
      ),
    );

  const renderVolumes = () =>
    renderSimpleTable(
      volumesLoading && volumes.length === 0,
      [tr.colName, tr.colDriver, tr.colMount],
      volumes.length === 0 ? (
        <tr>
          <td colSpan={4} className="p-10 text-center text-xs text-slate-400">
            {tr.noVolumes}
          </td>
        </tr>
      ) : (
        volumes.map((vol, idx) => (
          <tr key={idx} className={cn('transition', isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50')}>
            <td className={cn('p-3 text-xs font-medium', isDark ? 'text-slate-200' : 'text-slate-800')}>{vol.name}</td>
            <td className={cn('p-3 text-xs', isDark ? 'text-slate-400' : 'text-slate-600')}>{vol.driver}</td>
            <td className={cn('p-3 font-mono text-[11px] break-all', isDark ? 'text-slate-400' : 'text-slate-500')}>{vol.mountpoint}</td>
            <td className="p-3 text-center">
              <button
                onClick={() => handleRemoveVolume(vol.name)}
                className={cn(
                  'p-1.5 rounded-lg border transition',
                  isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-red-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-red-600',
                )}
                title={tr.remove}
              >
                <Icons.Trash2 className="w-3.5 h-3.5" />
              </button>
            </td>
          </tr>
        ))
      ),
    );

  return (
    <ModuleViewport className="flex min-h-0 flex-col overflow-hidden">
      <ModuleSidebarLayout
        isDark={isDark}
        mobileTitle={tr.title}
        className={cn('select-none', isDark ? 'text-slate-100' : 'text-slate-900')}
        sidebar={
          <DockerManagerSidebar
            tab={tab}
            onTab={setTab}
            isDark={isDark}
            labels={labels}
            title={tr.title}
            subtitle={tr.subtitle}
            counts={{
              containers: totalCount || undefined,
              compose: projectsCount || undefined,
              images: images.length || undefined,
              networks: networks.length || undefined,
              volumes: volumes.length || undefined,
            }}
          />
        }
      >
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className={cn('min-h-0 flex-1 overflow-y-auto', windowed ? 'p-5' : 'p-5 md:p-8')}>
            <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <h2 className={cn('text-lg font-bold', isDark ? 'text-slate-100' : 'text-slate-900')}>{tabMeta[tab].title}</h2>
                <p className={cn('text-xs max-w-2xl', isDark ? 'text-slate-400' : 'text-slate-500')}>{tabMeta[tab].desc}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {tab === 'containers' && (
                  <button
                    type="button"
                    onClick={() => setCreateProjectOpen(true)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition"
                    title={tr.createProject}
                  >
                    <Icons.Plus className="w-4 h-4" />
                    {tr.createProject}
                  </button>
                )}
                <button
                  type="button"
                  onClick={refreshTab}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition',
                    isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700' : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200',
                  )}
                  title={tr.refresh}
                >
                  <Icons.RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
                  {tr.refresh}
                </button>
              </div>
            </header>

            {tab === 'containers' && renderContainers()}
            {tab === 'compose' && (
              <ProjectManagerPanel
                isDark={isDark}
                language={language || 'en'}
                onRefreshContainers={() => {
                  fetchContainers();
                  fetchProjectsCount();
                }}
              />
            )}
            {tab === 'images' && renderImages()}
            {tab === 'networks' && renderNetworks()}
            {tab === 'volumes' && renderVolumes()}
          </main>
        </div>
      </ModuleSidebarLayout>

      <CreateProjectModal
        open={createProjectOpen}
        onClose={() => setCreateProjectOpen(false)}
        onCreated={() => {
          fetchContainers();
          fetchProjectsCount();
        }}
        isDark={isDark}
        language={language || 'en'}
      />

      <WindowModal
        open={!!viewingLogs}
        onClose={() => {
          setLogsAutoRefresh(false);
          setViewingLogs(null);
        }}
        title={viewingLogs ? `${tr.viewLogsTitle}: ${viewingLogs.name}` : tr.viewLogsTitle}
        maxWidth="2xl"
        className="flex max-h-[80vh] max-w-4xl flex-col"
        closeOnBackdropClick={false}
      >
        <div className="flex min-h-0 flex-1 flex-col space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <label className={cn('text-[10px] font-bold uppercase', isDark ? 'text-slate-500' : 'text-slate-400')}>{tr.logTail}</label>
            <select
              value={logsTail}
              onChange={(e) => {
                const next = Number(e.target.value) || 500;
                setLogsTail(next);
                if (viewingLogs) loadContainerLogs(viewingLogs.id, viewingLogs.name, next);
              }}
              className={cn(
                'rounded-lg border px-2 py-1 text-xs font-medium',
                isDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-200 bg-white text-slate-800',
              )}
            >
              {[100, 300, 500, 1000, 2000, 5000].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => viewingLogs && loadContainerLogs(viewingLogs.id, viewingLogs.name, logsTail)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold',
                isDark ? 'border-slate-700 bg-slate-800 text-slate-200' : 'border-slate-200 bg-white text-slate-700',
              )}
            >
              <Icons.RefreshCw className={cn('w-3.5 h-3.5', logsLoading && 'animate-spin')} />
              {tr.refreshLogs}
            </button>
            <label className={cn('flex items-center gap-1.5 text-xs font-medium ml-1', isDark ? 'text-slate-300' : 'text-slate-600')}>
              <input
                type="checkbox"
                checked={logsAutoRefresh}
                onChange={(e) => setLogsAutoRefresh(e.target.checked)}
                className="rounded border-slate-400"
              />
              {tr.autoRefresh}
            </label>
          </div>
          <div
            className={cn(
              'flex-1 rounded-xl overflow-hidden flex flex-col border min-h-0',
              isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-100',
            )}
          >
            <div
              className={cn(
                'grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-3 px-3 py-2 text-[10px] uppercase tracking-wider font-bold border-b shrink-0',
                isDark ? 'border-slate-800 text-slate-500 bg-slate-900/50' : 'border-slate-200 text-slate-400 bg-slate-100/80',
              )}
            >
              <span>{tr.logTime}</span>
              <span>{tr.logMessage}</span>
            </div>
            <div className="flex-1 overflow-auto select-text">
              {logsLoading && !viewingLogs?.content ? (
                <div className={cn('flex items-center justify-center gap-2 h-full min-h-[8rem] text-xs', isDark ? 'text-slate-500' : 'text-slate-400')}>
                  <Icons.Loader2 className="w-4 h-4 animate-spin" />
                  {tr.loadingLogs}
                </div>
              ) : (
                <div className="font-mono text-xs">
                  {parseDockerLogs(viewingLogs?.content ?? '').map((line, i) => (
                    <div
                      key={i}
                      className={cn(
                        'grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-3 px-3 py-1.5 border-b last:border-0',
                        isDark ? 'border-slate-800/60 hover:bg-slate-900/40' : 'border-slate-100 hover:bg-white/80',
                      )}
                    >
                      <span
                        className={cn(
                          'shrink-0 tabular-nums whitespace-nowrap',
                          line.timestamp ? (isDark ? 'text-cyan-400/90' : 'text-cyan-700') : 'text-transparent',
                        )}
                        title={line.timestamp || undefined}
                      >
                        {line.timestamp ? formatLogTimestamp(line.timestamp, language || 'en') : '—'}
                      </span>
                      <span className={cn('whitespace-pre-wrap break-all', isDark ? 'text-slate-200' : 'text-slate-800')}>
                        {line.message || '\u00a0'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end flex-shrink-0">
            <button
              onClick={() => {
                setLogsAutoRefresh(false);
                setViewingLogs(null);
              }}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-bold transition',
                isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600',
              )}
            >
              {tr.closeBtn}
            </button>
          </div>
        </div>
      </WindowModal>
    </ModuleViewport>
  );
}
