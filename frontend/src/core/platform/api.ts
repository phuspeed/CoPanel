/**
 * Tiny fetch helper that adds the JWT token from localStorage and parses
 * CoPanel's standard envelope:
 *
 *   { status: "success", data?, message? }       -> resolves with data ?? body
 *   { status: "error",   error: { code, message } } -> rejects with PlatformError
 *
 * Legacy endpoints that don't yet use the envelope are passed through
 * untouched so the UI keeps working during migration.
 */

export class PlatformError extends Error {
  code: string;
  status: number;
  details?: any;
  constructor(code: string, message: string, status: number, details?: any) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: any;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  raw?: boolean;
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('copanel_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const init: RequestInit = {
    method: opts.method || 'GET',
    headers,
    signal: opts.signal,
  };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }

  const res = await fetch(path, init);
  let body: any = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (opts.raw) {
    return body as T;
  }

  if (!res.ok) {
    const err = body && typeof body === 'object' && body.error
      ? body.error
      : { code: `HTTP_${res.status}`, message: typeof body === 'string' ? body : (body?.detail || res.statusText) };
    throw new PlatformError(err.code || `HTTP_${res.status}`, err.message || 'Request failed', res.status, err.details);
  }

  if (body && typeof body === 'object' && 'status' in body) {
    if (body.status === 'success') {
      return (body.data !== undefined ? body.data : body) as T;
    }
    if (body.status === 'error' && body.error) {
      throw new PlatformError(body.error.code, body.error.message, res.status, body.error.details);
    }
  }
  return body as T;
}
