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
import ContainerDetailModal from './components/ContainerDetailModal';
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
  block_io?: string;
  pids?: string;
}

const COMPACT_LIST_WIDTH = 920;

interface ImageItem {
  repository: string;
  tag: string;
  id: string;
  size: string;
}

type ImageUpdateStatus = 'unknown' | 'up_to_date' | 'update_available' | 'error' | 'checking';

interface ImageUpdateInfo {
  status: ImageUpdateStatus;
  update_available?: boolean;
  local_digest?: string | null;
  remote_digest?: string | null;
  error?: string | null;
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
  const [imageUpdates, setImageUpdates] = useState<Record<string, ImageUpdateInfo>>({});
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingImages, setUpdatingImages] = useState<Record<string, boolean>>({});
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
  const [selectedContainer, setSelectedContainer] = useState<ContainerItem | null>(null);
  const [compactList, setCompactList] = useState(false);
  const listHostRef = useRef<HTMLDivElement>(null);
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
          tabImagesDesc: 'View images, check Docker Hub for newer digests, and pull updates.',
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
          clickForStatus: 'Click for status',
          tapForDetails: 'Tap a container for full status',
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
          colUpdate: 'Update',
          checkUpdates: 'Check updates',
          checkingUpdates: 'Checking…',
          updateToLatest: 'Update',
          updatingImage: 'Updating…',
          upToDate: 'Up to date',
          updateAvailable: 'New version',
          updateCheckError: 'Check failed',
          updateQueued: 'Update queued — follow Task Center.',
          updateHint: 'Compare local digests with Docker Hub, then pull newer tags.',
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
          tabImagesDesc: 'Xem image, kiểm tra bản mới trên Docker Hub và cập nhật.',
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
          clickForStatus: 'Bấm để xem trạng thái',
          tapForDetails: 'Chạm container để xem trạng thái đầy đủ',
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
          colUpdate: 'Cập nhật',
          checkUpdates: 'Kiểm tra cập nhật',
          checkingUpdates: 'Đang kiểm tra…',
          updateToLatest: 'Cập nhật',
          updatingImage: 'Đang cập nhật…',
          upToDate: 'Mới nhất',
          updateAvailable: 'Có bản mới',
          updateCheckError: 'Lỗi kiểm tra',
          updateQueued: 'Đã xếp hàng cập nhật — theo dõi Task Center.',
          updateHint: 'So sánh digest local với Docker Hub, rồi pull tag mới hơn.',
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

  // Card layout when the module content (or desktop window) is narrow.
  useEffect(() => {
    const el = listHostRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = (width: number) => setCompactList(width < COMPACT_LIST_WIDTH);
    apply(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? el.getBoundingClientRect().width;
      apply(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab, loading, containers.length]);

  // Keep detail modal container row fresh after list refresh.
  useEffect(() => {
    if (!selectedContainer) return;
    const next = containers.find(
      (c) => c.id === selectedContainer.id || c.name === selectedContainer.name,
    );
    if (!next) {
      setSelectedContainer(null);
      return;
    }
    if (
      next.status !== selectedContainer.status ||
      next.ports !== selectedContainer.ports ||
      next.image !== selectedContainer.image
    ) {
      setSelectedContainer(next);
    }
  }, [containers, selectedContainer]);

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

  const imageRefOf = (img: ImageItem) =>
    img.repository === '<none>' || img.tag === '<none>' ? img.id : `${img.repository}:${img.tag}`;

  const handleCheckImageUpdates = async () => {
    setCheckingUpdates(true);
    const refs = images
      .filter((img) => img.repository && img.repository !== '<none>' && img.tag && img.tag !== '<none>')
      .map((img) => `${img.repository}:${img.tag}`);
    const pending: Record<string, ImageUpdateInfo> = {};
    for (const ref of refs) pending[ref] = { status: 'checking' };
    setImageUpdates((prev) => ({ ...prev, ...pending }));
    try {
      const res = await apiFetch('/api/docker_manager/images/check-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_refs: refs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail?.message || data?.detail || 'Check failed');
      const next: Record<string, ImageUpdateInfo> = {};
      for (const row of data.data || []) {
        const key = row.image_ref as string;
        next[key] = {
          status: (row.status as ImageUpdateStatus) || (row.update_available ? 'update_available' : 'up_to_date'),
          update_available: !!row.update_available,
          local_digest: row.local_digest,
          remote_digest: row.remote_digest,
          error: row.error,
        };
      }
      setImageUpdates((prev) => ({ ...prev, ...next }));
    } catch (err) {
      alert(err instanceof Error ? err.message : tr.updateCheckError);
      setImageUpdates((prev) => {
        const copy = { ...prev };
        for (const ref of refs) {
          if (copy[ref]?.status === 'checking') copy[ref] = { status: 'error', error: 'failed' };
        }
        return copy;
      });
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleUpdateImage = async (imageRef: string) => {
    setUpdatingImages((prev) => ({ ...prev, [imageRef]: true }));
    try {
      const res = await apiFetch('/api/docker_manager/images/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ref: imageRef }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail?.message || data?.detail || 'Update failed');
      if (data.job_id) {
        alert(tr.updateQueued);
      }
      // Re-check this image after a short delay so Task Center can finish pull.
      window.setTimeout(() => {
        void (async () => {
          try {
            const check = await apiFetch('/api/docker_manager/images/check-updates', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image_refs: [imageRef] }),
            });
            if (check.ok) {
              const payload = await check.json();
              const row = (payload.data || [])[0];
              if (row) {
                setImageUpdates((prev) => ({
                  ...prev,
                  [imageRef]: {
                    status: (row.status as ImageUpdateStatus) || (row.update_available ? 'update_available' : 'up_to_date'),
                    update_available: !!row.update_available,
                    local_digest: row.local_digest,
                    remote_digest: row.remote_digest,
                    error: row.error,
                  },
                }));
              }
            }
            fetchImages();
          } catch {
            fetchImages();
          }
        })();
      }, 2500);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    } finally {
      setUpdatingImages((prev) => ({ ...prev, [imageRef]: false }));
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

  const renderContainerActionButtons = (item: ContainerItem, busy: boolean, isRunning: boolean) => (
    <>
      {isRunning ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleStopContainer(item.id);
          }}
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
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleStartContainer(item.id);
          }}
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
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleRestartContainer(item.id);
        }}
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
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleViewLogs(item);
        }}
        className={cn(
          'p-1.5 rounded-lg border transition',
          isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600',
        )}
        title="Logs"
      >
        <Icons.FileText className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleRemoveContainer(item.id);
        }}
        disabled={busy}
        className={cn(
          'p-1.5 rounded-lg border transition disabled:opacity-40 disabled:pointer-events-none',
          isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-red-400' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-red-600',
        )}
        title="Remove"
      >
        <Icons.Trash2 className="w-3.5 h-3.5" />
      </button>
    </>
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
        <div ref={listHostRef} className={card}>
          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b',
              isDark ? 'border-slate-800' : 'border-slate-100',
            )}
          >
            <p className={cn('text-[11px]', isDark ? 'text-slate-500' : 'text-slate-400')}>{tr.tapForDetails}</p>
            <div className="flex items-center gap-2">
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
          </div>

          {filteredContainers.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-400">{tr.noContainers}</div>
          ) : compactList ? (
            <div className="p-3 space-y-3">
              {containerGroups.map(([groupKey, items]) => (
                <div key={groupKey || 'flat'} className="space-y-2">
                  {projectFilter === 'all' && (
                    <div className={cn('px-1 text-[10px] font-bold uppercase tracking-wider', isDark ? 'text-slate-400' : 'text-slate-500')}>
                      {groupKey === '__standalone__' ? tr.standaloneProject : groupKey}
                      <span className="ml-2 font-normal tabular-nums">({items.length})</span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-2">
                    {items.map((item) => {
                      const isRunning = item.status.toLowerCase().includes('running');
                      const busy = isContainerBusy(item.id);
                      const stats = lookupStats(item);
                      return (
                        <div
                          key={item.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedContainer(item)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedContainer(item);
                            }
                          }}
                          className={cn(
                            'w-full text-left rounded-xl border p-3 transition space-y-2 cursor-pointer',
                            isDark
                              ? 'bg-slate-950/40 border-slate-800 hover:border-slate-600'
                              : 'bg-slate-50/80 border-slate-200 hover:border-slate-300 hover:bg-white',
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className={cn('font-bold text-xs truncate', isDark ? 'text-slate-100' : 'text-slate-800')}>{item.name}</div>
                              <div className={cn('text-[10px] font-mono mt-0.5', isDark ? 'text-slate-500' : 'text-slate-400')}>{item.id}</div>
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <span
                                className={cn(
                                  'px-2 py-0.5 text-[10px] font-semibold rounded-full border',
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
                          </div>
                          <div className={cn('text-[11px] font-mono truncate', isDark ? 'text-slate-400' : 'text-slate-500')} title={item.image}>
                            {item.image}
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-[10px]">
                            <div>
                              <p className={cn('uppercase font-bold tracking-wider', isDark ? 'text-slate-500' : 'text-slate-400')}>{tr.colCpu}</p>
                              <p className={cn('font-mono mt-0.5', isDark ? 'text-slate-200' : 'text-slate-700')}>
                                {isRunning ? stats?.cpu || '…' : '—'}
                              </p>
                            </div>
                            <div>
                              <p className={cn('uppercase font-bold tracking-wider', isDark ? 'text-slate-500' : 'text-slate-400')}>{tr.colMem}</p>
                              <p className={cn('font-mono mt-0.5 truncate', isDark ? 'text-slate-200' : 'text-slate-700')} title={stats?.mem_usage}>
                                {isRunning ? stats?.mem_percent || '…' : '—'}
                              </p>
                            </div>
                            <div>
                              <p className={cn('uppercase font-bold tracking-wider', isDark ? 'text-slate-500' : 'text-slate-400')}>{tr.colNet}</p>
                              <p className={cn('font-mono mt-0.5 truncate', isDark ? 'text-slate-200' : 'text-slate-700')} title={stats?.net_io}>
                                {isRunning ? stats?.net_io || '…' : '—'}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <span className={cn('text-[10px] font-mono truncate', isDark ? 'text-slate-500' : 'text-slate-400')} title={item.ports}>
                              {item.ports || '—'}
                            </span>
                            <span className="text-[10px] font-semibold text-blue-500 shrink-0">{tr.clickForStatus}</span>
                          </div>
                          <div
                            className="flex items-center justify-end gap-1.5 pt-1 border-t border-slate-200/50 dark:border-slate-800"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {renderContainerActionButtons(item, busy, isRunning)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
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
                          <tr
                            key={`${groupKey}-${idx}`}
                            onClick={() => setSelectedContainer(item)}
                            className={cn(
                              'transition cursor-pointer',
                              isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50',
                            )}
                            title={tr.clickForStatus}
                          >
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
                            <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1.5">
                                {renderContainerActionButtons(item, busy, isRunning)}
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
          )}
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

  const renderImages = () => (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className={cn('text-[11px]', isDark ? 'text-slate-500' : 'text-slate-400')}>{tr.updateHint}</p>
        <button
          type="button"
          onClick={() => void handleCheckImageUpdates()}
          disabled={checkingUpdates || images.length === 0}
          className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold transition"
        >
          {checkingUpdates ? <Icons.Loader2 className="w-4 h-4 animate-spin" /> : <Icons.CloudDownload className="w-4 h-4" />}
          {checkingUpdates ? tr.checkingUpdates : tr.checkUpdates}
        </button>
      </div>
      {renderSimpleTable(
        imagesLoading && images.length === 0,
        [tr.colRepo, tr.colTag, tr.colSize, tr.colUpdate],
        images.length === 0 ? (
          <tr>
            <td colSpan={5} className="p-10 text-center text-xs text-slate-400">
              {tr.noImages}
            </td>
          </tr>
        ) : (
          images.map((img, idx) => {
            const ref = imageRefOf(img);
            const canCheck = img.repository !== '<none>' && img.tag !== '<none>';
            const info = imageUpdates[ref];
            const busyUpdate = !!updatingImages[ref];
            return (
              <tr key={idx} className={cn('transition', isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50')}>
                <td className={cn('p-3 font-mono text-xs', isDark ? 'text-slate-200' : 'text-slate-800')}>{img.repository}</td>
                <td className={cn('p-3 text-xs', isDark ? 'text-slate-400' : 'text-slate-600')}>{img.tag}</td>
                <td className={cn('p-3 text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>{img.size}</td>
                <td className="p-3">
                  {!canCheck ? (
                    <span className="text-[10px] text-slate-500">—</span>
                  ) : info?.status === 'checking' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                      <Icons.Loader2 className="w-3 h-3 animate-spin" />
                      {tr.checkingUpdates}
                    </span>
                  ) : info?.status === 'update_available' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold bg-amber-500/10 border-amber-500/30 text-amber-500">
                      <Icons.ArrowUpCircle className="w-3 h-3" />
                      {tr.updateAvailable}
                    </span>
                  ) : info?.status === 'up_to_date' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold bg-emerald-500/10 border-emerald-500/30 text-emerald-500">
                      <Icons.CheckCircle2 className="w-3 h-3" />
                      {tr.upToDate}
                    </span>
                  ) : info?.status === 'error' ? (
                    <span className="text-[10px] text-red-400" title={info.error || undefined}>
                      {tr.updateCheckError}
                    </span>
                  ) : (
                    <span className={cn('text-[10px]', isDark ? 'text-slate-600' : 'text-slate-400')}>—</span>
                  )}
                </td>
                <td className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    {canCheck && (
                      <button
                        type="button"
                        onClick={() => void handleUpdateImage(ref)}
                        disabled={busyUpdate || checkingUpdates}
                        className={cn(
                          'p-1.5 rounded-lg border transition disabled:opacity-40',
                          info?.update_available
                            ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-500'
                            : isDark
                              ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-blue-400'
                              : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-blue-600',
                        )}
                        title={tr.updateToLatest}
                      >
                        {busyUpdate ? <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icons.Download className="w-3.5 h-3.5" />}
                      </button>
                    )}
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
                  </div>
                </td>
              </tr>
            );
          })
        ),
      )}
    </div>
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

      <ContainerDetailModal
        open={!!selectedContainer}
        container={selectedContainer}
        stats={selectedContainer ? lookupStats(selectedContainer) : undefined}
        busy={selectedContainer ? isContainerBusy(selectedContainer.id) : false}
        isDark={isDark}
        language={language || 'en'}
        onClose={() => setSelectedContainer(null)}
        onStart={handleStartContainer}
        onStop={handleStopContainer}
        onRestart={handleRestartContainer}
        onRemove={handleRemoveContainer}
        onLogs={(item) => {
          setSelectedContainer(null);
          handleViewLogs(item);
        }}
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
