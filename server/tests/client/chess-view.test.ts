import { describe, expect, it, vi } from 'vitest';
import type { ChessMatchResult, ChessMoveRecord, ChessVisibleState } from '@shared/types';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import { chessInitialPosition } from '@shared/rules/chess';
import {
  CHESS_NOTATION, chessCaptures, chessCheck, chessLastMove, chessNodeName, chessPendingText, chessPieces, chessSide, chessTargets,
  isChessPromotion,
} from '../../../client/src/games/chess/chess-view';
import { clientGame } from '../../../client/src/games/registry';
import { gameUi } from '../../../client/src/games/ui-registry';
import { newBoardMoveCue } from '../../../client/src/games/board/board-move-sound';
import { boardMoveEntries } from '../../../client/src/games/board/BoardMoves';
import { chessFen } from '../fixtures/chess-positions';

// The UI registry reaches components that read the account.
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (state: { account: null }) => unknown) => select({ account: null }),
}));

function game(overrides: Partial<ChessVisibleState> = {}): ChessVisibleState {
  const start = chessInitialPosition();
  return {
    gameType: 'chess', phase: 'playing', mySeat: 'N', seats: ['N', 'S'], board: start.board, castling: start.castling,
    enPassant: null, halfmove: 0, currentTurnSeat: 'N', drawOffer: NO_DRAW_OFFER, log: [], result: null, ...overrides,
  };
}

/** A view of `fen`, with the side to move taken from it. */
function positioned(fen: string, overrides: Partial<ChessVisibleState> = {}): ChessVisibleState {
  const position = chessFen(fen);
  return game({
    board: position.board, castling: position.castling, enPassant: position.enPassant, halfmove: position.halfmove,
    currentTurnSeat: position.turn === 0 ? 'N' : 'S', ...overrides,
  });
}

const t = ((key: string) => key) as never;
const record = (extra: Partial<ChessMoveRecord> = {}): ChessMoveRecord =>
  ({ seat: 'N', from: '4,6', to: '4,4', piece: 'P', san: 'e4', timestamp: 1, ...extra });

describe('Chess view helpers', () => {
  it('draws every piece and assigns white to the first seat', () => {
    expect(chessPieces(game().board)).toHaveLength(32);
    expect([chessSide(game(), 'N'), chessSide(game(), 'S')]).toEqual([0, 1]);
  });

  it('offers legal destinations by origin only to the seat on turn', () => {
    const targets = chessTargets(game(), 'N');
    expect([...targets.values()].flat()).toHaveLength(20);
    expect([...targets.get('6,7')!].sort()).toEqual(['5,5', '7,5']);
    expect(chessTargets(game(), 'S').size).toBe(0);
    expect(chessTargets(game(), null).size).toBe(0);
    expect(chessTargets(game({ phase: 'scoring' }), 'N').size).toBe(0);
  });

  it('lists a promoting square once and recognises the move that needs a piece', () => {
    const view = positioned('4k3/P6p/8/8/8/8/8/4K3 w - -');
    expect(chessTargets(view, 'N').get('0,1')).toEqual(['0,0']);
    expect(isChessPromotion(view, '0,1', '0,0')).toBe(true);
    expect(isChessPromotion(view, '4,7', '4,6')).toBe(false);
    expect(isChessPromotion(game(), '4,6', '4,4')).toBe(false);
    expect(chessPendingText(view, '0,1', '0,0')).toBe('a8=?');
  });

  it('offers castling and en passant targets', () => {
    const castling = positioned('r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
    expect(chessTargets(castling, 'N').get('4,7')).toEqual(expect.arrayContaining(['6,7', '2,7']));
    const passant = positioned('4k3/8/8/3pP3/8/8/8/4K3 w - d6');
    expect(chessTargets(passant, 'N').get('4,3')).toContain('3,2');
  });

  it('marks the king in check while playing and after a checkmate', () => {
    const board = chessFen('4k3/8/8/8/8/8/8/R3K3 b - -').board;
    const log = [record({ piece: 'R', from: '0,5', to: '0,7', check: true, san: 'Ra1+' })];
    expect(chessCheck(game({ board, currentTurnSeat: 'S', log }))).toBe('4,0');
    const result: ChessMatchResult = { gameType: 'chess', seats: ['N', 'S'], moves: 1, winners: ['N'], reason: 'checkmate' };
    expect(chessCheck(game({ board, phase: 'scoring', currentTurnSeat: 'N', log, result }))).toBe('4,0');
    expect(chessCheck(game({ board, log: [record()] }))).toBeNull();
    expect(chessCheck(game())).toBeNull();
  });

  it('lists captures per seat, the last move, and square names', () => {
    const log = [
      record({ captured: 'p', capture: true, san: 'exd5' }),
      record({ seat: 'S', piece: 'q', from: '3,0', to: '3,3', captured: 'P', capture: true, san: 'Qxd5' }),
    ];
    expect(chessCaptures(game({ log }))).toEqual({ N: ['p'], S: ['P'] });
    expect(chessLastMove(game({ log }))).toEqual({ from: '3,0', to: '3,3' });
    expect(chessLastMove(game())).toBeNull();
    expect([chessNodeName('0,7'), chessNodeName('7,0'), chessNodeName('4,4')]).toEqual(['a1', 'h8', 'e4']);
  });

  it('writes moves in algebraic notation and previews a pending move', () => {
    const log = [record(), record({ seat: 'S', piece: 'n', san: 'Nf6' })];
    expect(boardMoveEntries(log, CHESS_NOTATION, 'zh-TW', t).map((entry) => entry.text)).toEqual(['e4', 'Nf6']);
    expect(chessPendingText(game(), '6,7', '5,5')).toBe('Nf3');
    expect(chessPendingText(game(), '4,4', '4,5')).toBe('');
    expect(chessPendingText(game(), '4,6', '4,3')).toBe('');
  });
});

describe('Chess sounds and client module', () => {
  it('sounds check before capture, and capture before a plain move', () => {
    const cue = gameUi('chess').boardMoveCue!;
    expect(cue(record(), game())).toBe('place');
    expect(cue(record({ captured: 'p', capture: true }), game())).toBe('capture');
    expect(cue(record({ captured: 'p', capture: true, check: true }), game())).toBe('check');
    expect(newBoardMoveCue(game(), game({ log: [record({ check: true })] }))).toBe('check');
  });

  it('summarizes results and restores snapshots', () => {
    const client = clientGame('chess');
    const win: ChessMatchResult = { gameType: 'chess', seats: ['N', 'S'], moves: 41, winners: ['N'], reason: 'checkmate' };
    expect(client.result.winners(win)).toEqual(['N']);
    expect(client.result.summary(win, 'N', t)).toMatchObject({ kind: 'winners', winners: ['N'] });
    expect(client.result.summary({ ...win, winners: [], reason: 'fifty-move' }, 'N', t)).toMatchObject({ kind: 'text' });
    const retain = <T,>(_previous: T | null, next: T): T => next;
    expect(client.restoreSnapshot(game({ currentTurnSeat: 'S' }), { state: { chess: null } as never, retain }))
      .toMatchObject({ phase: 'playing', currentTurnSeat: 'S' });
  });

  it('summarizes the rules without a room option', () => {
    const client = clientGame('chess');
    expect(client.rules.summary(client.rules.matchContext(game()), t)).toHaveLength(2);
    expect(client.rules.roomContext({} as never).option).toBeNull();
  });
});
