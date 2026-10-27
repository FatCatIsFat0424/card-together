import { useCallback, useEffect, useState } from 'react';
import type { FriendsData } from '@shared/types';
import { apiRequest } from '../api';

export interface FriendsDataState {
  readonly data: FriendsData | null;
  readonly error: string;
  readonly loading: boolean;
  /** Reloads now and clears the previous error. */
  readonly reload: () => void;
}

const POLL_MS = 30000;

/**
 * The friends list, refreshed on window focus and every 30 seconds while the tab is visible.
 * `refreshToken` forces a reload when it changes; a disabled hook neither fetches nor polls.
 */
export function useFriendsData(enabled = true, refreshToken = 0): FriendsDataState {
  const [data, setData] = useState<FriendsData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let requestVersion = 0;
    const refresh = async (): Promise<void> => {
      const version = ++requestVersion;
      const result = await apiRequest<FriendsData>('/api/friends');
      if (!active || version !== requestVersion) return;
      setLoading(false);
      if (result.success) { setData(result); setError(''); }
      else { setData(null); setError(result.error); }
    };
    const onFocus = (): void => { void refresh(); };
    void refresh();
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [enabled, revision, refreshToken]);

  const reload = useCallback((): void => {
    setLoading(true);
    setError('');
    setRevision((value) => value + 1);
  }, []);

  return { data, error, loading, reload };
}
