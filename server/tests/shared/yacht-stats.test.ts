import { describe, expect, it } from 'vitest';
import { matchSeats, matchStanding } from '@shared/rules/match-standing';
import { matchFacts } from '@shared/stats';
import { STATS_RECORDS } from '@shared/stats/definitions';
import type { YachtMatchResult } from '@shared/games/yacht/types';

/** N and E tie on top; S finished behind with a Yacht but no bonus. */
const result: YachtMatchResult = {
  gameType: 'yacht', seats: ['N', 'E', 'S'], mode: 'turns', winners: ['N', 'E'],
  totals: { N: 231, E: 231, S: 187 }, upperBonus: { N: true, E: false, S: false }, yachts: { N: 2, E: 0, S: 1 },
};

describe('Yacht Dice standings and records', () => {
  it('shares first place between tied totals and ranks the rest behind them', () => {
    expect(matchSeats(result)).toEqual(['N', 'E', 'S']);
    expect(matchStanding(result, 'N')).toMatchObject({ rank: 1, tied: true, won: true, players: 3, score: 231 });
    expect(matchStanding(result, 'E')).toMatchObject({ rank: 1, tied: true, won: true, score: 231 });
    expect(matchStanding(result, 'S')).toMatchObject({ rank: 3, tied: false, won: false, score: 187 });
    expect(matchStanding(result, 'W')).toBeNull();
  });

  it('counts Yachts and upper bonuses and keeps the best total from the result alone', () => {
    expect(matchFacts(result, 'N', null)).toEqual({ counts: { yachts: 2, upperBonuses: 1 }, sums: {}, values: { topScore: 231 } });
    expect(matchFacts(result, 'E', null)).toEqual({ counts: {}, sums: {}, values: { topScore: 231 } });
    expect(matchFacts(result, 'S', null)).toEqual({ counts: { yachts: 1 }, sums: {}, values: { topScore: 187 } });
  });

  it('defines only version 1 records read from the result', () => {
    expect(STATS_RECORDS.yacht.map((record) => [record.id, record.source, record.kind, record.version])).toEqual([
      ['topScore', 'result', 'max', 1], ['yachts', 'result', 'count', 1], ['upperBonuses', 'result', 'count', 1],
    ]);
  });
});
