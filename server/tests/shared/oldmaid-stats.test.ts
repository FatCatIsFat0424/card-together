import { describe, expect, it } from 'vitest';
import { matchSeats, matchStanding } from '@shared/rules/match-standing';
import { matchFacts } from '@shared/stats';
import { STATS_RECORDS } from '@shared/stats/definitions';
import type { Card, OldMaidLogEntry, OldMaidMatchResult, ReplaySnapshot } from '@shared/types';

const zero = { N: 0, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
const c = (rank: Card['rank'], suit: Card['suit'] = 'hearts'): Card => ({ suit, rank });

/** N won deal 1, S deal 2, E deal 3; every seat ends on 3 points, so the match is a three-way tie. */
const tied: OldMaidMatchResult = {
  gameType: 'oldmaid', seats: ['N', 'E', 'S'], deals: 3,
  totals: { ...zero, N: 3, E: 3, S: 3 },
  dealOrders: [['N', 'S', 'E'], ['S', 'E', 'N'], ['E', 'N', 'S']],
  winners: ['N', 'E', 'S'],
};

/** E held the joker in every deal. */
const result: OldMaidMatchResult = {
  gameType: 'oldmaid', seats: ['N', 'E', 'S'], deals: 3,
  totals: { ...zero, N: 5, E: 0, S: 4 },
  dealOrders: [['N', 'S', 'E'], ['S', 'N', 'E'], ['N', 'S', 'E']],
  winners: ['N'],
};

const log: OldMaidLogEntry[] = [
  {
    type: 'deal', deal: 1, starter: 'N', counts: zero, finished: [], timestamp: 1,
    discards: { N: [c(5), c(5, 'clubs'), c(9), c(9, 'clubs')], E: [], S: [c(2), c(2, 'clubs')], W: [], P5: [], P6: [], P7: [], P8: [] },
  },
  { type: 'draw', seat: 'N', from: 'E', index: 0, discarded: [c(7), c(7, 'clubs')], finished: [], timestamp: 2 },
  { type: 'draw', seat: 'E', from: 'S', index: 1, discarded: [], finished: [], timestamp: 3 },
];
const frame = { gameType: 'oldmaid', log } as unknown as ReplaySnapshot;

describe('Old Maid standings and records', () => {
  it('should rank by total placement points', () => {
    expect(matchSeats(result)).toEqual(['N', 'E', 'S']);
    expect(['N', 'E', 'S'].map((seat) => matchStanding(result, seat as 'N')?.rank)).toEqual([1, 3, 2]);
    expect(matchStanding(result, 'N')).toMatchObject({ won: true, tied: false, players: 3, score: 5 });
    expect(matchStanding(result, 'E')).toMatchObject({ won: false, tied: false, score: 0 });
    expect(matchStanding(result, 'W')).toBeNull();
  });

  it('should let seats tied on points share first place and all count as winners', () => {
    for (const seat of ['N', 'E', 'S'] as const) {
      expect(matchStanding(tied, seat)).toMatchObject({ rank: 1, won: true, tied: true, score: 3 });
    }
  });

  it('should count joker losses, first-outs, joker-free matches and the final points from the result', () => {
    expect(matchFacts(result, 'N', null)).toEqual({ counts: { firstOuts: 2, clean: 1 }, sums: { jokerLosses: 0 }, values: { topPoints: 5 } });
    expect(matchFacts(result, 'E', null)).toEqual({ counts: {}, sums: { jokerLosses: 3 }, values: { topPoints: 0 } });
    expect(matchFacts(result, 'S', null)).toEqual({ counts: { firstOuts: 1, clean: 1 }, sums: { jokerLosses: 0 }, values: { topPoints: 4 } });
  });

  it('should read discarded pairs from the public log', () => {
    expect(matchFacts(result, 'N', frame).counts).toMatchObject({ pairsDiscarded: 3 });
    expect(matchFacts(result, 'S', frame).counts).toMatchObject({ pairsDiscarded: 1 });
    expect(matchFacts(result, 'E', frame).counts.pairsDiscarded).toBeUndefined();
  });

  it('should define only version 1 records of the right sources', () => {
    expect(STATS_RECORDS.oldmaid.map((record) => [record.id, record.source, record.kind, record.version])).toEqual([
      ['topPoints', 'result', 'max', 1], ['firstOuts', 'result', 'count', 1], ['clean', 'result', 'count', 1],
      ['pairsDiscarded', 'log', 'count', 1],
    ]);
  });
});
