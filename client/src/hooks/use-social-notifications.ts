import { useEffect } from 'react';
import { socket } from '../socket';
import { useAccountStore } from '../stores/account-store';
import { useSocialStore } from '../stores/social-store';

export function useSocialNotifications(): void {
  const accountId = useAccountStore((state) => state.account?.id);
  useEffect(() => {
    if (!accountId) { useSocialStore.getState().reset(); return; }
    useSocialStore.getState().initialize(accountId);
    const refresh = (): void => { void useSocialStore.getState().refresh(); };
    const refreshVisible = (): void => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    socket.on('connect', refresh);
    socket.on('social:changed', refresh);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    // Refresh retention while a long-lived tab remains open without social events.
    const interval = window.setInterval(refreshVisible, 60_000);
    return () => {
      socket.off('connect', refresh);
      socket.off('social:changed', refresh);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.clearInterval(interval);
    };
  }, [accountId]);
}
