import { describe, expect, it } from 'vitest';
import { matchStanding } from '@shared/rules/match-standing';
import { gameFacts } from '@shared/stats/registry';
import { STATS_RECORDS } from '@shared/stats/definitions';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import { chessInitialPosition } from '@shared/rules/chess';
import type { ChessMatchResult, ChessMoveRecord, ChessVisibleState, ReplaySnapshot } from '@shared/types';

function result(overrides: Partial<ChessMatchResult> = {}): ChessMatchResult {
  return { gameType: 'chess', seats: ['N', 'S'], moves: 41, winners: ['N'], reason: 'checkmate', ...overrides };
}

function frame(log: ChessMoveRecord[]): ReplaySnapshot {
  const start = chessInitialPosition();
  const view: ChessVisibleState = {
    gameType: 'chess', phase: 'scoring', mySeat: 'N', seats: ['N', 'S'], board: start.board, castling: start.castling,
    enPassant: null, halfmove: 0, currentTurnSeat: 'N', drawOffer: NO_DRAW_OFFER, log, result: result(),
  };
  return view;
}

const entry = (seat: 'N' | 'S', extra: Partial<ChessMoveRecord>): ChessMoveRecord =>
  ({ seat, from: '4,6', to: '4,4', piece: 'P', san: 'e4', timestamp: 1, ...extra });

describe('Chess statistics', () => {
  it('declares its special records at version 1', () => {
    expect(STATS_RECORDS.chess.map((record) => [record.id, record.source, record.kind, record.version])).toEqual([
      ['checkmates', 'result', 'count', 1], ['fastestMate', 'result', 'min', 1], ['promotions', 'log', 'count', 1],
      ['castles', 'log', 'count', 1], ['enPassants', 'log', 'count', 1],
    ]);
  });

  it('credits checkmates and the winner’s own move count', () => {
    expect(gameFacts('chess', result(), 'N', null)).toMatchObject({ counts: { checkmates: 1 }, values: { fastestMate: 21 } });
    expect(gameFacts('chess', result({ winners: ['S'], moves: 40 }), 'S', null))
      .toMatchObject({ counts: { checkmates: 1 }, values: { fastestMate: 20 } });
    expect(gameFacts('chess', result(), 'S', null)).toMatchObject({ counts: {}, values: {} });
    expect(gameFacts('chess', result({ reason: 'resign' }), 'N', null)).toMatchObject({ counts: {}, values: {} });
  });

  it('counts promotions, castlings, and en passant captures from the public log', () => {
    const log: ChessMoveRecord[] = [
      entry('N', { piece: 'K', castle: 'k', san: 'O-O' }),
      entry('S', { piece: 'K', castle: 'q', san: 'O-O-O' }),
      entry('N', { enPassant: true, captured: 'p', capture: true, san: 'exd6' }),
      entry('N', { promotion: 'q', san: 'e8=Q' }),
      entry('N', { promotion: 'n', san: 'a8=N' }),
      entry('S', { san: 'e5' }),
    ];
    expect(gameFacts('chess', result({ reason: 'resign' }), 'N', frame(log)))
      .toMatchObject({ counts: { castles: 1, enPassants: 1, promotions: 2 } });
    expect(gameFacts('chess', result({ reason: 'resign' }), 'S', frame(log))).toMatchObject({ counts: { castles: 1 } });
  });

  it('ranks a win first, a loss second, and a draw first for both', () => {
    expect(matchStanding(result(), 'N')).toMatchObject({ rank: 1, won: true, tied: false, players: 2 });
    expect(matchStanding(result(), 'S')).toMatchObject({ rank: 2, won: false });
    const draw = result({ winners: [], reason: 'repetition' });
    expect(matchStanding(draw, 'S')).toMatchObject({ rank: 1, won: true, tied: true });
  });
});
