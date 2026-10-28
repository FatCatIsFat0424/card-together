import { describe, expect, it } from 'vitest';
import { matchSeats, matchStanding } from '@shared/rules/match-standing';
import { matchFacts } from '@shared/stats';
import { STATS_RECORDS } from '@shared/stats/definitions';
import type { LiarsDiceLogEntry, LiarsDiceMatchResult, ReplaySnapshot } from '@shared/types';

const empty = { N: 0, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };

/** E went out first, then N; S won with three dice left. */
const result: LiarsDiceMatchResult = {
  gameType: 'liarsdice', seats: ['N', 'E', 'S'], winnerSeat: 'S', eliminationOrder: ['E', 'N'],
  dice: { ...empty, S: 3 }, rounds: 12,
};

const dice = { N: [], E: [], S: [], W: [], P5: [], P6: [], P7: [], P8: [] };
const call = (
  seat: 'N' | 'E' | 'S', target: 'N' | 'E' | 'S', quantity: number, count: number,
): Extract<LiarsDiceLogEntry, { type: 'challenge' }> => ({
  type: 'challenge', seat, target, quantity, face: 4, wild: true, dice, count, bidTrue: count >= quantity,
  loser: count >= quantity ? seat : target, eliminated: false, timestamp: 1,
});

const frame = { gameType: 'liarsdice', log: [
  { type: 'round', round: 1, starter: 'N', counts: { ...empty, N: 5, E: 5, S: 5 }, timestamp: 1 },
  call('N', 'E', 4, 2),
  call('E', 'S', 3, 3),
  call('S', 'N', 2, 2),
  call('S', 'E', 5, 5),
] } as unknown as ReplaySnapshot;

describe("Liar's Dice standings and records", () => {
  it('should rank the winner first and later eliminations higher', () => {
    expect(matchSeats(result)).toEqual(['N', 'E', 'S']);
    expect(['N', 'E', 'S'].map((seat) => matchStanding(result, seat as 'N')?.rank)).toEqual([2, 3, 1]);
    expect(matchStanding(result, 'S')).toMatchObject({ won: true, tied: false, players: 3, score: null });
    expect(matchStanding(result, 'N')).toMatchObject({ won: false });
    expect(matchStanding(result, 'W')).toBeNull();
  });

  it('should count dice lost and the most dice kept in a win from the result alone', () => {
    expect(matchFacts(result, 'S', null)).toEqual({ counts: {}, sums: { diceLost: 2 }, values: { diceInWin: 3 } });
    expect(matchFacts(result, 'N', null)).toEqual({ counts: {}, sums: { diceLost: 5 }, values: {} });
  });

  it('should read successful calls, bids that held, and exact bids from the public log', () => {
    expect(matchFacts(result, 'N', frame).counts).toEqual({ callsWon: 1, bidsHeld: 1, exactBids: 1 });
    expect(matchFacts(result, 'E', frame).counts).toEqual({ bidsHeld: 1, exactBids: 1 });
    expect(matchFacts(result, 'S', frame).counts).toEqual({ bidsHeld: 1, exactBids: 1 });
  });

  it('should define only version 1 records of the right sources', () => {
    expect(STATS_RECORDS.liarsdice.map((record) => [record.id, record.source, record.kind, record.version])).toEqual([
      ['callsWon', 'log', 'count', 1], ['bidsHeld', 'log', 'count', 1], ['exactBids', 'log', 'count', 1],
      ['diceInWin', 'result', 'max', 1],
    ]);
  });
});
