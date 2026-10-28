import { describe, expect, it } from 'vitest';
import type { GameStatsRecord } from '../../src/database/game-stats';
import { napoleonRoleTotals } from '../../src/database/games/napoleon-stats';

type RoleCounters = Pick<GameStatsRecord, 'gameType' | 'scope' | 'counts'>;

describe('Napoleon role baselines', () => {
  it('sums every account by scope while excluding other games and unplayed roles', () => {
    const records: readonly RoleCounters[] = [
      { gameType: 'bridge', scope: 'all', counts: { 'role.defender': 100, 'won.defender': 90 } },
      { gameType: 'napoleon', scope: 'human', counts: { 'role.napoleon': 1, 'won.napoleon': 1 } },
      { gameType: 'napoleon', scope: 'all', counts: { 'role.napoleon': 3, 'won.napoleon': 2,
        'role.secretary': 2, 'won.secretary': 1 } },
      { gameType: 'napoleon', scope: 'all', counts: { 'role.napoleon': 2, 'won.napoleon': 0,
        'role.defender': 4, 'won.defender': 3 } },
      { gameType: 'napoleon', scope: 'human', counts: {} },
    ];
    const before = structuredClone(records);
    expect(napoleonRoleTotals(records)).toEqual({
      human: { napoleon: { played: 1, won: 1 } },
      all: { napoleon: { played: 5, won: 2 }, secretary: { played: 2, won: 1 }, defender: { played: 4, won: 3 } },
    });
    expect(records).toEqual(before);
  });

  it('accepts an iterable and leaves both scopes empty without Napoleon results', () => {
    expect(napoleonRoleTotals(new Set<RoleCounters>([
      { gameType: 'bridge', scope: 'human', counts: { 'role.defender': 1, 'won.defender': 1 } },
    ]))).toEqual({ human: {}, all: {} });
  });
});
