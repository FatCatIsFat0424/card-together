import { describe, expect, it } from 'vitest';
import { matchStanding } from '@shared/rules/match-standing';
import { gameFacts } from '@shared/stats/registry';
import { STATS_RECORDS } from '@shared/stats/definitions';
import type { GoMatchResult } from '@shared/types';

function result(overrides: Partial<GoMatchResult> = {}): GoMatchResult {
  return {
    gameType: 'go', seats: ['N', 'S'], options: { size: 9, handicap: 0 }, moves: 80, captured: { N: 6, S: 2 }, dead: [],
    area: { N: 48, S: 33 }, komi: 7.5, margin: 7.5, winners: ['N'], reason: 'score', ...overrides,
  };
}

describe('Go statistics', () => {
  it('declares its special records at version 1', () => {
    expect(STATS_RECORDS.go.map((record) => [record.id, record.source, record.kind, record.version])).toEqual([
      ['bigMargin', 'result', 'max', 1], ['handicapWins', 'result', 'count', 1], ['resignWins', 'result', 'count', 1],
      ['mostCaptured', 'result', 'max', 1],
    ]);
  });

  it('records the stones each seat captured and the margin of a win on points', () => {
    expect(gameFacts('go', result(), 'N', null)).toMatchObject({ counts: {}, values: { mostCaptured: 6, bigMargin: 7 } });
    const loser = gameFacts('go', result(), 'S', null);
    expect(loser.counts).toEqual({});
    expect(loser.values).toEqual({ mostCaptured: 2 });
  });

  it('counts a win by resignation without a margin', () => {
    const resigned = result({ reason: 'resign', area: {}, margin: 0 });
    expect(gameFacts('go', resigned, 'N', null)).toMatchObject({ counts: { resignWins: 1 }, values: { mostCaptured: 6 } });
    expect(gameFacts('go', resigned, 'N', null).values).not.toHaveProperty('bigMargin');
    expect(gameFacts('go', resigned, 'S', null).counts).toEqual({});
  });

  it('counts handicap wins for black only, the seat that took the stones', () => {
    const handicap = result({ options: { size: 9, handicap: 3 }, komi: 0.5, margin: 2.5 });
    expect(gameFacts('go', handicap, 'N', null).counts).toEqual({ handicapWins: 1 });
    const whiteWins = result({ options: { size: 9, handicap: 3 }, winners: ['S'] });
    expect(gameFacts('go', whiteWins, 'S', null).counts).toEqual({});
    expect(gameFacts('go', result(), 'N', null).counts).toEqual({});
  });

  it('counts a win at the move limit like a counted win', () => {
    expect(gameFacts('go', result({ reason: 'move-limit', margin: 3.5 }), 'N', null).values).toMatchObject({ bigMargin: 3 });
  });

  it('ranks a win first and a loss second, never a tie', () => {
    expect(matchStanding(result(), 'N')).toMatchObject({ rank: 1, won: true, tied: false, players: 2 });
    expect(matchStanding(result(), 'S')).toMatchObject({ rank: 2, won: false, tied: false });
    expect(matchStanding(result(), 'E')).toBeNull();
  });
});
