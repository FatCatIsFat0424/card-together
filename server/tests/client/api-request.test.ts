import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../client/src/deployment', () => ({
  APP_BASE_PATH: '/', SERVER_URL: '', API_BASE_URL: '',
}));

import { apiRequest, requestTimeoutMs } from '../../../client/src/api';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
