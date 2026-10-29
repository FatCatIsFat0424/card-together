import { describe, expect, it } from 'vitest';
import { matchStanding } from '@shared/rules/match-standing';
import { gameFacts } from '@shared/stats/registry';
import { STATS_RECORDS } from '@shared/stats/definitions';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import { xqInitialBoard } from '@shared/rules/xiangqi';
import type { ReplaySnapshot, XiangqiMatchResult, XiangqiMove, XiangqiVisibleState } from '@shared/types';

function result(overrides: Partial<XiangqiMatchResult> = {}): XiangqiMatchResult {
  return { gameType: 'xiangqi', seats: ['N', 'S'], moves: 41, winners: ['N'], reason: 'checkmate', ...overrides };
}

function frame(log: XiangqiMove[]): ReplaySnapshot {
  const view: XiangqiVisibleState = {
    gameType: 'xiangqi', phase: 'scoring', mySeat: 'N', seats: ['N', 'S'], options: { handicap: 'none', handicapSide: 'red' },
    board: xqInitialBoard(), currentTurnSeat: 'N', drawOffer: NO_DRAW_OFFER, log, result: result(),
  };
  return view;
}

describe('Xiangqi statistics', () => {
  it('declares its special records at version 1', () => {
    expect(STATS_RECORDS.xiangqi.map((record) => [record.id, record.source, record.kind, record.version])).toEqual([
      ['checkmates', 'result', 'count', 1], ['fastestMate', 'result', 'min', 1], ['checks', 'log', 'count', 1],
      ['mostCaptures', 'log', 'max', 1],
    ]);
  });

  it('credits checkmates and the winner’s own move count', () => {
    expect(gameFacts('xiangqi', result(), 'N', null)).toMatchObject({ counts: { checkmates: 1 }, values: { fastestMate: 21 } });
    expect(gameFacts('xiangqi', result({ winners: ['S'], moves: 40 }), 'S', null))
      .toMatchObject({ counts: { checkmates: 1 }, values: { fastestMate: 20 } });
    expect(gameFacts('xiangqi', result(), 'S', null)).toMatchObject({ counts: {}, values: {} });
    expect(gameFacts('xiangqi', result({ reason: 'resign' }), 'N', null)).toMatchObject({ counts: {}, values: {} });
  });

  it('counts checks and captures from the public log', () => {
    const log: XiangqiMove[] = [
      { seat: 'N', from: '7,7', to: '7,0', piece: 'C', captured: 'h', capture: true, timestamp: 1 },
      { seat: 'S', from: '8,0', to: '7,0', piece: 'r', captured: 'C', capture: true, timestamp: 2 },
      { seat: 'N', from: '1,7', to: '4,7', piece: 'C', check: true, timestamp: 3 },
      { seat: 'S', from: '5,0', to: '4,1', piece: 'a', timestamp: 4 },
      { seat: 'N', from: '4,6', to: '4,5', piece: 'P', timestamp: 5 },
    ];
    expect(gameFacts('xiangqi', result({ reason: 'resign' }), 'N', frame(log)))
      .toMatchObject({ counts: { checks: 1 }, values: { mostCaptures: 1 } });
    expect(gameFacts('xiangqi', result({ reason: 'resign' }), 'S', frame(log)))
      .toMatchObject({ counts: {}, values: { mostCaptures: 1 } });
  });

  it('ranks a win first, a loss second, and a draw first for both', () => {
    expect(matchStanding(result(), 'N')).toMatchObject({ rank: 1, won: true, tied: false, players: 2 });
    expect(matchStanding(result(), 'S')).toMatchObject({ rank: 2, won: false });
    const draw = result({ winners: [], reason: 'repetition' });
    expect(matchStanding(draw, 'S')).toMatchObject({ rank: 1, won: true, tied: true });
  });
});
