import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deployment = vi.hoisted(() => ({
  APP_BASE_PATH: '/card-together/', SERVER_URL: '', API_BASE_URL: '/card-together',
}));
vi.mock('../../../client/src/deployment', () => deployment);
vi.mock('../../../client/src/socket', () => ({ disconnectSocket: vi.fn() }));
vi.mock('../../../client/src/stores/player-store', () => ({
  usePlayerStore: { getState: (): object => ({ reset: vi.fn() }) },
}));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: { getState: (): object => ({ leaveRoom: vi.fn() }) },
}));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: { getState: (): object => ({ reset: vi.fn() }) },
}));
vi.mock('../../../client/src/stores/chat-store', () => ({
  useChatStore: { getState: (): object => ({ clearMessages: vi.fn() }) },
}));
vi.mock('../../../client/src/stores/emoji-store', () => ({
  useEmojiStore: { getState: (): object => ({ reset: vi.fn() }) },
}));

function response(status: number): Response {
  return {
    ok: status === 200,
    status,
    json: async (): Promise<object> => status === 200
      ? { success: true, account: { id: 'current-account', nickname: 'Player' } }
      : { success: false, error: 'Not authenticated.' },
  } as Response;
}

beforeEach(() => {
  vi.resetModules();
  deployment.APP_BASE_PATH = '/card-together/';
  deployment.SERVER_URL = '';
  vi.stubEnv('PROD', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('account session migration', () => {
  it('should preserve a current session without requesting legacy migration', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200));
    vi.stubGlobal('fetch', fetch);
    const { restoreAccount, useAccountStore } = await import('../../../client/src/stores/account-store');
    await restoreAccount();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useAccountStore.getState().account?.id).toBe('current-account');
  });

  it('should migrate once after an unauthorized current session and retry restoration', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200)).mockResolvedValueOnce(response(200));
    vi.stubGlobal('fetch', fetch);
    const { restoreAccount, useAccountStore } = await import('../../../client/src/stores/account-store');
    await Promise.all([restoreAccount(), restoreAccount()]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/card-together/api/auth/me', '/bridge_online/api/auth/migrate-session',
      '/card-together/api/auth/me',
    ]);
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(useAccountStore.getState().status).toBe('authenticated');
  });

  it('should remain anonymous and avoid repeated migration when no legacy session exists', async () => {
    const fetch = vi.fn().mockResolvedValue(response(401));
    vi.stubGlobal('fetch', fetch);
    const { restoreAccount, useAccountStore } = await import('../../../client/src/stores/account-store');
    await restoreAccount();
    await restoreAccount();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/card-together/api/auth/me', '/bridge_online/api/auth/migrate-session',
      '/card-together/api/auth/me',
    ]);
    expect(useAccountStore.getState().status).toBe('anonymous');
  });

  it.each(['development', 'root', 'custom-path', 'external-server'])(
    'should skip migration for %s deployment', async (variant) => {
      if (variant === 'development') vi.stubEnv('PROD', false);
      if (variant === 'root') deployment.APP_BASE_PATH = '/';
      if (variant === 'custom-path') deployment.APP_BASE_PATH = '/custom/';
      if (variant === 'external-server') deployment.SERVER_URL = 'https://api.example.com';
      const fetch = vi.fn().mockResolvedValue(response(401));
      vi.stubGlobal('fetch', fetch);
      const { restoreAccount } = await import('../../../client/src/stores/account-store');
      await restoreAccount();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('should skip migration for server errors', async () => {
    const fetch = vi.fn().mockResolvedValue(response(503));
    vi.stubGlobal('fetch', fetch);
    const { restoreAccount, useAccountStore } = await import('../../../client/src/stores/account-store');
    await restoreAccount();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useAccountStore.getState().status).toBe('error');
  });

  it('should discard migration completion after the account is cleared', async () => {
    let finish: (value: Response) => void = (): void => undefined;
    const migrating = new Promise<Response>((resolve) => { finish = resolve; });
    const fetch = vi.fn().mockResolvedValueOnce(response(401)).mockReturnValueOnce(migrating);
    vi.stubGlobal('fetch', fetch);
    const { restoreAccount, clearAccount, useAccountStore } =
      await import('../../../client/src/stores/account-store');
    const restoring = restoreAccount();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    clearAccount();
    finish(response(200));
    await restoring;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(useAccountStore.getState().account).toBeNull();
    expect(useAccountStore.getState().status).toBe('anonymous');
  });
});
