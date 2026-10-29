// ─── Pure view helpers for the Banqi table ───

import type { GameSeat } from '@shared/types';
import type { BanqiMove, BanqiVisibleState } from '@shared/games/banqi/types';
import {
  BQ_CELLS, BQ_DOWN, BQ_EMPTY, BQ_RANK_COUNTS, bqCell, bqColour, bqFlips, bqGlyph, bqMoves, bqMovesFrom, bqNode, isBqPiece,
} from '@shared/rules/banqi';
import type { BqColour, BqPiece } from '@shared/rules/banqi';
import { banqiRules } from '@shared/banqi-options';
import { coordinateLabel } from '@shared/rules/board/board-model';
import type { NodeId } from '@shared/rules/board/board-model';
import { banqiBoard } from '@shared/rules/board/boards';
import type { MoveNotation } from '@shared/rules/board/board-move';

const BOARD = banqiBoard();

export interface BanqiCellView {
  readonly node: NodeId;
  /** The face-up piece, or null for a face-down one */
  readonly piece: BqPiece | null;
  /** God view only: what a spectator knows lies under a face-down piece */
  readonly secret: BqPiece | null;
}

/** Colour a seat plays, or null before the first flip (and for a spectator without a seat). */
export function banqiColour(game: Pick<BanqiVisibleState, 'seats' | 'colours'>, seat: GameSeat): BqColour | null {
  const index = game.seats.indexOf(seat);
  return game.colours === null || index < 0 ? null : game.colours[index];
}

/** Occupied cells; only spectators receive `observedPieces`, so a seated player's `secret` is always null. */
export function banqiCells(game: BanqiVisibleState): BanqiCellView[] {
  const cells: BanqiCellView[] = [];
  for (let index = 0; index < BQ_CELLS; index++) {
    const slot = game.board[index];
    if (slot === BQ_EMPTY) continue;
    const node = bqNode(index);
    cells.push(slot === BQ_DOWN
      ? { node, piece: null, secret: game.observedPieces?.[node] ?? null }
      : { node, piece: slot, secret: null });
  }
  return cells;
}

export interface BanqiChoices {
  /** Own face-up pieces that can move or capture now */
  readonly movable: NodeId[];
  /** Face-down pieces the viewer may flip with one tap */
  readonly flips: NodeId[];
  /** Cells the piece on `from` may reach; `capture` also marks blind attacks on face-down pieces */
  readonly targets: (from: NodeId) => { readonly node: NodeId; readonly capture: boolean }[];
}

const NONE: BanqiChoices = { movable: [], flips: [], targets: () => [] };

/** What the viewer may do now: nothing unless it is their turn in a running match. */
export function banqiChoices(game: BanqiVisibleState, mySeat: GameSeat | null): BanqiChoices {
  if (mySeat === null || game.phase !== 'playing' || game.currentTurnSeat !== mySeat) return NONE;
  const rules = banqiRules(game.options);
  const colour = banqiColour(game, mySeat);
  if (game.chain !== null) {
    const from = bqCell(game.chain);
    const captures = from === null ? [] : bqMovesFrom(game.board, from, rules, true);
    return {
      movable: captures.length > 0 ? [game.chain] : [],
      flips: [],
      targets: (node) => captures.filter((move) => bqNode(move.from) === node)
        .map((move) => ({ node: bqNode(move.to), capture: true })),
    };
  }
  const moves = colour === null ? [] : bqMoves(game.board, colour, rules);
  return {
    movable: [...new Set(moves.map((move) => bqNode(move.from)))],
    flips: bqFlips(game.board).map(bqNode),
    targets: (node) => moves.filter((move) => bqNode(move.from) === node)
      .map((move) => ({ node: bqNode(move.to), capture: move.capture || move.blind === true })),
  };
}

/** Pieces of each colour still in play (face-down ones included), which the log makes public. */
export function banqiRemaining(game: Pick<BanqiVisibleState, 'log'>): [red: number, black: number] {
  const total = BQ_RANK_COUNTS.reduce((sum, count) => sum + count, 0);
  const left: [number, number] = [total, total];
  for (const entry of game.log) if (entry.captured !== undefined) left[bqColour(entry.captured)]--;
  return left;
}

/** The latest action's cells, for the last-move marker. */
export function banqiLastMove(game: Pick<BanqiVisibleState, 'log'>): { readonly from?: NodeId; readonly to: NodeId } | null {
  const last = game.log.at(-1);
  return last ? { ...last.from === undefined ? {} : { from: last.from }, to: last.to } : null;
}

/**
 * Piece characters carry the colour, so the list needs no colour column: `翻 c2 俥`, `俥 c2-c3`, `俥 c2xc3`. A blind
 * attack marks the face-down target with `?` and ends with the piece it revealed: `俥 c2x?c3 卒` took it,
 * `俥 c2?c3 翻 傌` only turned it over.
 */
export const banqiNotation: MoveNotation<BanqiMove> = (move, locale) => {
  const to = coordinateLabel(BOARD, move.to);
  const flipWord = locale === 'zh-TW' ? '翻' : 'Flip';
  if (move.revealed !== undefined && !move.blind) return `${flipWord} ${to} ${bqGlyph(move.revealed)}`;
  const from = move.from === undefined ? '' : coordinateLabel(BOARD, move.from);
  const piece = move.piece !== undefined && isBqPiece(move.piece) ? bqGlyph(move.piece) : '';
  const step = `${move.chain ? '+' : ''}${piece} ${from}${move.capture ? 'x' : move.blind ? '' : '-'}${move.blind ? '?' : ''}${to}`.trim();
  if (!move.blind || move.revealed === undefined) return step;
  return move.capture ? `${step} ${bqGlyph(move.revealed)}` : `${step} ${flipWord} ${bqGlyph(move.revealed)}`;
};

/** Whether moving from `from` to `to` attacks a face-down piece, for the pending-move prompt. */
export const banqiBlindTarget = (game: Pick<BanqiVisibleState, 'board'>, to: NodeId): boolean => {
  const cell = bqCell(to);
  return cell !== null && game.board[cell] === BQ_DOWN;
};

/** The seat to move is in a capture chain it may end. */
export const banqiInChain = (game: BanqiVisibleState, mySeat: GameSeat | null): boolean =>
  mySeat !== null && game.phase === 'playing' && game.currentTurnSeat === mySeat && game.chain !== null;
