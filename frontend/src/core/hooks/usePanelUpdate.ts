/**
 * Panel version + self-update state shared by the Classic sidebar footer and
 * the Desktop dock version badge; both open the same upgrade dialog.
 *
 * Data: `/health` (installed version, everyone) and
 * `/api/platform/panel-update/check` (superadmin, GitHub main vs local).
 * The upgrade runs detached on the server (`POST /api/platform/panel-update/run`)
 * and is followed through `GET /api/platform/panel-update/status`, which keeps
 * working across the service restart the installer does.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface PanelUpdateInfo {
  local_version: string;
  remote_version: string | null;
  update_available: boolean;
  changelog: string | null;
  release_url: string;
  fetch_error: string | null;
  fetch_error_kind?: 'rate_limit' | 'network' | 'unknown' | null;
}

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
export function usePanelUpdate(isSuperAdmin: boolean) {
  const [version, setVersion] = useState<string>('…');
  const [info, setInfo] = useState<PanelUpdateInfo | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState('');
  const [progress, setProgress] = useState(0);
  const [success, setSuccess] = useState(false);
  const [failed, setFailed] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const runningRef = useRef(false);
  runningRef.current = running;

  useEffect(() => {
    fetch('/health')
      .then((r) => r.json())
      .then((j) => setVersion(j?.version ? String(j.version) : '…'))
      .catch(() => setVersion('…'));
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    const check = () => {
      const token = localStorage.getItem('copanel_token');
      if (!token) return;
      fetch('/api/platform/panel-update/check', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((body) => {
          if (body?.status === 'success' && body.data) setInfo(body.data);
        })
        .catch(() => {});
    };
    check();
    const id = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isSuperAdmin]);

  const pollingRef = useRef(false);

  const pollHealthUntilVersion = useCallback((want: string | null | undefined) => {
    let n = 0;
    const iv = window.setInterval(async () => {
      n += 1;
      try {
        const h = await fetch('/health', { cache: 'no-store' });
        const j = await h.json();
        if (!want || (j?.version && String(j.version) === want)) {
          window.clearInterval(iv);
          window.setTimeout(() => window.location.reload(), 1600);
        }
      } catch {
        /* service still restarting */
      }
      if (n >= 90) {
        window.clearInterval(iv);
        window.location.reload();
      }
    }, 2000);
  }, []);

  /**
   * Follow the detached updater through ``/panel-update/status``. While the
   * service restarts the API is unreachable (network error / 502 / 503): that
   * is expected, so keep retrying and show "Restarting service…".
   */
  const followUpdate = useCallback(
    async (startOffset = 0) => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      setRunning(true);
      setFailed(false);
      let offset = startOffset;
      const deadline = Date.now() + 60 * 60 * 1000;
      try {
        while (Date.now() < deadline) {
          let body: any = null;
          try {
            const token = localStorage.getItem('copanel_token') || '';
            const res = await fetch(`/api/platform/panel-update/status?offset=${offset}`, {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            });
            if (res.status === 401 || res.status === 403) {
              setLog((prev) => `${prev}\nHTTP ${res.status}\n`);
              break;
            }
            if (res.ok) body = await res.json();
          } catch {
            body = null;
          }
          const st = body?.status === 'success' ? body.data : null;
          if (!st) {
            setRestarting(true);
          } else {
            setRestarting(false);
            if (typeof st.offset === 'number' && st.offset < offset) {
              // Log restarted (new run): reload it from the top.
              setLog(st.log || '');
            } else if (st.log) {
              const chunk: string = st.log;
              setLog((prev) => prev + chunk);
              setProgress((p) => Math.min(92, p + chunk.split('\n').length * 0.35));
            }
            offset = typeof st.offset === 'number' ? st.offset : offset;
            if (st.status === 'success') {
              setProgress(100);
              setSuccess(true);
              setRunning(false);
              pollHealthUntilVersion(st.target_version);
              return;
            }
            if (st.status === 'failed' || st.status === 'interrupted') {
              setFailed(true);
              setRunning(false);
              return;
            }
            if (st.status === 'idle') {
              setRunning(false);
              return;
            }
          }
          await new Promise((r) => window.setTimeout(r, 2000));
        }
        setRunning(false);
      } finally {
        pollingRef.current = false;
      }
    },
    [pollHealthUntilVersion],
  );

  const runUpgrade = useCallback(async () => {
    const token = localStorage.getItem('copanel_token');
    if (!token) return;
    setRunning(true);
    setSuccess(false);
    setFailed(false);
    setLog('');
    setProgress(6);
    try {
      const res = await fetch('/api/platform/panel-update/run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 409) {
        const text = await res.text();
        setLog(`HTTP ${res.status}\n${text}\n`);
        setRunning(false);
        setFailed(true);
        return;
      }
    } catch (e) {
      setLog(`${String(e)}\n`);
      setRunning(false);
      setFailed(true);
      return;
    }
    // 409: an update is already running — follow it.
    void followUpdate(0);
  }, [followUpdate]);

  // After a page reload mid-update, reattach to the running updater.
  useEffect(() => {
    if (!isSuperAdmin) return;
    const token = localStorage.getItem('copanel_token');
    if (!token) return;
    fetch('/api/platform/panel-update/status?offset=0', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const st = body?.status === 'success' ? body.data : null;
        if (st && (st.status === 'running' || st.status === 'starting')) {
          setModalOpen(true);
          setProgress(30);
          void followUpdate(0);
        }
      })
      .catch(() => {});
  }, [isSuperAdmin, followUpdate]);

  const openModal = useCallback(() => setModalOpen(true), []);
  /** Close unless an upgrade is streaming (the log must stay visible). */
  const closeModal = useCallback(() => {
    if (!runningRef.current) setModalOpen(false);
  }, []);

  const updateAvailable = isSuperAdmin && !!info?.update_available;

  return {
    version,
    info,
    updateAvailable,
    modalOpen,
    openModal,
    closeModal,
    running,
    log,
    progress,
    success,
    failed,
    restarting,
    runUpgrade,
  };
}

export type PanelUpdateState = ReturnType<typeof usePanelUpdate>;
