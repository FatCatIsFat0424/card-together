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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('account session restoration', () => {
  it('should restore a current session with a single request', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200));
    vi.stubGlobal('fetch', fetch);
    const { restoreAccount, useAccountStore } = await import('../../../client/src/stores/account-store');
    await Promise.all([restoreAccount(), restoreAccount()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/card-together/api/auth/me');
    expect(useAccountStore.getState().account?.id).toBe('current-account');
    expect(useAccountStore.getState().status).toBe('authenticated');
  });

  it('should remain anonymous when the session is unauthorized', async () => {
    const fetch = vi.fn().mockResolvedValue(response(401));
    vi.stubGlobal('fetch', fetch);
    const { restoreAccount, useAccountStore } = await import('../../../client/src/stores/account-store');
    await restoreAccount();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useAccountStore.getState().status).toBe('anonymous');
  });

  it('should report server errors without clearing the session', async () => {
    const fetch = vi.fn().mockResolvedValue(response(503));
    vi.stubGlobal('fetch', fetch);
    const { restoreAccount, useAccountStore } = await import('../../../client/src/stores/account-store');
    await restoreAccount();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useAccountStore.getState().status).toBe('error');
  });

  it('should discard a restoration that completes after the account is cleared', async () => {
    let finish: (value: Response) => void = (): void => undefined;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const fetch = vi.fn().mockReturnValueOnce(pending);
    vi.stubGlobal('fetch', fetch);
    const { restoreAccount, clearAccount, useAccountStore } =
      await import('../../../client/src/stores/account-store');
    const restoring = restoreAccount();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    clearAccount();
    finish(response(200));
    await restoring;
    expect(useAccountStore.getState().account).toBeNull();
    expect(useAccountStore.getState().status).toBe('anonymous');
  });
});
