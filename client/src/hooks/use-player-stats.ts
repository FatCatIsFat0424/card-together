import { useEffect, useState } from 'react';
import type { PlayerStats } from '@shared/types';
import { apiRequest } from '../api';

/** Loading, the counters, a hidden history, or the request's error message. */
export type PlayerStatsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly stats: PlayerStats }
  | { readonly status: 'private' }
  | { readonly status: 'error'; readonly error: string };

/**
 * The server's accumulated statistics of a player; `version` refetches them, for example after the
 * history reloaded. A null account ID skips the request.
 */
export function usePlayerStats(accountId: string | null, version = 0): PlayerStatsState {
  const [state, setState] = useState<PlayerStatsState>({ status: 'loading' });
  useEffect(() => {
    if (!accountId) return undefined;
    let active = true;
    void apiRequest<{ stats: PlayerStats }>(`/api/players/${encodeURIComponent(accountId)}/stats`).then((result) => {
      if (!active) return;
      if (result.success) setState({ status: 'ready', stats: result.stats });
      else setState(result.status === 403 ? { status: 'private' } : { status: 'error', error: result.error });
    });
    return () => { active = false; };
  }, [accountId, version]);
  return state;
}
