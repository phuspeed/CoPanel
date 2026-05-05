/**
 * EventSource-based subscription to the backend ``/api/platform/events``
 * stream. Re-emits ``jobs`` and ``notifications`` topics into a tiny pub/sub
 * so multiple UI surfaces (Task Center, Notification Center, Dashboard
 * widgets) can listen without each opening their own SSE connection.
 */
type Handler = (payload: any) => void;

class EventHub {
  private source: EventSource | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private retryDelay = 1500;
  private retryTimer: any = null;

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

  private ensureConnected() {
    if (this.source) return;
    const token = localStorage.getItem('copanel_token');
    if (!token) return;
    const url = `/api/platform/events?topics=jobs,notifications`;
    try {
      this.source = new EventSource(url, { withCredentials: false });
    } catch {
      this.scheduleRetry();
      return;
    }
    this.source.addEventListener('jobs', (e: MessageEvent) => this.parseAndEmit('jobs', e.data));
    this.source.addEventListener('notifications', (e: MessageEvent) => this.parseAndEmit('notifications', e.data));
    this.source.onerror = () => {
      this.source?.close();
      this.source = null;
      this.scheduleRetry();
    };
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
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.ensureConnected();
    }, this.retryDelay);
  }
}

export const events = new EventHub();
