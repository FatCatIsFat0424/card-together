import { describe, expect, it } from 'vitest';
import { matchStanding } from '@shared/rules/match-standing';
import { gameFacts } from '@shared/stats/registry';
import { STATS_RECORDS } from '@shared/stats/definitions';
import type { ReplaySnapshot } from '@shared/types';
import type { BanqiMatchResult, BanqiMove, BanqiVisibleState } from '@shared/games/banqi/types';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import { bqPiece } from '@shared/rules/banqi';

function result(overrides: Partial<BanqiMatchResult> = {}): BanqiMatchResult {
  return { gameType: 'banqi', seats: ['N', 'S'], remaining: { N: 9, S: 3 }, moves: 80, winners: ['N'], reason: 'no-moves', ...overrides };
}

function frame(log: BanqiMove[]): ReplaySnapshot {
  const visible: BanqiVisibleState = {
    gameType: 'banqi', phase: 'scoring', mySeat: 'N', seats: ['N', 'S'], options: { chain: true, rookDash: false },
    board: new Array(32).fill(-1), colours: [0, 1], currentTurnSeat: 'N', chain: null, quietMoves: 0, drawOffer: NO_DRAW_OFFER,
    log, result: null,
  };
  return visible as unknown as ReplaySnapshot;
}

const capture = (seat: 'N' | 'S', captured: number, chain = false, timestamp = 1): BanqiMove => ({
  seat, from: '0,0', to: '1,0', piece: bqPiece(seat === 'N' ? 0 : 1, 3), capture: true, captured, ...chain ? { chain: true as const } : {}, timestamp,
});

describe('Banqi statistics', () => {
  it('declares its special records at version 1', () => {
    expect(STATS_RECORDS.banqi.map((record) => [record.id, record.source, record.kind, record.version])).toEqual([
      ['topPieces', 'result', 'max', 1], ['wipeouts', 'result', 'count', 1], ['generalsTaken', 'log', 'count', 1],
      ['bestChain', 'log', 'max', 1],
    ]);
  });

  it('records the pieces left and a wipeout from the result, for the winner only', () => {
    expect(gameFacts('banqi', result(), 'N', null)).toMatchObject({ values: { topPieces: 9 }, counts: {} });
    expect(gameFacts('banqi', result(), 'S', null).values).toEqual({ topPieces: 3 });
    const wiped = result({ remaining: { N: 5, S: 0 }, reason: 'all-captured' });
    expect(gameFacts('banqi', wiped, 'N', null).counts).toEqual({ wipeouts: 1 });
    expect(gameFacts('banqi', wiped, 'S', null).counts).toEqual({});
    expect(gameFacts('banqi', result({ remaining: {}, reason: 'resign' }), 'N', null).values).toEqual({ topPieces: 0 });
  });

  it('counts generals captured and the longest chain from the public log', () => {
    const log: BanqiMove[] = [
      { seat: 'N', to: '2,2', revealed: bqPiece(0, 0), timestamp: 1 },
      capture('N', bqPiece(1, 0)),
      capture('N', bqPiece(1, 4), true),
      capture('N', bqPiece(1, 6), true),
      capture('S', bqPiece(0, 0)),
      capture('S', bqPiece(0, 5)),
      capture('N', bqPiece(1, 5)),
    ];
    expect(gameFacts('banqi', result(), 'N', frame(log))).toMatchObject({ counts: { generalsTaken: 1 }, values: { bestChain: 3 } });
    expect(gameFacts('banqi', result(), 'S', frame(log))).toMatchObject({ counts: { generalsTaken: 1 }, values: { bestChain: 1 } });
    expect(gameFacts('banqi', result(), 'N', frame([log[0]])).values).toEqual({ topPieces: 9 });
  });

  it('ranks a win first, a loss second, and a draw first for both with a tie', () => {
    expect(matchStanding(result(), 'N')).toMatchObject({ rank: 1, won: true, tied: false, players: 2 });
    expect(matchStanding(result(), 'S')).toMatchObject({ rank: 2, won: false, tied: false });
    const draw = result({ winners: [], reason: 'no-capture-limit' });
    expect(matchStanding(draw, 'N')).toMatchObject({ rank: 1, won: true, tied: true });
    expect(matchStanding(draw, 'S')).toMatchObject({ rank: 1, won: true, tied: true });
    expect(matchStanding(draw, 'E')).toBeNull();
  });
});
