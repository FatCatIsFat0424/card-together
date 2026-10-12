import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocialOverview } from '@shared/types/direct-message';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../../client/src/api', () => ({ apiRequest: request }));

import { socialUnreadCount, useSocialStore } from '../../../client/src/stores/social-store';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const ALICE = {
  id: 'alice', username: 'alice', nickname: 'Alice', color: '#123456', avatar: 'cat', avatarImage: null,
} as const;

function overview(unreadCount = 2, messageId = 'message-1'): SocialOverview & { success: true } {
  return {
    success: true, incoming: [], accepted: [], conversations: [{
      account: ALICE, canSend: true, unreadCount,
      lastMessage: { id: messageId, clientId: 'client-id', sender: ALICE, recipientId: 'bob',
        timestamp: Date.now(), content: 'Hello' },
    }],
  };
}

beforeEach(() => {
  request.mockReset();
  useSocialStore.getState().reset();
  useSocialStore.getState().initialize('bob');
});

describe('social overview state', () => {
  it('discards an earlier account response after switching accounts', async () => {
    const old = deferred<ReturnType<typeof overview>>();
    const next = deferred<ReturnType<typeof overview>>();
    request.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const first = useSocialStore.getState().refresh();
    useSocialStore.getState().initialize('carol');
    const second = useSocialStore.getState().refresh();
    old.resolve(overview(9, 'old-message'));
    await first;
    expect(useSocialStore.getState()).toMatchObject({ accountId: 'carol', status: 'loading', conversations: [] });
    next.resolve(overview(1, 'new-message'));
    await second;
    expect(useSocialStore.getState().conversations[0].lastMessage.id).toBe('new-message');
  });

  it('does not restore private data after logout, including the same account logging in again', async () => {
    const old = deferred<ReturnType<typeof overview>>();
    request.mockReturnValueOnce(old.promise);
    const first = useSocialStore.getState().refresh();
    useSocialStore.getState().reset();
    useSocialStore.getState().initialize('bob');
    old.resolve(overview());
    await first;
    expect(useSocialStore.getState()).toMatchObject({ status: 'idle', conversations: [], notices: [] });
  });

  it('keeps the newest refresh when responses arrive out of order', async () => {
    const first = deferred<ReturnType<typeof overview>>();
    const second = deferred<ReturnType<typeof overview>>();
    request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const older = useSocialStore.getState().refresh();
    const newer = useSocialStore.getState().refresh();
    second.resolve(overview(0, 'read-message'));
    await newer;
    first.resolve(overview(8, 'old-message'));
    await older;
    expect(socialUnreadCount(useSocialStore.getState())).toBe(0);
    expect(useSocialStore.getState().conversations[0].lastMessage.id).toBe('read-message');
  });

  it('refreshes unread state after marking a message read and surfaces newer incoming messages', async () => {
    request.mockResolvedValueOnce(overview()).mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce(overview(0)).mockResolvedValueOnce(overview(1, 'message-2'));
    await useSocialStore.getState().refresh();
    expect(useSocialStore.getState().notices).toEqual([]);
    expect(socialUnreadCount(useSocialStore.getState())).toBe(2);
    expect(await useSocialStore.getState().markRead('alice', 'message-1')).toBe(true);
    expect(request).toHaveBeenNthCalledWith(2, '/api/messages/alice/read', 'POST', { messageId: 'message-1' });
    expect(socialUnreadCount(useSocialStore.getState())).toBe(0);
    await useSocialStore.getState().refresh();
    expect(socialUnreadCount(useSocialStore.getState())).toBe(1);
    expect(useSocialStore.getState().notices).toMatchObject([{ kind: 'message', accountId: 'alice' }]);
    request.mockResolvedValueOnce(overview(1, 'message-2'));
    await useSocialStore.getState().refresh();
    expect(useSocialStore.getState().notices).toHaveLength(1);
  });

  it('does not refresh a new account after an old read mutation resolves', async () => {
    const pending = deferred<{ success: true }>();
    request.mockReturnValueOnce(pending.promise);
    const reading = useSocialStore.getState().markRead('alice', 'message-1');
    useSocialStore.getState().initialize('carol');
    pending.resolve({ success: true });
    expect(await reading).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    expect(useSocialStore.getState()).toMatchObject({ accountId: 'carol', conversations: [] });
  });

  it('retains unread data during an outage and permits retry', async () => {
    request.mockResolvedValueOnce(overview()).mockResolvedValueOnce({ success: false, status: 0, error: 'Offline' })
      .mockResolvedValueOnce(overview(0));
    await useSocialStore.getState().refresh();
    await useSocialStore.getState().refresh();
    expect(useSocialStore.getState()).toMatchObject({ status: 'error', error: 'Offline' });
    expect(socialUnreadCount(useSocialStore.getState())).toBe(2);
    await useSocialStore.getState().refresh();
    expect(useSocialStore.getState()).toMatchObject({ status: 'ready', error: '' });
    expect(socialUnreadCount(useSocialStore.getState())).toBe(0);
  });

  it('counts requests, accepted notices and individual unread messages together', () => {
    expect(socialUnreadCount({
      ...overview(3),
      incoming: [{ id: 'request-1', requester: ALICE, recipient: { ...ALICE, id: 'bob' }, createdAt: 1 }],
      accepted: [{ id: 'accepted-1', account: ALICE, createdAt: 1 }],
    })).toBe(5);
  });

  it('dismisses accepted notices through persistence and reloads the overview', async () => {
    request.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce(overview(0));
    expect(await useSocialStore.getState().dismissAccepted(['accepted-1'])).toBe(true);
    expect(request).toHaveBeenNthCalledWith(1, '/api/messages/notifications/read', 'POST', { ids: ['accepted-1'] });
    expect(request).toHaveBeenNthCalledWith(2, '/api/messages');
  });
});
