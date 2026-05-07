/**
 * Notifications store - surfaces both transient toasts and the persisted
 * inbox. Toasts are added when an SSE ``new`` event arrives or any caller
 * invokes ``toast(...)``. Inbox state is fetched on demand.
 */
import { api } from './api';
import { events } from './events';
import { createStore, useStore } from './store';

export type Level = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  ts: number;
  level: Level;
  module?: string | null;
  title: string;
  body?: string | null;
  actor?: string | null;
  action_url?: string | null;
  read: number | boolean;
}

export interface Toast extends Notification {
  ephemeral?: boolean;
}

interface State {
  inbox: Notification[];
  unread: number;
  toasts: Toast[];
}

const store = createStore<State>({ inbox: [], unread: 0, toasts: [] });

const TOAST_TTL_MS = 6000;
let toastSeq = 1;

type Lang = 'en' | 'vi';

function getCurrentLang(): Lang {
  return (localStorage.getItem('copanel_lang') as Lang) === 'vi' ? 'vi' : 'en';
}

function pickLocalizedFromValue(value: any, lang: Lang): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    return value[lang] || value.en || value.vi || value.default;
  }
  return undefined;
}

function resolveLocalizedField(src: any, baseKey: string, lang: Lang): string | undefined {
  if (!src || typeof src !== 'object') return undefined;
  const direct = pickLocalizedFromValue(src[baseKey], lang);
  if (direct) return direct;
  const fromMap = pickLocalizedFromValue(src[`${baseKey}_i18n`], lang);
  if (fromMap) return fromMap;
  const fromLangSpecific = src[`${baseKey}_${lang}`];
  if (typeof fromLangSpecific === 'string' && fromLangSpecific) return fromLangSpecific;
  const fallbackEn = src[`${baseKey}_en`];
  if (typeof fallbackEn === 'string' && fallbackEn) return fallbackEn;
  const fallbackVi = src[`${baseKey}_vi`];
  if (typeof fallbackVi === 'string' && fallbackVi) return fallbackVi;
  return undefined;
}

function localizeNotification(raw: Notification | any): Notification {
  const lang = getCurrentLang();
  const payload = raw?.payload && typeof raw.payload === 'object' ? raw.payload : {};
  const title = resolveLocalizedField(raw, 'title', lang)
    || resolveLocalizedField(payload, 'title', lang)
    || (raw?.title || '');
  const body = resolveLocalizedField(raw, 'body', lang)
    || resolveLocalizedField(payload, 'body', lang)
    || raw?.body
    || null;
  return {
    ...raw,
    title,
    body,
  };
}

function pushToast(t: Toast) {
  store.setState((s) => ({ toasts: [t, ...s.toasts].slice(0, 6) }));
  if (t.ephemeral !== false) {
    setTimeout(() => {
      store.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }));
    }, TOAST_TTL_MS);
  }
}

events.on('notifications', (msg: any) => {
  if (msg?.event === 'new' && msg.notification) {
    const n: Notification = localizeNotification(msg.notification);
    pushToast({ ...n, ephemeral: true });
    store.setState((s) => ({
      inbox: [n, ...s.inbox].slice(0, 200),
      unread: s.unread + 1,
    }));
  }
});

export const notificationsApi = {
  async refresh() {
    const data = await api<{ items: Notification[]; unread: number }>(`/api/platform/notifications?limit=50`);
    store.setState({ inbox: (data.items || []).map(localizeNotification), unread: data.unread || 0 });
  },
  async markAllRead() {
    await api(`/api/platform/notifications/read-all`, { method: 'POST' });
    store.setState((s) => ({
      inbox: s.inbox.map((n) => ({ ...n, read: 1 })),
      unread: 0,
    }));
  },
  async markRead(ids: string[]) {
    if (!ids.length) return;
    await api(`/api/platform/notifications/read`, { method: 'POST', body: { ids } });
    store.setState((s) => ({
      inbox: s.inbox.map((n) => (ids.includes(n.id) ? { ...n, read: 1 } : n)),
      unread: Math.max(0, s.unread - ids.length),
    }));
  },
};

/** Show a transient toast immediately (without going through the backend). */
export function toast(title: string, opts: Partial<Notification> = {}) {
  const id = opts.id || `local-${toastSeq++}-${Date.now()}`;
  pushToast({
    id,
    ts: Date.now(),
    level: (opts.level as Level) || 'info',
    title,
    body: opts.body,
    module: opts.module,
    actor: opts.actor,
    action_url: opts.action_url,
    read: 1,
    ephemeral: true,
  });
}

export function useToasts(): Toast[] {
  return useStore(store, (s) => s.toasts);
}

export function useInbox(): { inbox: Notification[]; unread: number } {
  return useStore(store, (s) => ({ inbox: s.inbox, unread: s.unread }));
}

export function dismissToast(id: string) {
  store.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
