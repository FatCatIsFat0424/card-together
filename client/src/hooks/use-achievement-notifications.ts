import { useEffect } from 'react';
import { socket } from '../socket';
import { useAccountStore } from '../stores/account-store';
import { useAchievementNoticeStore } from '../stores/achievement-notice-store';

export function useAchievementNotifications(): void {
  const accountId = useAccountStore((state) => state.account?.id ?? null);
  const coinRevision = useAccountStore((state) => state.account?.coinRevision);
  const updatedAt = useAccountStore((state) => state.account?.updatedAt);

  useEffect(() => {
    useAchievementNoticeStore.getState().initialize(accountId);
    if (!accountId) return;
    const refresh = (): void => { void useAchievementNoticeStore.getState().refresh(); };
    const refreshVisible = (): void => { if (document.visibilityState === 'visible') refresh(); };
    socket.on('connect', refresh);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      socket.off('connect', refresh);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [accountId]);

  // Completed games, check-ins and claimed tasks all advance the account revision.
  useEffect(() => {
    if (accountId) void useAchievementNoticeStore.getState().refresh();
  }, [accountId, coinRevision, updatedAt]);
}
