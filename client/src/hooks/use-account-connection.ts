import { useEffect } from 'react';
import type { AccountProfile } from '@shared/types';
import { socket } from '../socket';
import { clearAccount, restoreAccount, useAccountStore } from '../stores/account-store';
import { applyChatMessage, applyPlayerSnapshot } from '../stores/player-snapshot';
import { startAccountConnection } from './account-connection-controller';

export function useAccountConnection(): void {
  const accountId = useAccountStore((state) => state.account?.id);

  useEffect(() => {
    void restoreAccount();
    const handleFocus = (): void => { void restoreAccount(); };
    window.addEventListener('account:expired', clearAccount);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('account:expired', clearAccount);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    if (!accountId) return;
    const updateCoins = ({ coins, coinRevision }: { coins: number; coinRevision?: number }): void =>
      useAccountStore.getState().setCoins(accountId, coins, coinRevision);
    const updateAccount = (account: AccountProfile): void => {
      if (useAccountStore.getState().account?.id === account.id) useAccountStore.getState().setAccount(account);
    };
    socket.on('account:coins', updateCoins);
    socket.on('account:updated', updateAccount);
    socket.on('player:state', applyPlayerSnapshot);
    socket.on('chat:message', applyChatMessage);
    const stop = startAccountConnection({
      socket,
      network: window,
      page: document,
      setConnection: (connection) => useAccountStore.getState().setConnection(connection),
      applySnapshot: applyPlayerSnapshot,
      restoreAccount: () => { void restoreAccount(); },
    });
    return () => {
      socket.off('account:coins', updateCoins);
      socket.off('account:updated', updateAccount);
      socket.off('player:state', applyPlayerSnapshot);
      socket.off('chat:message', applyChatMessage);
      stop();
    };
  }, [accountId]);
}
