import { create } from 'zustand';
import type { AccountProfile } from '@shared/types';
import { apiRequest, invalidateAccountRequests } from '../api';
import { disconnectSocket } from '../socket';
import { usePlayerStore } from './player-store';
import { useRoomStore } from './room-store';
import { useGameStore } from './game-store';
import { useChatStore } from './chat-store';
import { useEmojiStore } from './emoji-store';
import { useInviteStore } from './invite-store';
import { retainSnapshotValue } from './snapshot-equality';

interface AccountStore {
  account: AccountProfile | null;
  status: 'loading' | 'authenticated' | 'anonymous' | 'error';
  error: string;
  connection: 'connecting' | 'ready' | 'error';
  /** True once this account's socket session has been ready; later drops keep pages mounted. */
  hasConnected: boolean;
  setAccount: (account: AccountProfile) => void;
  setConnection: (connection: AccountStore['connection']) => void;
}

let accountGeneration = 0;

function clearGameSession(): void {
  disconnectSocket();
  usePlayerStore.getState().reset();
  useRoomStore.getState().leaveRoom();
  useGameStore.getState().reset();
  useChatStore.getState().clearMessages();
  useEmojiStore.getState().reset();
  useInviteStore.getState().reset();
}

/** Game and room actions require a live, resumed socket session. */
export function selectConnectionReady(state: Pick<AccountStore, 'connection'>): boolean {
  return state.connection === 'ready';
}

export const useAccountStore = create<AccountStore>((set, get) => ({
  account: null,
  status: 'loading',
  error: '',
  connection: 'connecting',
  hasConnected: false,
  setAccount: (account) => {
    if (get().account?.id !== account.id) {
      accountGeneration += 1;
      invalidateAccountRequests();
      clearGameSession();
      set({ connection: 'connecting', hasConnected: false });
    }
    set((state) => {
      const nextAccount = retainSnapshotValue(state.account, account);
      return nextAccount === state.account && state.status === 'authenticated' && !state.error
        ? state : { account: nextAccount, status: 'authenticated', error: '' };
    });
  },
  setConnection: (connection) => set((state) => state.connection === connection
    ? state : { connection, hasConnected: state.hasConnected || connection === 'ready' }),
}));

export function clearAccount(): void {
  accountGeneration += 1;
  invalidateAccountRequests();
  useAccountStore.setState({
    account: null, status: 'anonymous', connection: 'connecting', hasConnected: false, error: '',
  });
  clearGameSession();
}

let sessionRequest: Promise<void> | null = null;

export function restoreAccount(): Promise<void> {
  if (sessionRequest) return sessionRequest;
  const requestGeneration = accountGeneration;
  sessionRequest = (async (): Promise<void> => {
    const result = await apiRequest<{ account: AccountProfile }>('/api/auth/me');
    if (requestGeneration !== accountGeneration) return;
    if (result.success) {
      useAccountStore.getState().setAccount(result.account);
    } else if (result.status === 401) {
      clearAccount();
    } else if (!useAccountStore.getState().account) {
      useAccountStore.setState({ status: 'error', error: result.error });
    }
  })().finally(() => { sessionRequest = null; });
  return sessionRequest;
}
