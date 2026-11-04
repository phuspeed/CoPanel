/**
 * Shared JWT helpers for authenticated `/api/*` calls.
 * After the global API auth gate, every panel fetch must send Bearer token.
 */
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
  return fetch(input, { ...init, headers });
}

/**
 * Fetch a short-lived (~60s), single-use ticket for EventSource / WebSocket
 * query auth. Never put the long-lived JWT in a URL: URLs end up in access
 * logs, proxies and browser history. Call again before every (re)connect.
 */
export async function fetchStreamTicket(): Promise<string | null> {
  if (!getAuthToken()) return null;
  try {
    const res = await apiFetch('/api/auth/stream-ticket', { method: 'POST' });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.ticket === 'string' ? data.ticket : null;
  } catch {
    return null;
  }
}
