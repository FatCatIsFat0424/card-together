import type { PlayerStats, RoleTally, StatsScope } from '@shared/types';
import type { GameStatsRecord } from '../game-stats';

const NAPOLEON_ROLES = ['napoleon', 'secretary', 'defender'] as const;

/** Napoleon results of every account by role, per scope, from their stored counters. */
export function napoleonRoleTotals(
  records: Iterable<Pick<GameStatsRecord, 'gameType' | 'scope' | 'counts'>>,
): PlayerStats['napoleonRoles'] {
  const totals: Record<StatsScope, Partial<Record<typeof NAPOLEON_ROLES[number], RoleTally>>> = { human: {}, all: {} };
  for (const record of records) {
    if (record.gameType !== 'napoleon') continue;
    for (const role of NAPOLEON_ROLES) {
      const played = record.counts[`role.${role}`] ?? 0;
      if (played === 0) continue;
      const total = totals[record.scope][role] ?? { played: 0, won: 0 };
      totals[record.scope][role] = { played: total.played + played, won: total.won + (record.counts[`won.${role}`] ?? 0) };
    }
  }
  return totals;
}
