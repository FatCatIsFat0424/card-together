import { describe, expect, it } from 'vitest';
import { matchStanding } from '@shared/rules/match-standing';
import { gameFacts } from '@shared/stats/registry';
import { STATS_RECORDS } from '@shared/stats/definitions';
import type { GomokuMatchResult } from '@shared/types';

function result(overrides: Partial<GomokuMatchResult> = {}): GomokuMatchResult {
  return {
    gameType: 'gomoku', seats: ['N', 'S'], blackSeat: 'N', moves: 41, winners: ['N'], reason: 'five-in-row',
    options: { renju: false, swap: false }, ...overrides,
  };
}

describe('Gomoku statistics', () => {
  it('declares its special records at version 1', () => {
    expect(STATS_RECORDS.gomoku.map((record) => [record.id, record.source, record.kind, record.version])).toEqual([
      ['fiveWins', 'result', 'count', 1], ['shortestWin', 'result', 'min', 1], ['longestGame', 'result', 'max', 1],
      ['renjuWins', 'result', 'count', 1],
    ]);
  });

  it('records the game length for both seats and a win by five for the winner only', () => {
    expect(gameFacts('gomoku', result(), 'N', null)).toMatchObject({
      counts: { fiveWins: 1 }, values: { longestGame: 41, shortestWin: 21 },
    });
    const loser = gameFacts('gomoku', result(), 'S', null);
    expect(loser.counts).toEqual({});
    expect(loser.values).toEqual({ longestGame: 41 });
  });

  it('counts the winner own stones: black lays the odd ones and white the even', () => {
    expect(gameFacts('gomoku', result({ moves: 10, winners: ['S'] }), 'S', null).values).toMatchObject({ shortestWin: 5 });
    expect(gameFacts('gomoku', result({ moves: 9 }), 'N', null).values).toMatchObject({ shortestWin: 5 });
    // After a swap the second seat holds black.
    expect(gameFacts('gomoku', result({ blackSeat: 'S', moves: 9, winners: ['S'] }), 'S', null).values)
      .toMatchObject({ shortestWin: 5 });
  });

  it('gives nothing for fives when the match ended by resignation or draw, and counts Renju wins', () => {
    expect(gameFacts('gomoku', result({ reason: 'resign' }), 'N', null).counts).toEqual({});
    expect(gameFacts('gomoku', result({ reason: 'board-full', winners: [], moves: 225 }), 'N', null))
      .toMatchObject({ counts: {}, values: { longestGame: 225 } });
    expect(gameFacts('gomoku', result({ options: { renju: true, swap: false } }), 'N', null).counts)
      .toEqual({ fiveWins: 1, renjuWins: 1 });
  });

  it('ranks a win first, a loss second, and a draw first for both with a tie', () => {
    expect(matchStanding(result(), 'N')).toMatchObject({ rank: 1, won: true, tied: false, players: 2 });
    expect(matchStanding(result(), 'S')).toMatchObject({ rank: 2, won: false, tied: false });
    const draw = result({ reason: 'agreed-draw', winners: [] });
    expect(matchStanding(draw, 'N')).toMatchObject({ rank: 1, won: true, tied: true });
    expect(matchStanding(draw, 'S')).toMatchObject({ rank: 1, won: true, tied: true });
    expect(matchStanding(draw, 'E')).toBeNull();
  });
});
