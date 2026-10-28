// ─── Public move record shared by board games, with a per-game notation hook ───

import type { GameSeat } from '../../types/player';
import { coordinateLabel } from './board-model';
import type { BoardModel, NodeId } from './board-model';

/**
 * One public move. Games extend it with their own public facts (the moved piece, flipped discs, a battle
 * outcome) and must never put hidden information in it: every seat and replay sees the record.
 */
export interface BoardMoveRecord {
  readonly seat: GameSeat;
  /** Absent for placements (Gomoku, Reversi) and passes. */
  readonly from?: NodeId;
  /** Absent for passes. */
  readonly to?: NodeId;
  /** Intermediate landings of a multi-jump, in order, excluding `from` and `to`. */
  readonly path?: readonly NodeId[];
  readonly capture?: boolean;
}

export type NotationLocale = 'en' | 'zh-TW';

/**
 * Formats one move for the move list; `null` means the move did not touch the board (a pass), which the list
 * labels itself. Xiangqi supplies Chinese notation for `zh-TW` and WXF for `en`.
 */
export type MoveNotation<M extends BoardMoveRecord> = (move: M, locale: NotationLocale) => string | null;

/** Default notation from chess-style coordinates: `e2-e4`, `e2xe4` for captures, `h8` for placements. */
export function coordinateNotation(board: BoardModel): MoveNotation<BoardMoveRecord> {
  return (move) => {
    if (!move.to) return null;
    const to = coordinateLabel(board, move.to);
    if (!move.from) return to;
    const landings = [...move.path ?? [], move.to].map((id) => coordinateLabel(board, id));
    return `${coordinateLabel(board, move.from)}${move.capture ? 'x' : '-'}${landings.join('-')}`;
  };
}

/**
 * Moves grouped into numbered rows with one column per seat in `seats` order. A row ends when the next move
 * belongs to the same or an earlier column, so a game that starts with the second seat (or skips a pass)
 * leaves that cell empty instead of shifting later moves.
 */
export function moveRows<M extends BoardMoveRecord>(moves: readonly M[], seats: readonly GameSeat[]): (M | null)[][] {
  const rows: (M | null)[][] = [];
  let previous = Infinity;
  for (const move of moves) {
    const column = Math.max(0, seats.indexOf(move.seat));
    if (column <= previous) rows.push(seats.map(() => null));
    rows[rows.length - 1][column] = move;
    previous = column;
  }
  return rows;
}
