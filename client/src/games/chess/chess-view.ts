// ─── Pure view helpers for the Chess table ───

import type { ChessMoveRecord, ChessVisibleState, GameSeat } from '@shared/types';
import {
  CHESS_CELLS, CHESS_COLS, CHESS_ROWS, chessCell, chessKindOf, chessLegalMoves, chessMoveFacts, chessNode, chessSideOf,
} from '@shared/rules/chess';
import type { ChessCell, ChessMove, ChessPiece, ChessPosition, ChessPromotion, ChessSide } from '@shared/rules/chess';
import type { MoveNotation } from '@shared/rules/board/board-move';
import type { NodeId } from '@shared/rules/board/board-model';

export interface ChessPieceView {
  readonly node: NodeId;
  readonly piece: ChessPiece;
}

/** Side a seat plays: the first seat plays white. */
export function chessSide(game: Pick<ChessVisibleState, 'seats'>, seat: GameSeat): ChessSide {
  return game.seats.indexOf(seat) === 0 ? 0 : 1;
}

/** The position the seat to move faces, enough to list its legal moves. */
export function chessPositionOfView(game: ChessVisibleState): ChessPosition {
  return {
    board: game.board, turn: chessSide(game, game.currentTurnSeat), castling: game.castling, enPassant: game.enPassant,
    halfmove: game.halfmove,
  };
}

export function chessPieces(board: readonly ChessCell[]): ChessPieceView[] {
  const pieces: ChessPieceView[] = [];
  for (let index = 0; index < CHESS_CELLS; index++) {
    const piece = board[index];
    if (piece) pieces.push({ node: chessNode(index), piece });
  }
  return pieces;
}

/** Legal destinations by origin for the viewer; empty unless it is their turn in a running match. */
export function chessTargets(game: ChessVisibleState, mySeat: GameSeat | null): ReadonlyMap<NodeId, readonly NodeId[]> {
  const targets = new Map<NodeId, NodeId[]>();
  if (mySeat === null || game.phase !== 'playing' || game.currentTurnSeat !== mySeat) return targets;
  for (const move of chessLegalMoves(chessPositionOfView(game))) {
    const from = chessNode(move.from);
    const to = chessNode(move.to);
    const list = targets.get(from) ?? [];
    // A promotion appears four times, once per piece; the picker chooses between them.
    if (!list.includes(to)) targets.set(from, [...list, to]);
  }
  return targets;
}

/** Whether moving the piece on `from` to `to` ends a pawn's march, so the player must name its new piece. */
export function isChessPromotion(game: Pick<ChessVisibleState, 'board'>, from: NodeId, to: NodeId): boolean {
  const origin = chessCell(from);
  const target = chessCell(to);
  const piece = origin === null ? null : game.board[origin];
  if (piece === null || piece === undefined || target === null || chessKindOf(piece) !== 'p') return false;
  return Math.floor(target / CHESS_COLS) === (chessSideOf(piece) === 0 ? 0 : CHESS_ROWS - 1);
}

/** The king of the side in check, including a checkmated one at the end of the match. */
export function chessCheck(game: ChessVisibleState): NodeId | null {
  const last = game.log.at(-1);
  if (!last?.check) return null;
  // The last move gave the check, so the king in check belongs to the other side.
  const side: ChessSide = chessSideOf(last.piece) === 0 ? 1 : 0;
  const king = game.board.findIndex((cell) => cell !== null && chessKindOf(cell) === 'k' && chessSideOf(cell) === side);
  return king < 0 ? null : chessNode(king);
}

/** Pieces each seat has taken, in capture order. */
export function chessCaptures(game: ChessVisibleState): Partial<Record<GameSeat, ChessPiece[]>> {
  const captures: Partial<Record<GameSeat, ChessPiece[]>> = {};
  for (const entry of game.log) {
    if (entry.captured) captures[entry.seat] = [...captures[entry.seat] ?? [], entry.captured];
  }
  return captures;
}

export function chessLastMove(game: ChessVisibleState): { readonly from: NodeId; readonly to: NodeId } | null {
  const last = game.log.at(-1);
  return last ? { from: last.from, to: last.to } : null;
}

/** Notation hook for the move list: standard algebraic notation in every language. */
export const CHESS_NOTATION: MoveNotation<ChessMoveRecord> = (move) => move.san;

/** The notation of a move the viewer has chosen but not yet confirmed; a promotion shows `=?` for the open choice. */
export function chessPendingText(game: ChessVisibleState, from: NodeId, to: NodeId): string {
  const origin = chessCell(from);
  const target = chessCell(to);
  if (origin === null || target === null || !game.board[origin]) return '';
  const promoting = isChessPromotion(game, from, to);
  const move: ChessMove = { from: origin, to: target, ...promoting ? { promotion: 'q' as ChessPromotion } : {} };
  try {
    const san = chessMoveFacts(chessPositionOfView(game), move).san;
    // Whether the move checks depends on the piece chosen, so the open choice drops the check mark.
    return promoting ? san.replace(/=Q.*$/, '=?') : san;
  } catch {
    return '';
  }
}

export const CHESS_FILES: readonly string[] = Array.from({ length: CHESS_COLS }, (_, col) => String.fromCharCode(97 + col));
export const CHESS_RANKS: readonly string[] = Array.from({ length: CHESS_ROWS }, (_, row) => String(CHESS_ROWS - row));

/** Accessible name of a square, e.g. `e4`. */
export const chessNodeName = (node: NodeId): string => {
  const cell = chessCell(node);
  return cell === null ? node : `${CHESS_FILES[cell % CHESS_COLS]}${CHESS_RANKS[Math.floor(cell / CHESS_COLS)]}`;
};

