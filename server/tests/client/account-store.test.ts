import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile } from '@shared/types';

vi.mock('../../../client/src/socket', () => ({ disconnectSocket: vi.fn() }));
vi.mock('../../../client/src/api', () => ({
  apiRequest: vi.fn(),
  invalidateAccountRequests: vi.fn(),
}));

import {
  clearAccount,
  selectConnectionReady,
  useAccountStore,
} from '../../../client/src/stores/account-store';
import { useInviteStore } from '../../../client/src/stores/invite-store';

function account(id: string): AccountProfile {
  return {
    id, username: id, nickname: id, avatar: 'cat', avatarImage: null, color: '#4a9eff',
    tableBackground: null, tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100, matchesPublic: true, createdAt: 1, updatedAt: 1,
  };
}

afterEach(() => {
  clearAccount();
});

describe('account store connection state', () => {
  it('should remember the first ready session until the account changes', () => {
    const store = useAccountStore.getState();
    store.setAccount(account('alice'));
    expect(useAccountStore.getState().hasConnected).toBe(false);
    expect(selectConnectionReady(useAccountStore.getState())).toBe(false);
    store.setConnection('ready');
    expect(selectConnectionReady(useAccountStore.getState())).toBe(true);
    store.setConnection('connecting');
    store.setConnection('error');
    expect(useAccountStore.getState().hasConnected).toBe(true);
    expect(selectConnectionReady(useAccountStore.getState())).toBe(false);
    store.setAccount(account('alice'));
    expect(useAccountStore.getState().hasConnected).toBe(true);
    store.setAccount(account('bob'));
    expect(useAccountStore.getState()).toMatchObject({ connection: 'connecting', hasConnected: false });
    store.setConnection('ready');
    clearAccount();
    expect(useAccountStore.getState()).toMatchObject({ connection: 'connecting', hasConnected: false });
  });

  it('should discard received invites when the signed-in account changes', () => {
    vi.useFakeTimers();
    try {
      useAccountStore.getState().setAccount(account('alice'));
      useInviteStore.getState().receive({
        roomCode: 'ABC123', gameType: 'bridge', seatsFree: 2,
        from: { id: 'carol', username: 'carol', nickname: 'Carol', avatar: 'cat', avatarImage: null, color: '#fff' },
      });
      useAccountStore.getState().setAccount(account('alice'));
      expect(useInviteStore.getState().invites).toHaveLength(1);
      useAccountStore.getState().setAccount(account('bob'));
      expect(useInviteStore.getState().invites).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
