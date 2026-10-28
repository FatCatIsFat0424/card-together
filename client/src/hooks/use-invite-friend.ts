import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../socket';
import { useI18nStore } from '../stores/i18n-store';

const INVITED_MS = 15_000;

export interface InviteFriendState {
  /** Friends invited within the last 15 seconds. */
  readonly invited: ReadonlySet<string>;
  readonly error: string;
  readonly invite: (accountId: string) => void;
  readonly clearError: () => void;
}

/** Sends `room:invite` for the viewer's current room and remembers who was invited for a short while. */
export function useInviteFriend(): InviteFriendState {
  const { t } = useI18nStore();
  const [invited, setInvited] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState('');
  const timers = useRef(new Set<number>());

  useEffect(() => {
    const active = timers.current;
    return () => { active.forEach((timer) => window.clearTimeout(timer)); };
  }, []);

  const invite = useCallback((accountId: string): void => {
    setError('');
    socket.timeout(10000).emit('room:invite', { accountId }, (timeout, result) => {
      if (timeout || !result.success) {
        setError(timeout ? t('auth.connectionError') : result.error ?? t('common.error'));
        return;
      }
      setInvited((current) => new Set(current).add(accountId));
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        setInvited((current) => {
          const next = new Set(current);
          next.delete(accountId);
          return next;
        });
      }, INVITED_MS);
      timers.current.add(timer);
    });
  }, [t]);

  const clearError = useCallback((): void => setError(''), []);
  return { invited, error, invite, clearError };
}
