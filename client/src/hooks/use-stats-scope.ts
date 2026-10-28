import { useCallback, useState } from 'react';
import { readStatsScope, writeStatsScope } from '../match-statistics';
import type { StatsScope } from '../match-statistics';

/** The statistics scope, remembered in this browser. */
export function useStatsScope(): readonly [StatsScope, (scope: StatsScope) => void] {
  const [scope, setScope] = useState<StatsScope>(readStatsScope);
  const update = useCallback((value: StatsScope): void => {
    setScope(value);
    writeStatsScope(value);
  }, []);
  return [scope, update];
}
