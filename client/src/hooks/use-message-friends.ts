import { useEffect, useState } from 'react';
import type { FriendEntry, FriendsData } from '@shared/types/social';
import { apiRequest } from '../api';
import { socket } from '../socket';
import { useAccountStore } from '../stores/account-store';

export interface MessageFriends {
  /** Null until the first successful load for the current account. */
  readonly friends: readonly FriendEntry[] | null;
  readonly error: string;
}

/**
 * Current friends for the message list, reloaded on friendship changes, reconnects, and
 * refocus like the friends page. Reading a conversation does not change friendships, so
 * it does not reload.
 */
export function useMessageFriends(accountId: string | undefined): MessageFriends {
  const [state, setState] = useState<MessageFriends & { readonly accountId: string | undefined }>(
    { accountId, friends: null, error: '' });

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    const load = (): void => {
      void apiRequest<FriendsData>('/api/friends').then((result) => {
        if (!active || useAccountStore.getState().account?.id !== accountId) return;
        setState((previous) => {
          const friends = previous.accountId === accountId ? previous.friends : null;
          return result.success ? { accountId, friends: result.friends, error: '' }
            : { accountId, friends, error: result.error };
        });
      });
    };
    const loadVisible = (): void => { if (document.visibilityState === 'visible') load(); };
    load();
    socket.on('connect', load);
    socket.on('social:changed', load);
    window.addEventListener('focus', loadVisible);
    const interval = window.setInterval(loadVisible, 60_000);
    return () => {
      active = false;
      socket.off('connect', load);
      socket.off('social:changed', load);
      window.removeEventListener('focus', loadVisible);
      window.clearInterval(interval);
    };
  }, [accountId]);

  return state.accountId === accountId ? state : { friends: null, error: '' };
}
