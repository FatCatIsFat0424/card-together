// ─── Xiangqi rules: move generation, check, game-ending verdicts, handicaps, and Chinese/WXF notation ───
//
// Positions are row-major cells (`row * 9 + col`) matching `xiangqiBoard()`: row 0 is black's back rank at the
// top, row 9 red's at the bottom. The compact engine below works on an `Int8Array` (red positive, black
// negative) so the search bots can make and unmake moves in place; the exported wrappers never mutate inputs.

import { nodeId } from './board/board-model';
import type { NodeId } from './board/board-model';

export const XQ_COLS = 9;
export const XQ_ROWS = 10;
export const XQ_CELLS = XQ_COLS * XQ_ROWS;

/** Index into the match's two seats: side 0 plays red, holds rows 5–9, and moves first. */
export type XqSide = 0 | 1;

/** General, advisor, elephant, horse, chariot (rook), cannon, soldier (pawn): the WXF letters. */
export const XQ_KINDS = ['k', 'a', 'e', 'h', 'r', 'c', 'p'] as const;
export type XqKind = typeof XQ_KINDS[number];

/** Uppercase pieces are red, lowercase black (as in Xiangqi FEN). */
export type XqPiece = Uppercase<XqKind> | XqKind;
export type XqCell = XqPiece | null;
export type XqBoard = readonly XqCell[];

/** A move as cell indices. */
export interface XqMove {
  readonly from: number;
  readonly to: number;
}

// ─── Handicaps ───

/** 讓子: pieces the giving side starts without. */
export const XQ_HANDICAPS = ['none', 'horse', 'horses', 'chariot', 'nine'] as const;
export type XqHandicap = typeof XQ_HANDICAPS[number];
/** Colour that gives the handicap. */
export const XQ_HANDICAP_SIDES = ['red', 'black'] as const;
export type XqHandicapSide = typeof XQ_HANDICAP_SIDES[number];

// ─── Engine codes ───

export const XQ_GENERAL = 1;
export const XQ_ADVISOR = 2;
export const XQ_ELEPHANT = 3;
export const XQ_HORSE = 4;
export const XQ_CHARIOT = 5;
export const XQ_CANNON = 6;
export const XQ_SOLDIER = 7;

const CODE_OF: Readonly<Record<XqKind, number>> = { k: 1, a: 2, e: 3, h: 4, r: 5, c: 6, p: 7 };
const KIND_OF: readonly XqKind[] = ['k', 'k', 'a', 'e', 'h', 'r', 'c', 'p'];

/** Mutable engine position: 0 empty, red pieces 1–7, black pieces −1…−7. */
export type XqEngineBoard = Int8Array;

export const XQ_COL: readonly number[] = Array.from({ length: XQ_CELLS }, (_, index) => index % XQ_COLS);
export const XQ_ROW: readonly number[] = Array.from({ length: XQ_CELLS }, (_, index) => Math.floor(index / XQ_COLS));

export const xqIndex = (col: number, row: number): number => row * XQ_COLS + col;
export const xqOpponent = (side: XqSide): XqSide => (side === 0 ? 1 : 0);
/** Sign of a side's engine codes. */
export const xqSign = (side: XqSide): 1 | -1 => (side === 0 ? 1 : -1);
/** Row step of a forward move. */
const forward = (side: XqSide): number => (side === 0 ? -1 : 1);

export function xqSideOf(piece: XqPiece): XqSide {
  return piece === piece.toUpperCase() ? 0 : 1;
}

export function xqKindOf(piece: XqPiece): XqKind {
  return piece.toLowerCase() as XqKind;
}

export function xqPiece(side: XqSide, kind: XqKind): XqPiece {
  return (side === 0 ? kind.toUpperCase() : kind) as XqPiece;
}

export function xqCode(piece: XqPiece): number {
  return CODE_OF[xqKindOf(piece)] * xqSign(xqSideOf(piece));
}

export function xqPieceOfCode(code: number): XqPiece | null {
  if (code === 0) return null;
  return xqPiece(code > 0 ? 0 : 1, KIND_OF[Math.abs(code)]);
}

export function isXqPiece(value: unknown): value is XqPiece {
  return typeof value === 'string' && value.length === 1 && (XQ_KINDS as readonly string[]).includes(value.toLowerCase());
}

/** Board node of a cell index, matching `xiangqiBoard()` ids. */
export const xqNode = (index: number): NodeId => nodeId(index % XQ_COLS, Math.floor(index / XQ_COLS));

/** Cell index of a board node id, or null when it is not a Xiangqi point. */
export function xqCell(node: unknown): number | null {
  if (typeof node !== 'string') return null;
  const match = /^([0-8]),([0-9])$/.exec(node);
  return match ? xqIndex(Number(match[1]), Number(match[2])) : null;
}

export function xqEngineBoard(board: XqBoard): XqEngineBoard {
  return Int8Array.from(board, (cell) => (cell === null ? 0 : xqCode(cell)));
}

export function xqBoardOf(engine: XqEngineBoard): XqCell[] {
  return Array.from(engine, (code) => xqPieceOfCode(code));
}

// ─── Start position ───

const BACK_RANK: readonly XqKind[] = ['r', 'h', 'e', 'a', 'k', 'a', 'e', 'h', 'r'];

/**
 * Cells (as red sees them, rows 6–9) the giving side leaves empty. Single pieces come from the giver's own left:
 * file 八/九 for red, files 2/1 from black's view (the board's right-hand side) for black.
 */
function handicapCells(handicap: XqHandicap): readonly (readonly [number, number])[] {
  switch (handicap) {
    case 'none': return [];
    case 'horse': return [[1, 9]];
    case 'horses': return [[1, 9], [7, 9]];
    case 'chariot': return [[0, 9]];
    // 讓九子: five soldiers, both advisors, and both elephants, keeping the general, chariots, horses, and cannons.
    case 'nine': return [[3, 9], [5, 9], [2, 9], [6, 9], [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]];
  }
}

/** The standard start, with the handicap's pieces removed from the giving colour. */
export function xqInitialBoard(handicap: XqHandicap = 'none', giver: XqHandicapSide = 'red'): XqBoard {
  const board: XqCell[] = new Array<XqCell>(XQ_CELLS).fill(null);
  for (const side of [0, 1] as const) {
    const back = side === 0 ? 9 : 0;
    const cannons = side === 0 ? 7 : 2;
    const soldiers = side === 0 ? 6 : 3;
    BACK_RANK.forEach((kind, col) => { board[xqIndex(col, back)] = xqPiece(side, kind); });
    for (const col of [1, 7]) board[xqIndex(col, cannons)] = xqPiece(side, 'c');
    for (const col of [0, 2, 4, 6, 8]) board[xqIndex(col, soldiers)] = xqPiece(side, 'p');
  }
  if (handicap !== 'none') {
    for (const [col, row] of handicapCells(handicap)) {
      // Black's left is the board's right: mirror both coordinates.
      board[giver === 'red' ? xqIndex(col, row) : xqIndex(8 - col, 9 - row)] = null;
    }
  }
  return board;
}

// ─── Geometry ───

function inPalace(side: XqSide, index: number): boolean {
  const col = XQ_COL[index];
  const row = XQ_ROW[index];
  return col >= 3 && col <= 5 && (side === 0 ? row >= 7 : row <= 2);
}

function ownHalf(side: XqSide, row: number): boolean {
  return side === 0 ? row >= 5 : row <= 4;
}

const inside = (col: number, row: number): boolean => col >= 0 && col < XQ_COLS && row >= 0 && row < XQ_ROWS;

const ORTHOGONAL: readonly (readonly [number, number])[] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const DIAGONAL: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
/** Horse jumps with the leg (the orthogonal point next to the horse) that blocks them. */
const HORSE_JUMPS: readonly (readonly [number, number, number, number])[] = [
  [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1],
  [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
];

/** Encodes a move for the engine's move lists. */
export const xqEncode = (from: number, to: number): number => (from << 7) | to;
export const xqFrom = (move: number): number => move >> 7;
export const xqTo = (move: number): number => move & 127;

/**
 * Pseudo-legal moves of `side` (they may leave the own general attacked), appended to `out` as encoded moves.
 * With `capturesOnly`, only moves onto an enemy piece.
 */
export function xqGenerate(board: XqEngineBoard, side: XqSide, out: number[], capturesOnly = false): void {
  const sign = xqSign(side);
  const add = (from: number, to: number): void => {
    const target = board[to] * sign;
    if (target > 0 || (capturesOnly && target === 0)) return;
    out.push(xqEncode(from, to));
  };
  for (let from = 0; from < XQ_CELLS; from++) {
    const kind = board[from] * sign;
    if (kind <= 0) continue;
    const col = XQ_COL[from];
    const row = XQ_ROW[from];
    switch (kind) {
      case XQ_GENERAL:
        for (const [dc, dr] of ORTHOGONAL) {
          if (!inside(col + dc, row + dr)) continue;
          const to = xqIndex(col + dc, row + dr);
          if (inPalace(side, to)) add(from, to);
        }
        break;
      case XQ_ADVISOR:
        for (const [dc, dr] of DIAGONAL) {
          if (!inside(col + dc, row + dr)) continue;
          const to = xqIndex(col + dc, row + dr);
          if (inPalace(side, to)) add(from, to);
        }
        break;
      case XQ_ELEPHANT:
        for (const [dc, dr] of DIAGONAL) {
          const c = col + 2 * dc;
          const r = row + 2 * dr;
          if (!inside(c, r) || !ownHalf(side, r) || board[xqIndex(col + dc, row + dr)] !== 0) continue;
          add(from, xqIndex(c, r));
        }
        break;
      case XQ_HORSE:
        for (const [dc, dr, lc, lr] of HORSE_JUMPS) {
          const c = col + dc;
          const r = row + dr;
          if (!inside(c, r) || board[xqIndex(col + lc, row + lr)] !== 0) continue;
          add(from, xqIndex(c, r));
        }
        break;
      case XQ_CHARIOT:
        for (const [dc, dr] of ORTHOGONAL) {
          for (let c = col + dc, r = row + dr; inside(c, r); c += dc, r += dr) {
            const to = xqIndex(c, r);
            add(from, to);
            if (board[to] !== 0) break;
          }
        }
        break;
      case XQ_CANNON:
        for (const [dc, dr] of ORTHOGONAL) {
          let screened = false;
          for (let c = col + dc, r = row + dr; inside(c, r); c += dc, r += dr) {
            const to = xqIndex(c, r);
            if (!screened) {
              if (board[to] === 0) {
                if (!capturesOnly) out.push(xqEncode(from, to));
              } else {
                screened = true;
              }
            } else if (board[to] !== 0) {
              if (board[to] * sign < 0) out.push(xqEncode(from, to));
              break;
            }
          }
        }
        break;
      case XQ_SOLDIER: {
        const step = forward(side);
        if (inside(col, row + step)) add(from, xqIndex(col, row + step));
        if (!ownHalf(side, row)) {
          if (col > 0) add(from, xqIndex(col - 1, row));
          if (col < XQ_COLS - 1) add(from, xqIndex(col + 1, row));
        }
        break;
      }
    }
  }
}

/** Cell of `side`'s general, or −1 when it is missing. */
export function xqGeneralCell(board: XqEngineBoard, side: XqSide): number {
  const code = xqSign(side) * XQ_GENERAL;
  const rows = side === 0 ? [7, 8, 9] : [0, 1, 2];
  for (const row of rows) {
    for (let col = 3; col <= 5; col++) {
      const index = xqIndex(col, row);
      if (board[index] === code) return index;
    }
  }
  return -1;
}

/**
 * Whether `side`'s general is attacked, including by the opposing general on an open file (flying general).
 * A side without a general counts as in check, so positions missing one are never legal to reach.
 */
export function xqInCheckEngine(board: XqEngineBoard, side: XqSide): boolean {
  const king = xqGeneralCell(board, side);
  if (king < 0) return true;
  const enemy = -xqSign(side);
  const col = XQ_COL[king];
  const row = XQ_ROW[king];
  for (const [dc, dr] of ORTHOGONAL) {
    let screened = false;
    for (let c = col + dc, r = row + dr; inside(c, r); c += dc, r += dr) {
      const piece = board[xqIndex(c, r)];
      if (piece === 0) continue;
      if (!screened) {
        if (piece === enemy * XQ_CHARIOT || (dc === 0 && piece === enemy * XQ_GENERAL)) return true;
        screened = true;
      } else {
        if (piece === enemy * XQ_CANNON) return true;
        break;
      }
    }
  }
  // A horse attacks from where its own jump lands on the general; the blocking leg sits next to the horse.
  for (const [dc, dr, lc, lr] of HORSE_JUMPS) {
    const hc = col - dc;
    const hr = row - dr;
    if (!inside(hc, hr) || board[xqIndex(hc, hr)] !== enemy * XQ_HORSE) continue;
    if (board[xqIndex(hc + lc, hr + lr)] === 0) return true;
  }
  const enemySide: XqSide = side === 0 ? 1 : 0;
  const behind = row - forward(enemySide);
  if (inside(col, behind) && board[xqIndex(col, behind)] === enemy * XQ_SOLDIER) return true;
  // Soldiers beside the general are in this side's palace, so they have crossed the river and move sideways.
  for (const dc of [-1, 1]) {
    if (inside(col + dc, row) && board[xqIndex(col + dc, row)] === enemy * XQ_SOLDIER) return true;
  }
  return false;
}

/** Legal moves of `side` as encoded engine moves; the board is restored before returning. */
export function xqLegalEngineMoves(board: XqEngineBoard, side: XqSide, capturesOnly = false): number[] {
  const pseudo: number[] = [];
  xqGenerate(board, side, pseudo, capturesOnly);
  const legal: number[] = [];
  for (const move of pseudo) {
    const from = xqFrom(move);
    const to = xqTo(move);
    const captured = board[to];
    board[to] = board[from];
    board[from] = 0;
    if (!xqInCheckEngine(board, side)) legal.push(move);
    board[from] = board[to];
    board[to] = captured;
  }
  return legal;
}

/** Whether `side` has at least one legal move; stops at the first. */
export function xqHasLegalMoveEngine(board: XqEngineBoard, side: XqSide): boolean {
  const pseudo: number[] = [];
  xqGenerate(board, side, pseudo);
  for (const move of pseudo) {
    const from = xqFrom(move);
    const to = xqTo(move);
    const captured = board[to];
    board[to] = board[from];
    board[from] = 0;
    const safe = !xqInCheckEngine(board, side);
    board[from] = board[to];
    board[to] = captured;
    if (safe) return true;
  }
  return false;
}

/** Leaf positions `depth` plies from `board` with `side` to move: the standard move-generator check. */
export function xqPerft(board: XqBoard, side: XqSide, depth: number): number {
  const engine = xqEngineBoard(board);
  const walk = (toMove: XqSide, left: number): number => {
    const moves = xqLegalEngineMoves(engine, toMove);
    if (left === 1) return moves.length;
    let total = 0;
    for (const move of moves) {
      const from = xqFrom(move);
      const to = xqTo(move);
      const captured = engine[to];
      engine[to] = engine[from];
      engine[from] = 0;
      total += walk(xqOpponent(toMove), left - 1);
      engine[from] = engine[to];
      engine[to] = captured;
    }
    return total;
  };
  return depth <= 0 ? 1 : walk(side, depth);
}

// ─── Board-level wrappers ───

export function xqLegalMoves(board: XqBoard, side: XqSide): XqMove[] {
  return xqLegalEngineMoves(xqEngineBoard(board), side).map((move) => ({ from: xqFrom(move), to: xqTo(move) }));
}

export function xqIsLegal(board: XqBoard, side: XqSide, from: number, to: number): boolean {
  const piece = board[from];
  if (!piece || xqSideOf(piece) !== side) return false;
  return xqLegalEngineMoves(xqEngineBoard(board), side).includes(xqEncode(from, to));
}

export function xqInCheck(board: XqBoard, side: XqSide): boolean {
  return xqInCheckEngine(xqEngineBoard(board), side);
}

export function xqHasLegalMove(board: XqBoard, side: XqSide): boolean {
  return xqHasLegalMoveEngine(xqEngineBoard(board), side);
}

/** Cell of `side`'s general on a board, or −1. */
export function xqGeneral(board: XqBoard, side: XqSide): number {
  return board.indexOf(xqPiece(side, 'k'));
}

/** The board after moving `from` → `to`; the caller has checked legality. */
export function xqApply(board: XqBoard, from: number, to: number): XqCell[] {
  const next = [...board];
  next[to] = next[from];
  next[from] = null;
  return next;
}

export function isXqBoard(value: unknown): value is XqBoard {
  return Array.isArray(value) && value.length === XQ_CELLS && value.every((cell) => cell === null || isXqPiece(cell));
}

// ─── Move facts for the public record ───

/**
 * Where the moved piece stood among identical own pieces on its file, from the front (the end nearer the
 * opponent): needed for 前／後 and WXF tandem notation. `crowded` marks soldiers while another file also holds
 * two or more of the side's soldiers, so the file number must stay in the notation.
 */
export interface XqLine {
  readonly order: number;
  readonly count: number;
  readonly crowded?: true;
}

export interface XqMoveFacts {
  readonly piece: XqPiece;
  readonly captured?: XqPiece;
  /** Present when the move puts the opposing general in check. */
  readonly check?: true;
  /** Present when another identical piece of the mover shares the file. */
  readonly line?: XqLine;
}

function lineOf(board: XqBoard, from: number): XqLine | undefined {
  const piece = board[from];
  if (!piece) return undefined;
  const side = xqSideOf(piece);
  const col = XQ_COL[from];
  // Front first: red advances towards row 0, black towards row 9.
  const rows = Array.from({ length: XQ_ROWS }, (_, index) => (side === 0 ? index : XQ_ROWS - 1 - index));
  const same = rows.filter((row) => board[xqIndex(col, row)] === piece);
  if (same.length < 2) return undefined;
  const order = same.indexOf(XQ_ROW[from]);
  let crowded = false;
  if (xqKindOf(piece) === 'p') {
    for (let other = 0; other < XQ_COLS && !crowded; other++) {
      if (other === col) continue;
      let count = 0;
      for (let row = 0; row < XQ_ROWS; row++) if (board[xqIndex(other, row)] === piece) count++;
      crowded = count >= 2;
    }
  }
  return { order, count: same.length, ...crowded ? { crowded: true as const } : {} };
}

/** Public facts of a legal move from `board`. */
export function xqMoveFacts(board: XqBoard, from: number, to: number): XqMoveFacts {
  const piece = board[from];
  if (!piece) throw new Error('No piece to move');
  const captured = board[to];
  const line = lineOf(board, from);
  const check = xqInCheck(xqApply(board, from, to), xqOpponent(xqSideOf(piece)));
  return {
    piece,
    ...captured ? { captured } : {},
    ...check ? { check: true as const } : {},
    ...line ? { line } : {},
  };
}

// ─── Game-ending verdicts ───

/** One played move with the facts the verdict needs. */
export interface XqPly {
  readonly from: number;
  readonly to: number;
  readonly piece: XqPiece;
  readonly captured: XqPiece | null;
  readonly check: boolean;
}

/** The verdict's view of public move records. */
export function xqPlies(log: readonly {
  readonly from: NodeId; readonly to: NodeId; readonly piece: XqPiece; readonly captured?: XqPiece; readonly check?: boolean;
}[]): XqPly[] {
  return log.map((entry) => ({
    from: xqCell(entry.from) ?? 0,
    to: xqCell(entry.to) ?? 0,
    piece: entry.piece,
    captured: entry.captured ?? null,
    check: entry.check === true,
  }));
}

/** 60 moves (120 plies) without a capture draw. */
export const XQ_NO_CAPTURE_PLIES = 120;
/** A position reached this many times (same side to move) ends the game. */
export const XQ_REPETITIONS = 3;

export type XqVerdict =
  | { readonly reason: 'checkmate' | 'stalemate' | 'perpetual-check'; readonly loser: XqSide }
  | { readonly reason: 'repetition' | 'no-capture-limit'; readonly loser: null };

const positionKey = (board: readonly XqCell[], toMove: XqSide): string =>
  `${toMove}${board.map((cell) => cell ?? '.').join('')}`;

/** Plies since the last capture (or the start). */
export function xqQuietPlies(plies: readonly XqPly[]): number {
  let quiet = 0;
  for (let index = plies.length - 1; index >= 0 && plies[index].captured === null; index--) quiet++;
  return quiet;
}

/**
 * Keys of the positions since the last capture, oldest first, ending with the current one; positions before a
 * capture can never recur because pieces never return.
 */
export function xqRecentPositions(board: XqBoard, toMove: XqSide, plies: readonly XqPly[]): string[] {
  const quiet = xqQuietPlies(plies);
  const keys: string[] = [positionKey(board, toMove)];
  const cells = [...board];
  let side = toMove;
  for (let index = plies.length - 1; index >= plies.length - quiet; index--) {
    const ply = plies[index];
    cells[ply.from] = ply.piece;
    cells[ply.to] = null;
    side = xqOpponent(side);
    keys.push(positionKey(cells, side));
  }
  return keys.reverse();
}

/**
 * How the game stands after `plies` (every move from the start) led to `board` with `toMove` to play, or null
 * while it goes on. In order: no legal move loses (checkmate, or stalemate, which also loses); the third
 * occurrence of a position loses for a side whose every move since the first occurrence gave check (perpetual
 * check) and otherwise draws; 120 plies without a capture draw.
 */
export function xqVerdict(board: XqBoard, toMove: XqSide, plies: readonly XqPly[]): XqVerdict | null {
  const engine = xqEngineBoard(board);
  if (!xqHasLegalMoveEngine(engine, toMove)) {
    return { reason: xqInCheckEngine(engine, toMove) ? 'checkmate' : 'stalemate', loser: toMove };
  }
  const keys = xqRecentPositions(board, toMove, plies);
  const current = keys.length - 1;
  const earlier = keys.flatMap((key, index) => (index < current && key === keys[current] ? [index] : []));
  if (earlier.length + 1 >= XQ_REPETITIONS) {
    // The span from the first occurrence to now holds the repeated cycles.
    const span = plies.slice(plies.length - (current - earlier[0]));
    const checking = ([0, 1] as const).filter((side) => {
      const own = span.filter((ply) => xqSideOf(ply.piece) === side);
      return own.length > 0 && own.every((ply) => ply.check);
    });
    return checking.length === 1 ? { reason: 'perpetual-check', loser: checking[0] } : { reason: 'repetition', loser: null };
  }
  return xqQuietPlies(plies) >= XQ_NO_CAPTURE_PLIES ? { reason: 'no-capture-limit', loser: null } : null;
}

// ─── Notation ───

export type XqNotationLocale = 'en' | 'zh-TW';

/** What notation reads from a move record. */
export interface XqNotationMove {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly piece: XqPiece;
  readonly line?: XqLine;
}

const RED_NAMES: Readonly<Record<XqKind, string>> = { k: '帥', a: '仕', e: '相', r: '俥', h: '傌', c: '炮', p: '兵' };
const BLACK_NAMES: Readonly<Record<XqKind, string>> = { k: '將', a: '士', e: '象', r: '車', h: '馬', c: '包', p: '卒' };
const CHINESE_NUMERALS = '一二三四五六七八九';
const WXF_LETTERS: Readonly<Record<XqKind, string>> = { k: 'K', a: 'A', e: 'E', h: 'H', r: 'R', c: 'C', p: 'P' };
/** Pieces whose forward and backward moves name the destination file instead of the distance. */
const DIAGONAL_MOVERS: readonly XqKind[] = ['a', 'e', 'h'];

/** The conventional character of a piece: 帥仕相俥傌炮兵 for red, 將士象車馬包卒 for black. */
export function xqPieceName(piece: XqPiece): string {
  const kind = xqKindOf(piece);
  return xqSideOf(piece) === 0 ? RED_NAMES[kind] : BLACK_NAMES[kind];
}

/** File number from the mover's own right: red counts from column 8, black from column 0. */
export const xqFile = (side: XqSide, col: number): number => (side === 0 ? XQ_COLS - col : col + 1);

/** Red writes Chinese numerals, black Arabic digits. */
const chineseNumber = (side: XqSide, value: number): string => (side === 0 ? CHINESE_NUMERALS[value - 1] : String(value));

function chinesePrefix(move: XqNotationMove, side: XqSide, kind: XqKind, col: number): string {
  const name = xqPieceName(move.piece);
  const line = move.line;
  if (!line) return `${name}${chineseNumber(side, xqFile(side, col))}`;
  const position = line.count === 2 ? '前後'[line.order] : line.count === 3 ? '前中後'[line.order]
    : CHINESE_NUMERALS[line.order];
  // Soldiers stacked on two files keep the file to say which one moved.
  return kind === 'p' && line.crowded ? `${position}${name}${chineseNumber(side, xqFile(side, col))}` : `${position}${name}`;
}

function wxfPrefix(move: XqNotationMove, side: XqSide, kind: XqKind, col: number): string {
  const line = move.line;
  const file = xqFile(side, col);
  if (!line) return `${WXF_LETTERS[kind]}${file}`;
  // Three or more soldiers on a file, or tandem soldiers while another file has some too, are numbered from the front.
  if (kind === 'p' && (line.count >= 3 || line.crowded)) return `${line.order + 1}${file}`;
  return `${WXF_LETTERS[kind]}${line.order === 0 ? '+' : '-'}`;
}

/**
 * Chinese notation (炮二平五, 馬8進7, 前俥進一) for `zh-TW` and WXF (C2=5, H8+7, R+=5) for `en`. Red counts files
 * from its right in Chinese numerals, black in Arabic digits; straight movers advance by points, diagonal
 * movers name the destination file.
 */
export function xqNotation(move: XqNotationMove, locale: XqNotationLocale): string | null {
  const from = xqCell(move.from);
  const to = xqCell(move.to);
  if (from === null || to === null) return null;
  const side = xqSideOf(move.piece);
  const kind = xqKindOf(move.piece);
  const fromCol = XQ_COL[from];
  const rowDelta = XQ_ROW[to] - XQ_ROW[from];
  const ahead = rowDelta * forward(side);
  const target = rowDelta === 0 || DIAGONAL_MOVERS.includes(kind) ? xqFile(side, XQ_COL[to]) : Math.abs(rowDelta);
  if (locale === 'zh-TW') {
    const action = rowDelta === 0 ? '平' : ahead > 0 ? '進' : '退';
    return `${chinesePrefix(move, side, kind, fromCol)}${action}${chineseNumber(side, target)}`;
  }
  const action = rowDelta === 0 ? '=' : ahead > 0 ? '+' : '-';
  return `${wxfPrefix(move, side, kind, fromCol)}${action}${target}`;
}
