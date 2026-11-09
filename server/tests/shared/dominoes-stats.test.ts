import { describe, expect, it } from 'vitest';
import { matchSeats, matchStanding } from '@shared/rules/match-standing';
import { matchFacts } from '@shared/stats';
import { STATS_RECORDS } from '@shared/stats/definitions';
import type { DominoesMatchResult, ReplaySnapshot } from '@shared/types';

const empty = { N: 0, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
const noHands = { N: [], E: [], S: [], W: [], P5: [], P6: [], P7: [], P8: [] };

/** N won rounds 1 and 3, E round 2, and round 4 was a scoreless block; N and E tied at the top. */
const result: DominoesMatchResult = {
  gameType: 'dominoes', seats: ['N', 'E', 'S'], scores: { ...empty, N: 100, E: 100, S: 20 }, winners: ['N', 'E'],
  rounds: 4, targetScore: 100, roundWinners: ['N', 'E', 'N', null],
};

const end = (
  round: number, reason: 'domino' | 'blocked' | 'tie', winner: 'N' | 'E' | null, points: number,
): ReplaySnapshot['log'][number] => ({ type: 'roundEnd', round, reason, winner, points, hands: noHands,
  scores: { ...empty }, timestamp: round });

const frame = { gameType: 'dominoes', log: [
  end(1, 'domino', 'N', 31), end(2, 'blocked', 'E', 18), end(3, 'blocked', 'N', 44), end(4, 'tie', null, 0),
] } as unknown as ReplaySnapshot;

describe('Dominoes standings and records', () => {
  it('ranks the highest totals first and shares a tied win', () => {
    expect(matchSeats(result)).toEqual(['N', 'E', 'S']);
    expect(['N', 'E', 'S'].map((seat) => matchStanding(result, seat as 'N')?.rank)).toEqual([1, 1, 3]);
    expect(matchStanding(result, 'N')).toMatchObject({ won: true, tied: true, players: 3, score: 100 });
    expect(matchStanding(result, 'S')).toMatchObject({ won: false, tied: false, score: 20 });
    expect(matchStanding(result, 'W')).toBeNull();
  });

  it('counts rounds won from the result alone', () => {
    expect(matchFacts(result, 'N', null)).toMatchObject({ counts: { roundsWon: 2 } });
    expect(matchFacts(result, 'S', null).counts).toEqual({});
  });

  it('counts dominoes, blocked wins and the best round from the log', () => {
    expect(matchFacts(result, 'N', frame)).toMatchObject({
      counts: { roundsWon: 2, dominoes: 1, blockedWins: 1 }, values: { bestRound: 44 },
    });
    expect(matchFacts(result, 'E', frame)).toMatchObject({ counts: { roundsWon: 1, blockedWins: 1 }, values: { bestRound: 18 } });
  });

  it('defines the records the table shows', () => {
    expect(STATS_RECORDS.dominoes.map((record) => record.id)).toEqual(['roundsWon', 'dominoes', 'blockedWins', 'bestRound']);
  });
});
