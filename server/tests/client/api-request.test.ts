import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../client/src/deployment', () => ({
  APP_BASE_PATH: '/', SERVER_URL: '', API_BASE_URL: '',
}));

import { apiRequest, invalidateAccountRequests, requestTimeoutMs } from '../../../client/src/api';

beforeEach(() => { invalidateAccountRequests(); });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('api request boundaries', () => {
  it('includes credentials and only serializes bodies for mutations', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async (): Promise<object> => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetch);
    await apiRequest('/api/emojis');
    await apiRequest('/api/emojis', 'POST', { name: 'wave' });
    await apiRequest('/api/emojis', 'DELETE');
    expect(fetch.mock.calls.map(([path, options]) => ({ path, ...options }))).toEqual([
      { path: '/api/emojis', method: 'GET', credentials: 'include', headers: undefined,
        body: undefined, signal: expect.any(AbortSignal) },
      { path: '/api/emojis', method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: '{"name":"wave"}', signal: expect.any(AbortSignal) },
      { path: '/api/emojis', method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: '{}', signal: expect.any(AbortSignal) },
    ]);
  });

  it('expires only the current account and excludes authentication probes', async () => {
    const expired = vi.fn();
    const window = new EventTarget();
    window.addEventListener('account:expired', expired);
    vi.stubGlobal('window', window);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async (): Promise<object> => ({ success: false, error: 'Unauthorized' }),
    }));
    for (const path of ['/api/auth/login', '/api/auth/password', '/api/auth/me']) {
      expect(await apiRequest(path)).toEqual({ success: false, status: 401, error: 'Unauthorized' });
    }
    expect(expired).not.toHaveBeenCalled();
    await apiRequest('/api/emojis');
    expect(expired).toHaveBeenCalledOnce();
  });

  it('does not expire a replacement account after an old unauthorized response', async () => {
    const expired = vi.fn();
    const window = new EventTarget();
    window.addEventListener('account:expired', expired);
    vi.stubGlobal('window', window);
    let resolve!: (response: object) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<object>((done) => { resolve = done; })));
    const pending = apiRequest('/api/emojis');
    invalidateAccountRequests();
    resolve({ ok: false, status: 401, json: async (): Promise<object> => ({ error: 'Unauthorized' }) });
    expect(await pending).toEqual({ success: false, status: 401, error: 'Unauthorized' });
    expect(expired).not.toHaveBeenCalled();
  });

  it.each(['network', 'abort', 'json'] as const)('normalizes %s failures without throwing', async (failure) => {
    const fetch = vi.fn();
    if (failure === 'json') fetch.mockResolvedValue({ ok: true, status: 200, json: () => { throw new SyntaxError('Invalid JSON'); } });
    else fetch.mockRejectedValue(failure === 'abort' ? new DOMException('Timeout', 'TimeoutError') : new Error('Offline'));
    vi.stubGlobal('fetch', fetch);
    expect(await apiRequest('/api/emojis')).toEqual({
      success: false, status: 0, error: 'Unable to reach the server. Please try again.',
    });
  });

  it('retains server error messages and supplies the missing error fallback', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 409, json: async (): Promise<object> => ({ error: 'Not enough coins.' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async (): Promise<object> => ({ success: false }) }));
    expect(await apiRequest('/api/shop', 'POST')).toEqual({ success: false, status: 409, error: 'Not enough coins.' });
    expect(await apiRequest('/api/shop', 'POST')).toEqual({ success: false, status: 200, error: 'Request failed.' });
  });
});

describe('api request timeouts', () => {
  it('should allow media uploads longer than ordinary requests', async () => {
    expect(requestTimeoutMs('/api/media', 'POST')).toBeGreaterThan(requestTimeoutMs('/api/auth/me', 'GET'));
    expect(requestTimeoutMs('/api/media', 'GET')).toBe(requestTimeoutMs('/api/auth/me', 'GET'));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async (): Promise<object> => ({ success: true, id: 'image' }),
    }));
    await apiRequest('/api/media', 'POST', { data: 'AAAA', purpose: 'avatar' });
    await apiRequest('/api/auth/me');
    expect(timeout.mock.calls).toEqual([
      [requestTimeoutMs('/api/media', 'POST')],
      [requestTimeoutMs('/api/auth/me', 'GET')],
    ]);
  });
});
