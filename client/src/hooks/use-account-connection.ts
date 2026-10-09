import { useEffect } from 'react';
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
      socket.off('player:state', applyPlayerSnapshot);
      socket.off('chat:message', applyChatMessage);
      stop();
    };
  }, [accountId]);
}
