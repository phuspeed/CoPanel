/**
 * EventSource-based subscription to the backend ``/api/platform/events``
 * stream. Re-emits ``jobs`` and ``notifications`` topics into a tiny pub/sub
 * so multiple UI surfaces (Task Center, Notification Center, Dashboard
 * widgets) can listen without each opening their own SSE connection.
 */
type Handler = (payload: any) => void;

export const PLATFORM_SSE_DEGRADED_EVENT = 'copanel-platform-sse-degraded';

const MIN_RETRY_MS = 2000;
const MAX_RETRY_MS = 60000;
const POLL_FALLBACK_AFTER_FAILURES = 3;

class EventHub {
  private source: EventSource | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private retryDelay = MIN_RETRY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failureCount = 0;

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

  private buildUrl(): string | null {
    const token = localStorage.getItem('copanel_token');
    if (!token) return null;
    const params = new URLSearchParams({
      topics: 'jobs,notifications',
      access_token: token,
    });
    return `/api/platform/events?${params.toString()}`;
  }

  private ensureConnected() {
    if (this.source) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const url = this.buildUrl();
    if (!url) return;

    try {
      this.source = new EventSource(url, { withCredentials: false });
    } catch {
      this.scheduleRetry();
      return;
    }

    this.source.addEventListener('open', () => {
      this.failureCount = 0;
      this.retryDelay = MIN_RETRY_MS;
    });

    this.source.addEventListener('jobs', (e: MessageEvent) => {
      this.onStreamMessage();
      this.parseAndEmit('jobs', e.data);
    });
    this.source.addEventListener('notifications', (e: MessageEvent) => {
      this.onStreamMessage();
      this.parseAndEmit('notifications', e.data);
    });
    this.source.addEventListener('message', () => {
      this.onStreamMessage();
    });

    this.source.onerror = () => {
      this.failureCount += 1;
      this.source?.close();
      this.source = null;
      if (this.failureCount >= POLL_FALLBACK_AFTER_FAILURES) {
        window.dispatchEvent(new CustomEvent(PLATFORM_SSE_DEGRADED_EVENT));
      }
      this.scheduleRetry();
    };
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
    if (this.retryTimer) return;
    if (this.handlers.size === 0) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(Math.round(this.retryDelay * 1.8), MAX_RETRY_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.ensureConnected();
    }, delay);
  }

  private teardownIfIdle() {
    if (this.handlers.size > 0) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    this.failureCount = 0;
    this.retryDelay = MIN_RETRY_MS;
  }

  /** Drop the SSE connection and open a new one if handlers exist and a token is present. */
  reconnect() {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.failureCount = 0;
    this.retryDelay = MIN_RETRY_MS;
    if (this.handlers.size > 0) {
      this.ensureConnected();
    }
  }
}

export const events = new EventHub();

/** Call after login so EventSource connects (first subscribe may have run before token existed). */
export function reconnectPlatformEvents() {
  events.reconnect();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      reconnectPlatformEvents();
    }
  });
}
