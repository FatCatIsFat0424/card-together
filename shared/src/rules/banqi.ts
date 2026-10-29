// ─── Banqi (Taiwan half-board chess) rules: ranks, captures, move generation, and the hidden set ───
//
// The board is the public view: every cell is empty, face down, or a face-up piece. Identities under
// face-down cells exist only in server state, so every function here works from the public cells and
// can run unchanged for a seat's bot.

import { nodeId } from './board/board-model';
import type { NodeId } from './board/board-model';

export const BQ_COLS = 8;
export const BQ_ROWS = 4;
export const BQ_CELLS = BQ_COLS * BQ_ROWS;

/** Consecutive moves without a flip or capture that end the game as a draw. */
export const BQ_QUIET_LIMIT = 50;

/** Piece colour: red (帥 side) or black (將 side). Which seat plays which is decided by the first flip. */
export type BqColour = 0 | 1;

/** Rank, strongest first: general, advisor, elephant, chariot, horse, cannon, soldier. */
export type BqRank = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const BQ_GENERAL: BqRank = 0;
export const BQ_CHARIOT: BqRank = 3;
export const BQ_CANNON: BqRank = 5;
export const BQ_SOLDIER: BqRank = 6;

/** A piece identity: `colour * 7 + rank`, 0–13. */
export type BqPiece = number;

/** One public cell: empty, face down, or the face-up piece. */
export type BqSlot = number;
export const BQ_EMPTY = -1;
export const BQ_DOWN = -2;

/** Row-major public cells (`row * 8 + col`). */
export type BqBoard = readonly BqSlot[];

/** Pieces of each rank per colour. */
export const BQ_RANK_COUNTS: readonly number[] = [1, 2, 2, 2, 2, 2, 5];

export const BQ_PIECE_COUNT = 14;

const GLYPHS: readonly (readonly string[])[] = [
  ['帥', '仕', '相', '俥', '傌', '炮', '兵'],
  ['將', '士', '象', '車', '馬', '包', '卒'],
];

export const bqPiece = (colour: BqColour, rank: BqRank): BqPiece => colour * 7 + rank;
export const bqColour = (piece: BqPiece): BqColour => (piece >= 7 ? 1 : 0);
export const bqRank = (piece: BqPiece): BqRank => (piece % 7) as BqRank;
export const bqOpposite = (colour: BqColour): BqColour => (colour === 0 ? 1 : 0);

/** The character printed on a piece: red 帥仕相俥傌炮兵, black 將士象車馬包卒. */
export const bqGlyph = (piece: BqPiece): string => GLYPHS[bqColour(piece)][bqRank(piece)];

export const isBqPiece = (value: unknown): value is BqPiece =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < BQ_PIECE_COUNT;

/** Whether `value` is a legal cell content: empty, face down, or a piece. */
export const isBqSlot = (value: unknown): value is BqSlot =>
  value === BQ_EMPTY || value === BQ_DOWN || isBqPiece(value);

/** All 32 pieces in a fixed order; shuffle a copy to deal. */
export function bqFullSet(): BqPiece[] {
  const set: BqPiece[] = [];
  for (const colour of [0, 1] as const) {
    BQ_RANK_COUNTS.forEach((count, rank) => {
      for (let n = 0; n < count; n++) set.push(bqPiece(colour, rank as BqRank));
    });
  }
  return set;
}

/** How many of each of the 14 piece types are in `pieces`. */
export function bqTally(pieces: readonly BqPiece[]): number[] {
  const tally = new Array<number>(BQ_PIECE_COUNT).fill(0);
  for (const piece of pieces) tally[piece]++;
  return tally;
}

/** Board node of a cell index, matching `banqiBoard()` ids. */
export const bqNode = (index: number): NodeId => nodeId(index % BQ_COLS, Math.floor(index / BQ_COLS));

/** Cell index of a board node id, or null when it is not a Banqi cell. */
export function bqCell(node: unknown): number | null {
  if (typeof node !== 'string') return null;
  const match = /^([0-7]),([0-3])$/.exec(node);
  return match ? Number(match[2]) * BQ_COLS + Number(match[1]) : null;
}

/** Rules a match plays, from its room options. */
export interface BqRules {
  /** After a capture the same piece may keep capturing within the turn. */
  readonly chain: boolean;
  /** The chariot slides any distance along a line and may capture at distance. */
  readonly rookDash: boolean;
  /** A face-up piece may attack a face-down one it could reach by capturing; the target is revealed. */
  readonly blindCapture: boolean;
}

/** Every variant off: the rules games played before the room options existed. */
export const BQ_STANDARD_RULES: BqRules = { chain: false, rookDash: false, blindCapture: false };

/**
 * Whether `attacker` may take `target` by moving onto it: rank equal or lower, the soldier also takes the
 * general and the general never takes a soldier. The cannon is excluded here because it only captures by
 * jumping, where rank does not matter (`bqMovesFrom`).
 */
export function bqCanCapture(attacker: BqPiece, target: BqPiece): boolean {
  if (bqColour(attacker) === bqColour(target)) return false;
  const a = bqRank(attacker);
  const d = bqRank(target);
  if (a === BQ_CANNON) return false;
  if (a === BQ_SOLDIER && d === BQ_GENERAL) return true;
  if (a === BQ_GENERAL && d === BQ_SOLDIER) return false;
  return a <= d;
}

/**
 * Whether a blind attack by `attacker` takes the piece it reveals: an enemy it could capture by its normal rule.
 * The cannon reached its target by jumping, so it takes any enemy, as a jump capture does.
 */
export function bqBlindTakes(attacker: BqPiece, revealed: BqPiece): boolean {
  if (bqColour(attacker) === bqColour(revealed)) return false;
  return bqRank(attacker) === BQ_CANNON || bqCanCapture(attacker, revealed);
}

/**
 * A move of a face-up piece; `capture` removes the face-up piece on `to`. A `blind` move attacks the face-down
 * piece on `to` (吃暗子): it is revealed, and taken only when `bqBlindTakes` allows, so its outcome is
 * unknown until the server applies it with the hidden identity.
 */
export interface BqMove {
  readonly from: number;
  readonly to: number;
  readonly capture: boolean;
  readonly blind?: true;
}

const DIRECTIONS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function stepFrom(index: number, dc: number, dr: number): number | null {
  const col = (index % BQ_COLS) + dc;
  const row = Math.floor(index / BQ_COLS) + dr;
  return col < 0 || col >= BQ_COLS || row < 0 || row >= BQ_ROWS ? null : row * BQ_COLS + col;
}

/** Skips empty cells along a direction and returns the first occupied cell, or null at the edge. */
function nextOccupied(board: BqBoard, from: number, dc: number, dr: number): number | null {
  let cell = stepFrom(from, dc, dr);
  while (cell !== null && board[cell] === BQ_EMPTY) cell = stepFrom(cell, dc, dr);
  return cell;
}

/**
 * Moves of the face-up piece on `from`, in board order of direction. `capturesOnly` lists just captures and
 * blind attacks, which is all a chain continuation may do. A face-down cell is only ever a blind attack's
 * target, reached with the piece's capture geometry (adjacent, the cannon's jump, or the dashing chariot's line).
 */
export function bqMovesFrom(board: BqBoard, from: number, rules: BqRules, capturesOnly = false): BqMove[] {
  const piece = board[from];
  if (!isBqPiece(piece)) return [];
  const colour = bqColour(piece);
  const rank = bqRank(piece);
  const moves: BqMove[] = [];
  const enemyUp = (cell: number): boolean => isBqPiece(board[cell]) && bqColour(board[cell]) !== colour;
  const blind = (cell: number): boolean => rules.blindCapture && board[cell] === BQ_DOWN;
  for (const [dc, dr] of DIRECTIONS) {
    const near = stepFrom(from, dc, dr);
    if (near === null) continue;
    if (rank === BQ_CANNON) {
      if (board[near] === BQ_EMPTY && !capturesOnly) moves.push({ from, to: near, capture: false });
      // The first piece along the line is the screen; the next piece behind it is the target.
      const screen = nextOccupied(board, from, dc, dr);
      const target = screen === null ? null : nextOccupied(board, screen, dc, dr);
      if (target !== null && enemyUp(target)) moves.push({ from, to: target, capture: true });
      else if (target !== null && blind(target)) moves.push({ from, to: target, capture: false, blind: true });
    } else if (rank === BQ_CHARIOT && rules.rookDash) {
      let cell: number | null = near;
      while (cell !== null && board[cell] === BQ_EMPTY) {
        if (!capturesOnly) moves.push({ from, to: cell, capture: false });
        cell = stepFrom(cell, dc, dr);
      }
      if (cell !== null && isBqPiece(board[cell]) && bqCanCapture(piece, board[cell])) {
        moves.push({ from, to: cell, capture: true });
      } else if (cell !== null && blind(cell)) {
        moves.push({ from, to: cell, capture: false, blind: true });
      }
    } else if (board[near] === BQ_EMPTY) {
      if (!capturesOnly) moves.push({ from, to: near, capture: false });
    } else if (isBqPiece(board[near]) && bqCanCapture(piece, board[near])) {
      moves.push({ from, to: near, capture: true });
    } else if (blind(near)) {
      moves.push({ from, to: near, capture: false, blind: true });
    }
  }
  return moves;
}

/** Every move of `colour`'s face-up pieces, flips excluded. */
export function bqMoves(board: BqBoard, colour: BqColour, rules: BqRules): BqMove[] {
  const moves: BqMove[] = [];
  for (let from = 0; from < BQ_CELLS; from++) {
    const piece = board[from];
    if (isBqPiece(piece) && bqColour(piece) === colour) moves.push(...bqMovesFrom(board, from, rules));
  }
  return moves;
}

/** Cells holding a face-down piece: the flips available to either player. */
export function bqFlips(board: BqBoard): number[] {
  const cells: number[] = [];
  for (let index = 0; index < BQ_CELLS; index++) if (board[index] === BQ_DOWN) cells.push(index);
  return cells;
}

/** Whether `colour` can flip or move at all; a player without an action loses. */
export function bqHasAction(board: BqBoard, colour: BqColour, rules: BqRules): boolean {
  if (board.includes(BQ_DOWN)) return true;
  for (let from = 0; from < BQ_CELLS; from++) {
    const piece = board[from];
    if (isBqPiece(piece) && bqColour(piece) === colour && bqMovesFrom(board, from, rules).length > 0) return true;
  }
  return false;
}

/** The board after a blind attack whose target turned out to be `revealed`, and the piece it took. */
export function bqApplyBlind(board: BqBoard, move: BqMove, revealed: BqPiece): { board: BqSlot[]; captured: BqPiece | null } {
  const next = [...board];
  const attacker = board[move.from];
  if (isBqPiece(attacker) && bqBlindTakes(attacker, revealed)) {
    next[move.to] = attacker;
    next[move.from] = BQ_EMPTY;
    return { board: next, captured: revealed };
  }
  // A failed attack only turns the target over; the attacker stays where it was.
  next[move.to] = revealed;
  return { board: next, captured: null };
}

/** The board after a move that is not blind, and the piece it captured. */
export function bqApplyMove(board: BqBoard, move: BqMove): { board: BqSlot[]; captured: BqPiece | null } {
  const next = [...board];
  const captured = move.capture && isBqPiece(board[move.to]) ? board[move.to] : null;
  next[move.to] = board[move.from];
  next[move.from] = BQ_EMPTY;
  return { board: next, captured };
}

/** Face-up pieces of `colour` on the board. */
export function bqUpPieces(board: BqBoard, colour: BqColour): BqPiece[] {
  return board.filter((slot): slot is BqPiece => isBqPiece(slot) && bqColour(slot) === colour);
}

/** Whether the grid is a well-formed 4 × 8 position. */
export function isBqBoard(value: unknown): value is BqBoard {
  return Array.isArray(value) && value.length === BQ_CELLS && value.every(isBqSlot);
}
