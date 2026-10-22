export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fetch wrapper: cookie credentials, JSON handling, redirect to /login on 401. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (response.status === 401 && typeof window !== 'undefined' && !path.startsWith('/api/auth')) {
    window.location.href = '/login';
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, body.error ?? `HTTP ${response.status}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Opens an authenticated SSE stream on the API. */
export function openEvents(path: string): EventSource {
  return new EventSource(`${API_URL}${path}`, { withCredentials: true });
}

export function formatDate(value: string | Date | undefined | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 90) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m${Math.round(seconds % 60)}s`;
}
