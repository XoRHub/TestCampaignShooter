// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL, ApiError, api, formatDate, formatDuration } from './api';

describe('api()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends credentials and a JSON content-type header, and parses the JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await api<{ ok: boolean }>('/api/campaigns');

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/campaigns`,
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('returns undefined for an empty response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api('/api/campaigns/x')).resolves.toBeUndefined();
  });

  it('throws an ApiError with the server message on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'not found' }), { status: 404 }),
      ),
    );
    const error = await api('/api/campaigns/missing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).message).toBe('not found');
  });

  it('falls back to a generic HTTP message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 500 })));
    const error = await api('/api/campaigns').catch((e: unknown) => e);
    expect((error as ApiError).message).toBe('HTTP 500');
  });

  describe('401 handling', () => {
    let originalLocation: Location;

    beforeEach(() => {
      originalLocation = window.location;
      // jsdom throws "Not implemented: navigation" on a real assignment;
      // replace `window.location` with a plain assignable stand-in.
      Reflect.deleteProperty(window, 'location');
      (window as unknown as { location: { href: string } }).location = { href: '' };
    });

    afterEach(() => {
      (window as unknown as { location: Location }).location = originalLocation;
    });

    it('redirects to /login on a 401 for a non-auth endpoint', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
      await api('/api/campaigns').catch(() => undefined);
      expect(window.location.href).toBe('/login');
    });

    it('does not redirect for the auth endpoints themselves (avoids a login loop)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
      await api('/api/auth/me').catch(() => undefined);
      expect(window.location.href).toBe('');
    });
  });
});

describe('formatDate', () => {
  it('returns an em-dash for a missing value', () => {
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('formats a date-ish value as a non-empty locale string', () => {
    expect(formatDate('2026-01-15T10:00:00Z')).not.toBe('—');
    expect(formatDate(new Date('2026-01-15T10:00:00Z'))).not.toBe('—');
  });
});

describe('formatDuration', () => {
  it('formats sub-second durations in milliseconds', () => {
    expect(formatDuration(250)).toBe('250ms');
  });

  it('formats durations under 90s in seconds with one decimal', () => {
    expect(formatDuration(4200)).toBe('4.2s');
  });

  it('formats longer durations as minutes and seconds', () => {
    expect(formatDuration(125_000)).toBe('2m5s');
  });
});
