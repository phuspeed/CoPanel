/**
 * EventSource/fetch subscription to the backend ``/api/platform/events``
 * stream. Re-emits ``jobs`` and ``notifications`` topics into a tiny pub/sub
 * so multiple UI surfaces (Task Center, Notification Center, Dashboard
 * widgets) can listen without each opening their own SSE connection.
 *
 * Uses ``fetch()`` rather than ``EventSource`` so an HTTP 401 is visible:
 * EventSource does not expose the status, auto-reconnects on the same URL,
 * and can flood the console when the backend rejects the query token.
 */
import { apiFetch, fetchStreamTicket, getAuthToken, SESSION_EXPIRED_EVENT } from '../authHeaders';

type Handler = (payload: any) => void;

export const PLATFORM_SSE_DEGRADED_EVENT = 'copanel-platform-sse-degraded';

const MIN_RETRY_MS = 2000;
const MAX_RETRY_MS = 60000;
const POLL_FALLBACK_AFTER_FAILURES = 3;

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: string, data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let eventName = 'message';
  let dataLines: string[] = [];

  const flush = () => {
    if (dataLines.length) {
      onEvent(eventName, dataLines.join('\n'));
    }
    eventName = 'message';
    dataLines = [];
  };

  try {
    while (true) {
      if (signal.aborted) {
        try {
          await reader.cancel();
        } catch {
          /* already closed */
        }
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        buf += decoder.decode();
        if (buf) {
          // trailing line without a terminator
          const line = buf;
          buf = '';
          if (line === '') flush();
          else if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        flush();
        return;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line === '') {
          flush();
          continue;
        }
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

class EventHub {
  private abort: AbortController | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private retryDelay = MIN_RETRY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failureCount = 0;
  private connecting = false;
  private streamOpen = false;
  private authFailed = false;
  /** After repeated stream failures (or an auth 401), stop SSE and let polling take over. */
  private gaveUp = false;

  on(topic: string, handler: Handler): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }
    set.add(handler);
    this.ensureConnected();
    return () => {
      set!.delete(handler);
      if (set!.size === 0) {
        this.handlers.delete(topic);
      }
      this.teardownIfIdle();
    };
  }

  emit(topic: string, payload: any) {
    const set = this.handlers.get(topic);
    if (set) {
      set.forEach((h) => {
        try {
          h(payload);
        } catch (err) {
          console.error('event handler failed', topic, err);
        }
      });
    }
  }

  private async buildUrl(): Promise<string | null> {
    if (!getAuthToken()) return null;
    const ticket = await fetchStreamTicket();
    if (!ticket) return null;
    const params = new URLSearchParams({
      topics: 'jobs,notifications',
      ticket,
    });
    return `/api/platform/events?${params.toString()}`;
  }

  private ensureConnected() {
    if (this.authFailed || this.gaveUp || this.streamOpen || this.connecting) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!getAuthToken()) return;
    this.connecting = true;
    void this.buildUrl()
      .then((url) => {
        this.connecting = false;
        if (this.streamOpen || this.handlers.size === 0) return;
        if (this.authFailed || this.gaveUp) return;
        if (!url) {
          // Ticket request 401s clear the JWT; do not hammer the events URL.
          if (!getAuthToken()) {
            this.stopForAuthFailure();
            return;
          }
          this.failureCount += 1;
          if (this.shouldGiveUp()) {
            this.stopForDegraded();
            return;
          }
          this.scheduleRetry();
          return;
        }
        void this.openSource(url);
      })
      .catch(() => {
        this.connecting = false;
        this.scheduleRetry();
      });
  }

  private async openSource(url: string) {
    if (this.authFailed || this.gaveUp || this.streamOpen) return;
    const ac = new AbortController();
    this.abort = ac;
    this.streamOpen = true;
    try {
      // Same-origin: include cached nginx Basic Auth if a live vhost still
      // requires it on this location (legacy site before startup rewrite).
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        credentials: 'include',
        cache: 'no-store',
        signal: ac.signal,
      });
      if (res.status === 401) {
        this.streamOpen = false;
        this.abort = null;
        await this.handleStreamUnauthorized();
        return;
      }
      if (!res.ok || !res.body) {
        this.streamOpen = false;
        this.abort = null;
        this.failureCount += 1;
        if (this.shouldGiveUp()) {
          this.stopForDegraded();
          return;
        }
        this.scheduleRetry();
        return;
      }
      this.failureCount = 0;
      this.retryDelay = MIN_RETRY_MS;
      await readSseStream(res.body, ac.signal, (eventName, data) => {
        this.onStreamMessage();
        if (eventName === 'jobs' || eventName === 'notifications') {
          this.parseAndEmit(eventName, data);
        }
      });
      this.streamOpen = false;
      this.abort = null;
      if (ac.signal.aborted || this.authFailed || this.gaveUp) return;
      if (this.handlers.size === 0) return;
      this.scheduleRetry();
    } catch {
      this.streamOpen = false;
      this.abort = null;
      if (ac.signal.aborted || this.authFailed || this.gaveUp) return;
      this.failureCount += 1;
      if (this.shouldGiveUp()) {
        this.stopForDegraded();
        return;
      }
      this.scheduleRetry();
    }
  }

  private async handleStreamUnauthorized() {
    // A 401 on the stream is not always a dead session: a stale UI that still
    // sends ``?access_token=<JWT>`` is rejected even while Bearer auth works.
    // Only sign out when the session JWT itself is gone; otherwise stop SSE
    // and let Task Center / notifications fall back to polling.
    if (!getAuthToken()) {
      this.stopForAuthFailure();
      return;
    }
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.status === 401 || !getAuthToken()) {
        this.stopForAuthFailure();
        return;
      }
    } catch {
      /* network error: still treat the stream 401 as terminal for SSE */
    }
    this.stopForDegraded();
  }

  private shouldGiveUp(): boolean {
    return this.failureCount >= POLL_FALLBACK_AFTER_FAILURES;
  }

  private onStreamMessage() {
    this.failureCount = 0;
    this.retryDelay = MIN_RETRY_MS;
  }

  private parseAndEmit(topic: string, raw: string) {
    try {
      const msg = JSON.parse(raw);
      this.emit(topic, msg.payload || msg);
    } catch {
      /* ignore malformed events */
    }
  }

  private scheduleRetry() {
    if (this.authFailed || this.gaveUp) return;
    if (this.retryTimer) return;
    if (this.handlers.size === 0) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(Math.round(this.retryDelay * 1.8), MAX_RETRY_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.ensureConnected();
    }, delay);
  }

  private closeStream() {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
    this.streamOpen = false;
    this.connecting = false;
  }

  private teardownIfIdle() {
    if (this.handlers.size > 0) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.closeStream();
    this.failureCount = 0;
    this.retryDelay = MIN_RETRY_MS;
  }

  private stopForAuthFailure() {
    this.authFailed = true;
    this.gaveUp = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.closeStream();
  }

  private stopForDegraded() {
    this.gaveUp = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.closeStream();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(PLATFORM_SSE_DEGRADED_EVENT));
    }
  }

  /** Close the stream and do not retry until reconnect() (called after login). */
  stop() {
    this.stopForAuthFailure();
  }

  /**
   * Drop the SSE connection and open a new one if handlers exist and a token
   * is present. Pass ``force`` after a fresh login so a previous give-up or
   * auth failure does not stick. Visibility changes do not force a retry
   * once the stream has been given up (polling stays in charge).
   */
  reconnect(options?: { force?: boolean }) {
    const force = options?.force === true;
    if ((this.authFailed || this.gaveUp) && !force) return;
    this.authFailed = false;
    this.gaveUp = false;
    this.closeStream();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.failureCount = 0;
    this.retryDelay = MIN_RETRY_MS;
    if (this.handlers.size > 0 && getAuthToken()) {
      this.ensureConnected();
    }
  }
}

export const events = new EventHub();

/** Call after login so the stream connects (first subscribe may have run before token existed). */
export function reconnectPlatformEvents(options?: { force?: boolean }) {
  events.reconnect(options);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // Mint a fresh stream ticket when still in SSE mode; the previous one
      // was single-use. If we already gave up, leave polling in charge.
      reconnectPlatformEvents();
    }
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener(SESSION_EXPIRED_EVENT, () => {
    events.stop();
  });
}
