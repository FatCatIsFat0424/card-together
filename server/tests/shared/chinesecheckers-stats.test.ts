import { describe, expect, it } from 'vitest';
import { matchStanding } from '@shared/rules/match-standing';
import { gameFacts } from '@shared/stats/registry';
import { STATS_RECORDS } from '@shared/stats/definitions';
import { ccJumps } from '@shared/stats/chinesecheckers';
import type { ChineseCheckersMatchResult, ChineseCheckersMove, GameSeat, ReplaySnapshot } from '@shared/types';

function result(overrides: Partial<ChineseCheckersMatchResult> = {}): ChineseCheckersMatchResult {
  return {
    gameType: 'chinesecheckers', seats: ['N', 'E', 'S'], corners: { N: 0, E: 2, S: 4 }, remaining: { N: 0, E: 12, S: 30 },
    arrived: { N: 10, E: 6, S: 2 }, ranks: { N: 1, E: 2, S: 3 }, moves: 90, winners: ['N'], reason: 'all-home', ...overrides,
  };
}

/** Only the recorded fields, without the builder's methods. */
function facts(value: ChineseCheckersMatchResult, seat: GameSeat, snapshot: ReplaySnapshot | null): object {
  const { counts, sums, values } = gameFacts('chinesecheckers', value, seat, snapshot);
  return { counts, sums, values };
}

const frame = (log: readonly ChineseCheckersMove[]): ReplaySnapshot => ({ gameType: 'chinesecheckers', log }) as unknown as ReplaySnapshot;

describe('Chinese checkers statistics', () => {
  it('declares its special records at version 1', () => {
    expect(STATS_RECORDS.chinesecheckers.map((record) => [record.id, record.source, record.kind, record.version])).toEqual([
      ['crowdWins', 'result', 'count', 1], ['fewestMoves', 'log', 'min', 1], ['longestChain', 'log', 'max', 1],
      ['longChains', 'log', 'count', 1],
    ]);
  });

  it('counts jumps from the public record', () => {
    expect(ccJumps({})).toBe(0);
    expect(ccJumps({ jump: true })).toBe(1);
    expect(ccJumps({ jump: true, path: ['0,8', '2,6'] })).toBe(3);
  });

  it('counts multi-player wins from the result alone', () => {
    expect(facts(result(), 'N', null)).toEqual({ counts: { crowdWins: 1 }, sums: {}, values: {} });
    expect(gameFacts('chinesecheckers', result(), 'E', null).counts).toEqual({});
    const duel = result({ seats: ['N', 'S'], corners: { N: 0, S: 3 }, remaining: { N: 0, S: 9 }, arrived: { N: 10, S: 7 },
      ranks: { N: 1, S: 2 } });
    expect(gameFacts('chinesecheckers', duel, 'N', null).counts).toEqual({});
  });

  it('reads moves to win and jump chains from the log', () => {
    const log: ChineseCheckersMove[] = [
      { seat: 'N', from: '-3,13', to: '-4,12', timestamp: 1 },
      { seat: 'E', from: '1,3', to: '2,4', jump: true, path: ['0,8', '2,6', '4,6'], timestamp: 2 },
      { seat: 'S', timestamp: 3 },
      { seat: 'N', from: '-2,14', to: '0,12', jump: true, timestamp: 4 },
      { seat: 'N', from: '0,12', to: '4,8', jump: true, path: ['2,10', '3,9'], timestamp: 5 },
    ];
    expect(facts(result(), 'N', frame(log)))
      .toEqual({ counts: { crowdWins: 1, longChains: 1 }, sums: {}, values: { fewestMoves: 3, longestChain: 3 } });
    expect(facts(result(), 'E', frame(log)))
      .toEqual({ counts: { longChains: 1 }, sums: {}, values: { longestChain: 4 } });
    expect(facts(result(), 'S', frame(log))).toEqual({ counts: {}, sums: {}, values: {} });
    // A win on progress at the turn limit is not a race finished in that many moves.
    expect(gameFacts('chinesecheckers', result({ reason: 'move-limit' }), 'N', frame(log)).values).toEqual({ longestChain: 3 });
  });

  it('ranks seats by their places, ties for first counting as wins', () => {
    expect(matchStanding(result(), 'S')).toMatchObject({ rank: 3, won: false, players: 3, tied: false });
    const draw = result({ seats: ['N', 'S'], winners: [], reason: 'agreed-draw', ranks: { N: 1, S: 1 } });
    expect(matchStanding(draw, 'S')).toMatchObject({ rank: 1, won: true, tied: true });
  });
});
