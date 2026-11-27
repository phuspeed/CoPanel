/**
 * Shared JWT helpers for authenticated `/api/*` calls.
 * After the global API auth gate, every panel fetch must send Bearer token.
 */
export const SESSION_EXPIRED_EVENT = 'copanel-session-expired';

const PUBLIC_401_PATHS = new Set([
  '/api/auth/login',
  '/api/panel_settings/branding/public',
]);

function requestPath(input: RequestInfo | URL): string {
  try {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : String((input as Request).url || '');
    const url = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw)
      : new URL(raw, 'http://localhost');
    return url.pathname;
  } catch {
    return '';
  }
}

function isPublic401Path(path: string): boolean {
  if (!path) return false;
  for (const pub of PUBLIC_401_PATHS) {
    if (path === pub || path.startsWith(`${pub}/`)) return true;
  }
  return false;
}

/** Ask the shell to clear the session (JWT rejected). Idempotent for callers. */
export function notifySessionExpired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

export function getAuthToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('copanel_token');
}

export function getAuthHeaders(extra?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (extra) {
    const h = new Headers(extra);
    h.forEach((value, key) => {
      headers[key] = value;
    });
  }
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/** fetch() with Authorization attached when a session token exists. */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = getAuthHeaders(init.headers);
  return fetch(input, { ...init, headers }).then((res) => {
    if (res.status === 401 && !isPublic401Path(requestPath(input))) {
      notifySessionExpired();
    }
    return res;
  });
}

/**
 * Fetch a short-lived (~60s), single-use ticket for EventSource / WebSocket
 * query auth. Never put the long-lived JWT in a URL: URLs end up in access
 * logs, proxies and browser history. Call again before every (re)connect.
 * A 401 here means the session JWT is gone — stop retrying and sign out.
 */
export async function fetchStreamTicket(): Promise<string | null> {
  if (!getAuthToken()) return null;
  try {
    const res = await apiFetch('/api/auth/stream-ticket', { method: 'POST' });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.ticket === 'string' ? data.ticket : null;
  } catch {
    return null;
  }
}
