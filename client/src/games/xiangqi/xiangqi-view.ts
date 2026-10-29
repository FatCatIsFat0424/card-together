// ─── Pure view helpers for the Xiangqi table ───

import type { GameSeat, XiangqiMove, XiangqiVisibleState } from '@shared/types';
import {
  XQ_CELLS, xqCell, xqGeneral, xqInCheck, xqLegalMoves, xqMoveFacts, xqNode, xqNotation, xqOpponent, xqSideOf,
} from '@shared/rules/xiangqi';
import type { XqNotationLocale, XqPiece, XqSide } from '@shared/rules/xiangqi';
import type { MoveNotation } from '@shared/rules/board/board-move';
import type { NodeId } from '@shared/rules/board/board-model';

export interface XiangqiPieceView {
  readonly node: NodeId;
  readonly piece: XqPiece;
}

/** Side a seat plays: the first seat plays red. */
export function xiangqiSide(game: Pick<XiangqiVisibleState, 'seats'>, seat: GameSeat): XqSide {
  return game.seats.indexOf(seat) === 0 ? 0 : 1;
}

export function xiangqiPieces(board: XiangqiVisibleState['board']): XiangqiPieceView[] {
  const pieces: XiangqiPieceView[] = [];
  for (let index = 0; index < XQ_CELLS; index++) {
    const piece = board[index];
    if (piece) pieces.push({ node: xqNode(index), piece });
  }
  return pieces;
}

/** Legal destinations by origin for the viewer; empty unless it is their turn in a running match. */
export function xiangqiTargets(game: XiangqiVisibleState, mySeat: GameSeat | null): ReadonlyMap<NodeId, readonly NodeId[]> {
  const targets = new Map<NodeId, NodeId[]>();
  if (mySeat === null || game.phase !== 'playing' || game.currentTurnSeat !== mySeat) return targets;
  for (const move of xqLegalMoves(game.board, xiangqiSide(game, mySeat))) {
    const from = xqNode(move.from);
    targets.set(from, [...targets.get(from) ?? [], xqNode(move.to)]);
  }
  return targets;
}

/** The general of the side to move while it is in check, including a checkmated one at the end. */
export function xiangqiCheck(game: XiangqiVisibleState): NodeId | null {
  const finished = game.phase === 'scoring';
  if (finished && game.result?.reason !== 'checkmate') return null;
  const last = game.log.at(-1);
  // A finished game leaves the turn with the mover, so the side in check is the other one.
  const side = finished && last ? xqOpponent(xqSideOf(last.piece)) : xiangqiSide(game, game.currentTurnSeat);
  if (!xqInCheck(game.board, side)) return null;
  const general = xqGeneral(game.board, side);
  return general < 0 ? null : xqNode(general);
}

/** Pieces each seat has taken, in capture order. */
export function xiangqiCaptures(game: XiangqiVisibleState): Partial<Record<GameSeat, XqPiece[]>> {
  const captures: Partial<Record<GameSeat, XqPiece[]>> = {};
  for (const entry of game.log) {
    if (entry.captured) captures[entry.seat] = [...captures[entry.seat] ?? [], entry.captured];
  }
  return captures;
}

export function xiangqiLastMove(game: XiangqiVisibleState): { readonly from: NodeId; readonly to: NodeId } | null {
  const last = game.log.at(-1);
  return last ? { from: last.from, to: last.to } : null;
}

/** Notation hook for the move list: Chinese in Traditional Chinese, WXF in English. */
export const XIANGQI_NOTATION: MoveNotation<XiangqiMove> = (move, locale) => xqNotation(move, locale);

/** The notation of a move the viewer has chosen but not yet confirmed. */
export function xiangqiPendingText(game: XiangqiVisibleState, from: NodeId, to: NodeId, locale: XqNotationLocale): string {
  const origin = xqCell(from);
  const target = xqCell(to);
  if (origin === null || target === null || !game.board[origin]) return '';
  const facts = xqMoveFacts(game.board, origin, target);
  return xqNotation({ from, to, piece: facts.piece, line: facts.line }, locale) ?? '';
}
