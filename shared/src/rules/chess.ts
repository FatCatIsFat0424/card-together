// ─── Chess rules: move generation, check, game-ending verdicts, and standard algebraic notation ───
//
// Squares are row-major (`row * 8 + col`): row 0 is black's back rank (rank 8) at the top, row 7 white's (rank 1)
// at the bottom, and column 0 is the a-file. The compact engine below works on an `Int8Array` (white positive,
// black negative) so the search bot can make and unmake moves in place; the exported wrappers never mutate inputs.

import { nodeId } from './board/board-model';
import type { NodeId } from './board/board-model';

export const CHESS_COLS = 8;
export const CHESS_ROWS = 8;
export const CHESS_CELLS = CHESS_COLS * CHESS_ROWS;

/** Index into the match's two seats: side 0 plays white, sits at the bottom, and moves first. */
export type ChessSide = 0 | 1;

/** Pawn, knight, bishop, rook, queen, king; the position in this list plus one is the engine code. */
export const CHESS_KINDS = ['p', 'n', 'b', 'r', 'q', 'k'] as const;
export type ChessKind = typeof CHESS_KINDS[number];

/** Uppercase pieces are white, lowercase black (as in FEN). */
export type ChessPiece = Uppercase<ChessKind> | ChessKind;
export type ChessCell = ChessPiece | null;
export type ChessBoard = readonly ChessCell[];

export const CHESS_PROMOTIONS = ['q', 'r', 'b', 'n'] as const;
export type ChessPromotion = typeof CHESS_PROMOTIONS[number];

/** A move as square indices; `promotion` is present exactly when a pawn reaches the last rank. */
export interface ChessMove {
  readonly from: number;
  readonly to: number;
  readonly promotion?: ChessPromotion;
}

/** Remaining castling rights, named by the FEN letters (uppercase white, lowercase black). */
export interface ChessCastling {
  readonly K: boolean;
  readonly Q: boolean;
  readonly k: boolean;
  readonly q: boolean;
}

/** Everything the rules need besides the history of earlier positions. */
export interface ChessPosition {
  readonly board: ChessBoard;
  readonly turn: ChessSide;
  readonly castling: ChessCastling;
  /** The square a pawn skipped over on the previous move, whether or not a pawn can capture there. */
  readonly enPassant: number | null;
  /** Plies since the last capture or pawn move. */
  readonly halfmove: number;
}

// ─── Engine codes ───

export const CHESS_PAWN = 1;
export const CHESS_KNIGHT = 2;
export const CHESS_BISHOP = 3;
export const CHESS_ROOK = 4;
export const CHESS_QUEEN = 5;
export const CHESS_KING = 6;

/** Engine board: 0 empty, 1–6 white pawn to king, −1…−6 black. */
export type ChessEngineBoard = Int8Array;

export const CHESS_COL: readonly number[] = Array.from({ length: CHESS_CELLS }, (_, index) => index % CHESS_COLS);
export const CHESS_ROW: readonly number[] = Array.from({ length: CHESS_CELLS }, (_, index) => Math.floor(index / CHESS_COLS));

export const chessIndex = (col: number, row: number): number => row * CHESS_COLS + col;
export const chessOpponent = (side: ChessSide): ChessSide => (side === 0 ? 1 : 0);
/** +1 for white, −1 for black: the sign of the side's engine codes. */
export const chessSign = (side: ChessSide): 1 | -1 => (side === 0 ? 1 : -1);

export function chessSideOf(piece: ChessPiece): ChessSide {
  return piece === piece.toUpperCase() ? 0 : 1;
}

export function chessKindOf(piece: ChessPiece): ChessKind {
  return piece.toLowerCase() as ChessKind;
}

export function chessPiece(side: ChessSide, kind: ChessKind): ChessPiece {
  return (side === 0 ? kind.toUpperCase() : kind) as ChessPiece;
}

/** Signed engine code of a piece. */
export function chessCode(piece: ChessPiece): number {
  return chessSign(chessSideOf(piece)) * (CHESS_KINDS.indexOf(chessKindOf(piece)) + 1);
}

export function chessPieceOfCode(code: number): ChessPiece | null {
  return code === 0 ? null : chessPiece(code > 0 ? 0 : 1, CHESS_KINDS[Math.abs(code) - 1]);
}

export function isChessPiece(value: unknown): value is ChessPiece {
  return typeof value === 'string' && /^[pnbrqkPNBRQK]$/.test(value);
}

export function isChessBoard(value: unknown): value is ChessBoard {
  return Array.isArray(value) && value.length === CHESS_CELLS && value.every((cell) => cell === null || isChessPiece(cell));
}

/** Board node of a square index; ids are `col,row` with row 0 at the top (rank 8). */
export const chessNode = (index: number): NodeId => nodeId(index % CHESS_COLS, Math.floor(index / CHESS_COLS));

/** Square index of a board node id, or null when it is not a chess square. */
export function chessCell(node: unknown): number | null {
  if (typeof node !== 'string') return null;
  const match = /^([0-7]),([0-7])$/.exec(node);
  return match ? chessIndex(Number(match[1]), Number(match[2])) : null;
}

/** Algebraic name of a square: index 0 is `a8`, 63 is `h1`. */
export const chessSquareName = (index: number): string =>
  `${String.fromCharCode(97 + (index % CHESS_COLS))}${CHESS_ROWS - Math.floor(index / CHESS_COLS)}`;

export function chessEngineBoard(board: ChessBoard): ChessEngineBoard {
  return Int8Array.from(board, (cell) => (cell === null ? 0 : chessCode(cell)));
}

export function chessBoardOf(engine: ChessEngineBoard): ChessCell[] {
  return Array.from(engine, (code) => chessPieceOfCode(code));
}

// ─── Start position ───

const BACK_RANK: readonly ChessKind[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

export function chessInitialBoard(): ChessBoard {
  const board: ChessCell[] = new Array<ChessCell>(CHESS_CELLS).fill(null);
  for (let col = 0; col < CHESS_COLS; col++) {
    board[chessIndex(col, 0)] = chessPiece(1, BACK_RANK[col]);
    board[chessIndex(col, 1)] = 'p';
    board[chessIndex(col, 6)] = 'P';
    board[chessIndex(col, 7)] = chessPiece(0, BACK_RANK[col]);
  }
  return board;
}

export function chessInitialPosition(): ChessPosition {
  return {
    board: chessInitialBoard(), turn: 0, castling: { K: true, Q: true, k: true, q: true }, enPassant: null, halfmove: 0,
  };
}

// ─── Engine ───

/** A mutable position for make/unmake search; `enPassant` is −1 when absent. */
export interface ChessEngine {
  readonly board: ChessEngineBoard;
  turn: ChessSide;
  /** Bit mask: 1 white kingside, 2 white queenside, 4 black kingside, 8 black queenside. */
  castling: number;
  enPassant: number;
  halfmove: number;
  /** Each side's king square, or −1 without a king. */
  readonly kings: [number, number];
}

const CASTLE_WK = 1;
const CASTLE_WQ = 2;
const CASTLE_BK = 4;
const CASTLE_BQ = 8;

/** Rights lost when a move starts from or lands on the square. */
const CASTLE_LOSS: Uint8Array = (() => {
  const table = new Uint8Array(CHESS_CELLS);
  table[60] = CASTLE_WK | CASTLE_WQ;
  table[63] = CASTLE_WK;
  table[56] = CASTLE_WQ;
  table[4] = CASTLE_BK | CASTLE_BQ;
  table[7] = CASTLE_BK;
  table[0] = CASTLE_BQ;
  return table;
})();

function castlingMask(castling: ChessCastling): number {
  return (castling.K ? CASTLE_WK : 0) | (castling.Q ? CASTLE_WQ : 0) | (castling.k ? CASTLE_BK : 0) | (castling.q ? CASTLE_BQ : 0);
}

function castlingOf(mask: number): ChessCastling {
  return { K: (mask & CASTLE_WK) !== 0, Q: (mask & CASTLE_WQ) !== 0, k: (mask & CASTLE_BK) !== 0, q: (mask & CASTLE_BQ) !== 0 };
}

export function chessEngine(position: ChessPosition): ChessEngine {
  const board = chessEngineBoard(position.board);
  const kings: [number, number] = [board.indexOf(CHESS_KING), board.indexOf(-CHESS_KING)];
  return {
    board, turn: position.turn, castling: castlingMask(position.castling), enPassant: position.enPassant ?? -1,
    halfmove: position.halfmove, kings,
  };
}

export function chessPositionOf(engine: ChessEngine): ChessPosition {
  return {
    board: chessBoardOf(engine.board), turn: engine.turn, castling: castlingOf(engine.castling),
    enPassant: engine.enPassant < 0 ? null : engine.enPassant, halfmove: engine.halfmove,
  };
}

/** Moves are packed as `from | to << 6 | promotionCode << 12`, where the code is the promoted piece's (2–5). */
export const chessEncode = (from: number, to: number, promotion = 0): number => from | (to << 6) | (promotion << 12);
export const chessFrom = (move: number): number => move & 63;
export const chessTo = (move: number): number => (move >> 6) & 63;
/** Engine code (2–5) of the promoted piece, or 0 for a move without promotion. */
export const chessPromotionCode = (move: number): number => (move >> 12) & 7;

const PROMOTION_KIND: Readonly<Record<number, ChessPromotion>> = {
  [CHESS_QUEEN]: 'q', [CHESS_ROOK]: 'r', [CHESS_BISHOP]: 'b', [CHESS_KNIGHT]: 'n',
};
const PROMOTION_CODE: Readonly<Record<ChessPromotion, number>> = {
  q: CHESS_QUEEN, r: CHESS_ROOK, b: CHESS_BISHOP, n: CHESS_KNIGHT,
};

export function chessDecode(move: number): ChessMove {
  const promotion = chessPromotionCode(move);
  return promotion === 0
    ? { from: chessFrom(move), to: chessTo(move) }
    : { from: chessFrom(move), to: chessTo(move), promotion: PROMOTION_KIND[promotion] };
}

export const chessEncodeMove = (move: ChessMove): number =>
  chessEncode(move.from, move.to, move.promotion ? PROMOTION_CODE[move.promotion] : 0);

// Direction offsets as [dc, dr]; the first four are straight, the last four diagonal.
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1],
];
const KNIGHT_JUMPS: readonly (readonly [number, number])[] = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];

function targets(offsets: readonly (readonly [number, number])[]): Int8Array[] {
  return Array.from({ length: CHESS_CELLS }, (_, square) => {
    const list: number[] = [];
    for (const [dc, dr] of offsets) {
      const col = (square % CHESS_COLS) + dc;
      const row = Math.floor(square / CHESS_COLS) + dr;
      if (col >= 0 && col < CHESS_COLS && row >= 0 && row < CHESS_ROWS) list.push(chessIndex(col, row));
    }
    return Int8Array.from(list);
  });
}

const KNIGHT_TARGETS = targets(KNIGHT_JUMPS);
const KING_TARGETS = targets(DIRECTIONS);
/** `RAYS[direction][square]`: the squares met walking away from `square`, nearest first. */
const RAYS: Int8Array[][] = DIRECTIONS.map(([dc, dr]) => Array.from({ length: CHESS_CELLS }, (_, square) => {
  const list: number[] = [];
  let col = (square % CHESS_COLS) + dc;
  let row = Math.floor(square / CHESS_COLS) + dr;
  while (col >= 0 && col < CHESS_COLS && row >= 0 && row < CHESS_ROWS) {
    list.push(chessIndex(col, row));
    col += dc;
    row += dr;
  }
  return Int8Array.from(list);
}));

/** True when a piece of `by` attacks `square` (ignoring pins). */
export function chessAttacked(board: ChessEngineBoard, square: number, by: ChessSide): boolean {
  const sign = chessSign(by);
  const col = square & 7;
  const row = square >> 3;
  // White pawns attack towards row 0, so the attacker stands one row below the target; black the other way.
  const pawnRow = by === 0 ? row + 1 : row - 1;
  if (pawnRow >= 0 && pawnRow < CHESS_ROWS) {
    if (col > 0 && board[pawnRow * 8 + col - 1] === sign * CHESS_PAWN) return true;
    if (col < 7 && board[pawnRow * 8 + col + 1] === sign * CHESS_PAWN) return true;
  }
  for (const target of KNIGHT_TARGETS[square]) if (board[target] === sign * CHESS_KNIGHT) return true;
  for (const target of KING_TARGETS[square]) if (board[target] === sign * CHESS_KING) return true;
  for (let direction = 0; direction < 8; direction++) {
    const slider = sign * (direction < 4 ? CHESS_ROOK : CHESS_BISHOP);
    for (const target of RAYS[direction][square]) {
      const piece = board[target];
      if (piece === 0) continue;
      if (piece === slider || piece === sign * CHESS_QUEEN) return true;
      break;
    }
  }
  return false;
}

export function chessInCheckEngine(engine: ChessEngine, side: ChessSide): boolean {
  const king = engine.kings[side];
  return king >= 0 && chessAttacked(engine.board, king, chessOpponent(side));
}

/**
 * Pseudo-legal moves of the side to move (own king may be left in check). With `capturesOnly`, only captures,
 * en passant, and queen promotions: the moves a quiescence search needs.
 */
export function chessGenerate(engine: ChessEngine, out: number[], capturesOnly = false): void {
  const { board } = engine;
  const side = engine.turn;
  const sign = chessSign(side);
  const forward = side === 0 ? -8 : 8;
  const startRow = side === 0 ? 6 : 1;
  const lastRow = side === 0 ? 0 : 7;
  for (let from = 0; from < CHESS_CELLS; from++) {
    const piece = board[from] * sign;
    if (piece <= 0) continue;
    const col = from & 7;
    const row = from >> 3;
    switch (piece) {
      case CHESS_PAWN: {
        const addPawn = (to: number): void => {
          if (to >> 3 !== lastRow) {
            out.push(chessEncode(from, to));
          } else if (capturesOnly) {
            out.push(chessEncode(from, to, CHESS_QUEEN));
          } else {
            out.push(chessEncode(from, to, CHESS_QUEEN), chessEncode(from, to, CHESS_ROOK),
              chessEncode(from, to, CHESS_BISHOP), chessEncode(from, to, CHESS_KNIGHT));
          }
        };
        for (const dc of [-1, 1]) {
          if (col + dc < 0 || col + dc > 7) continue;
          const to = from + forward + dc;
          if (board[to] * sign < 0) addPawn(to);
          else if (board[to] === 0 && to === engine.enPassant) out.push(chessEncode(from, to));
        }
        const one = from + forward;
        if (board[one] === 0) {
          if (!capturesOnly || one >> 3 === lastRow) addPawn(one);
          if (!capturesOnly && row === startRow && board[one + forward] === 0) out.push(chessEncode(from, one + forward));
        }
        break;
      }
      case CHESS_KNIGHT:
      case CHESS_KING: {
        for (const to of piece === CHESS_KNIGHT ? KNIGHT_TARGETS[from] : KING_TARGETS[from]) {
          const target = board[to] * sign;
          if (target > 0 || (capturesOnly && target === 0)) continue;
          out.push(chessEncode(from, to));
        }
        if (piece === CHESS_KING && !capturesOnly) generateCastles(engine, from, out);
        break;
      }
      default: {
        const first = piece === CHESS_BISHOP ? 4 : 0;
        const last = piece === CHESS_ROOK ? 4 : 8;
        for (let direction = first; direction < last; direction++) {
          for (const to of RAYS[direction][from]) {
            const target = board[to] * sign;
            if (target > 0) break;
            if (target < 0) {
              out.push(chessEncode(from, to));
              break;
            }
            if (!capturesOnly) out.push(chessEncode(from, to));
          }
        }
      }
    }
  }
}

/** Castling needs the rights, a clear path, and a king that is not in check or crossing an attacked square. */
function generateCastles(engine: ChessEngine, from: number, out: number[]): void {
  const side = engine.turn;
  const home = side === 0 ? 60 : 4;
  if (from !== home) return;
  const { board } = engine;
  const foe = chessOpponent(side);
  const rook = chessSign(side) * CHESS_ROOK;
  const kingside = side === 0 ? CASTLE_WK : CASTLE_BK;
  const queenside = side === 0 ? CASTLE_WQ : CASTLE_BQ;
  if ((engine.castling & (kingside | queenside)) === 0 || chessAttacked(board, home, foe)) return;
  if ((engine.castling & kingside) !== 0 && board[home + 3] === rook && board[home + 1] === 0 && board[home + 2] === 0
    && !chessAttacked(board, home + 1, foe)) {
    out.push(chessEncode(home, home + 2));
  }
  if ((engine.castling & queenside) !== 0 && board[home - 4] === rook && board[home - 1] === 0 && board[home - 2] === 0
    && board[home - 3] === 0 && !chessAttacked(board, home - 1, foe)) {
    out.push(chessEncode(home, home - 2));
  }
}

/**
 * Plays a pseudo-legal move in place and returns the packed state `chessUnmake` needs to take it back:
 * captured piece, castling rights, en-passant square, and halfmove clock.
 */
export function chessMake(engine: ChessEngine, move: number): number {
  const { board } = engine;
  const from = chessFrom(move);
  const to = chessTo(move);
  const promotion = chessPromotionCode(move);
  const piece = board[from];
  const captured = board[to];
  const undo = (captured + 8) | (engine.castling << 4) | ((engine.enPassant + 1) << 8) | (engine.halfmove << 15);
  const side = engine.turn;
  const kind = Math.abs(piece);
  let enPassant = -1;
  let irreversible = captured !== 0;
  board[to] = piece;
  if (kind === CHESS_PAWN) {
    irreversible = true;
    if (captured === 0 && (from & 7) !== (to & 7)) board[to + (side === 0 ? 8 : -8)] = 0;
    else if (Math.abs(to - from) === 16) enPassant = (from + to) >> 1;
    if (promotion !== 0) board[to] = chessSign(side) * promotion;
  } else if (kind === CHESS_KING) {
    engine.kings[side] = to;
    if (to - from === 2) {
      board[from + 1] = board[from + 3];
      board[from + 3] = 0;
    } else if (from - to === 2) {
      board[from - 1] = board[from - 4];
      board[from - 4] = 0;
    }
  }
  board[from] = 0;
  engine.castling &= ~(CASTLE_LOSS[from] | CASTLE_LOSS[to]);
  engine.enPassant = enPassant;
  engine.halfmove = irreversible ? 0 : engine.halfmove + 1;
  engine.turn = chessOpponent(side);
  return undo;
}

export function chessUnmake(engine: ChessEngine, move: number, undo: number): void {
  const { board } = engine;
  const from = chessFrom(move);
  const to = chessTo(move);
  const side = chessOpponent(engine.turn);
  const captured = (undo & 15) - 8;
  const moved = chessPromotionCode(move) !== 0 ? chessSign(side) * CHESS_PAWN : board[to];
  board[from] = moved;
  board[to] = captured;
  const kind = Math.abs(moved);
  if (kind === CHESS_PAWN) {
    if (captured === 0 && (from & 7) !== (to & 7)) board[to + (side === 0 ? 8 : -8)] = -chessSign(side) * CHESS_PAWN;
  } else if (kind === CHESS_KING) {
    engine.kings[side] = from;
    if (to - from === 2) {
      board[from + 3] = board[from + 1];
      board[from + 1] = 0;
    } else if (from - to === 2) {
      board[from - 4] = board[from - 1];
      board[from - 1] = 0;
    }
  }
  engine.castling = (undo >> 4) & 15;
  engine.enPassant = ((undo >> 8) & 127) - 1;
  engine.halfmove = undo >> 15;
  engine.turn = side;
}

/** Legal moves of the side to move; the engine is restored before returning. */
export function chessLegalEngineMoves(engine: ChessEngine, capturesOnly = false): number[] {
  const side = engine.turn;
  const pseudo: number[] = [];
  chessGenerate(engine, pseudo, capturesOnly);
  const legal: number[] = [];
  for (const move of pseudo) {
    const undo = chessMake(engine, move);
    if (!chessInCheckEngine(engine, side)) legal.push(move);
    chessUnmake(engine, move, undo);
  }
  return legal;
}

export function chessHasLegalMoveEngine(engine: ChessEngine): boolean {
  const side = engine.turn;
  const pseudo: number[] = [];
  chessGenerate(engine, pseudo);
  for (const move of pseudo) {
    const undo = chessMake(engine, move);
    const safe = !chessInCheckEngine(engine, side);
    chessUnmake(engine, move, undo);
    if (safe) return true;
  }
  return false;
}

/** Number of leaf positions `depth` plies ahead: the standard check of a move generator. */
export function chessPerft(position: ChessPosition, depth: number): number {
  const engine = chessEngine(position);
  const walk = (remaining: number): number => {
    const moves = chessLegalEngineMoves(engine);
    if (remaining <= 1) return moves.length;
    let total = 0;
    for (const move of moves) {
      const undo = chessMake(engine, move);
      total += walk(remaining - 1);
      chessUnmake(engine, move, undo);
    }
    return total;
  };
  return depth <= 0 ? 1 : walk(depth);
}

// ─── Public wrappers ───

export function chessLegalMoves(position: ChessPosition): ChessMove[] {
  return chessLegalEngineMoves(chessEngine(position)).map(chessDecode);
}

export function chessIsLegal(position: ChessPosition, move: ChessMove): boolean {
  const code = chessEncodeMove(move);
  return chessLegalEngineMoves(chessEngine(position)).includes(code);
}

export function chessInCheck(position: ChessPosition, side: ChessSide = position.turn): boolean {
  return chessInCheckEngine(chessEngine(position), side);
}

export function chessHasLegalMove(position: ChessPosition): boolean {
  return chessHasLegalMoveEngine(chessEngine(position));
}

/** The position after `move`; the caller has checked legality. */
export function chessApply(position: ChessPosition, move: ChessMove): ChessPosition {
  const engine = chessEngine(position);
  chessMake(engine, chessEncodeMove(move));
  return chessPositionOf(engine);
}

/** Replays `moves` (all legal) from `start`, returning the final position and the keys of every earlier one. */
export function chessReplay(
  moves: readonly ChessMove[], start: ChessPosition = chessInitialPosition(),
): { position: ChessPosition; history: string[] } {
  let position = start;
  const history: string[] = [];
  for (const move of moves) {
    if (!chessIsLegal(position, move)) throw new Error(`Illegal move ${chessSquareName(move.from)}${chessSquareName(move.to)}`);
    history.push(chessPositionKey(position));
    position = chessApply(position, move);
  }
  return { position, history };
}

// ─── Game-ending verdicts ───

/** 50 moves by each side (100 plies) without a capture or pawn move draw. */
export const CHESS_FIFTY_MOVE_PLIES = 100;
/** A position reached this many times (same side to move and rights) draws. */
export const CHESS_REPETITIONS = 3;

export type ChessVerdict =
  | { readonly reason: 'checkmate'; readonly loser: ChessSide }
  | { readonly reason: 'stalemate' | 'repetition' | 'fifty-move' | 'insufficient-material'; readonly loser: null };

/**
 * Identity of a position for repetition: pieces, side to move, castling rights, and the en-passant square only
 * when a legal capture there exists.
 */
export function chessPositionKey(position: ChessPosition): string {
  const rights = castlingOf(castlingMask(position.castling));
  const castling = `${rights.K ? 'K' : ''}${rights.Q ? 'Q' : ''}${rights.k ? 'k' : ''}${rights.q ? 'q' : ''}` || '-';
  let enPassant = '-';
  if (position.enPassant !== null) {
    const target = position.enPassant;
    const capturable = chessLegalMoves(position).some((move) => move.to === target
      && chessKindOf(position.board[move.from]!) === 'p' && move.from % CHESS_COLS !== target % CHESS_COLS);
    if (capturable) enPassant = chessSquareName(target);
  }
  return `${position.board.map((cell) => cell ?? '.').join('')} ${position.turn} ${castling} ${enPassant}`;
}

/** No sequence of legal moves can mate: bare kings, a single minor piece, or only same-coloured bishops. */
export function chessInsufficientMaterial(board: ChessBoard): boolean {
  const bishopColours = new Set<number>();
  let minors = 0;
  let knights = 0;
  for (let square = 0; square < CHESS_CELLS; square++) {
    const cell = board[square];
    if (cell === null) continue;
    const kind = chessKindOf(cell);
    if (kind === 'k') continue;
    if (kind !== 'n' && kind !== 'b') return false;
    minors++;
    if (kind === 'n') knights++;
    else bishopColours.add((CHESS_COL[square] + CHESS_ROW[square]) % 2);
  }
  return minors <= 1 || (knights === 0 && bishopColours.size === 1);
}

/**
 * How the game stands at `position`, given the keys of the positions that came before it, or null while it goes
 * on. In order: no legal move is checkmate (a loss) or stalemate (a draw); then insufficient material, threefold
 * repetition, and the fifty-move rule, all automatic draws.
 */
export function chessVerdict(position: ChessPosition, history: readonly string[]): ChessVerdict | null {
  const engine = chessEngine(position);
  if (!chessHasLegalMoveEngine(engine)) {
    return chessInCheckEngine(engine, position.turn)
      ? { reason: 'checkmate', loser: position.turn }
      : { reason: 'stalemate', loser: null };
  }
  if (chessInsufficientMaterial(position.board)) return { reason: 'insufficient-material', loser: null };
  const key = chessPositionKey(position);
  let seen = 1;
  for (const earlier of history) if (earlier === key) seen++;
  if (seen >= CHESS_REPETITIONS) return { reason: 'repetition', loser: null };
  return position.halfmove >= CHESS_FIFTY_MOVE_PLIES ? { reason: 'fifty-move', loser: null } : null;
}

// ─── Notation and move facts ───

const SAN_LETTER: Readonly<Record<ChessKind, string>> = { p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

/** Public facts of a legal move, enough to draw it, describe it, and write it down. */
export interface ChessMoveFacts {
  readonly piece: ChessPiece;
  /** For en passant, the pawn taken (which is not on the target square). */
  readonly captured?: ChessPiece;
  readonly promotion?: ChessPromotion;
  readonly castle?: 'k' | 'q';
  readonly enPassant?: true;
  /** Present when the move gives check, including checkmate. */
  readonly check?: true;
  readonly checkmate?: true;
  /** Standard algebraic notation (SAN) in English piece letters. */
  readonly san: string;
}

/** Facts and SAN of `move` in `position`; throws when the move is illegal. */
export function chessMoveFacts(position: ChessPosition, move: ChessMove): ChessMoveFacts {
  const engine = chessEngine(position);
  const code = chessEncodeMove(move);
  const legal = chessLegalEngineMoves(engine);
  if (!legal.includes(code)) throw new Error('Illegal move');
  const { from, to } = move;
  const piece = position.board[from]!;
  const kind = chessKindOf(piece);
  const side = chessSideOf(piece);
  const enPassant = kind === 'p' && position.board[to] === null && from % CHESS_COLS !== to % CHESS_COLS;
  const taken = enPassant ? chessPiece(chessOpponent(side), 'p') : position.board[to];
  const castle = kind === 'k' && Math.abs(to - from) === 2 ? (to > from ? 'k' : 'q') : undefined;

  const undo = chessMake(engine, code);
  const check = chessInCheckEngine(engine, engine.turn);
  const checkmate = check && !chessHasLegalMoveEngine(engine);
  chessUnmake(engine, code, undo);

  let san: string;
  if (castle) {
    san = castle === 'k' ? 'O-O' : 'O-O-O';
  } else if (kind === 'p') {
    san = `${taken ? String.fromCharCode(97 + (from % CHESS_COLS)) + 'x' : ''}${chessSquareName(to)}${move.promotion ? `=${move.promotion.toUpperCase()}` : ''}`;
  } else {
    const rivals = legal.filter((other) => chessTo(other) === to && chessFrom(other) !== from && position.board[chessFrom(other)] === piece);
    let origin = '';
    if (rivals.length > 0) {
      const sameFile = rivals.some((other) => chessFrom(other) % CHESS_COLS === from % CHESS_COLS);
      const sameRank = rivals.some((other) => Math.floor(chessFrom(other) / CHESS_COLS) === Math.floor(from / CHESS_COLS));
      const name = chessSquareName(from);
      origin = !sameFile ? name[0] : !sameRank ? name[1] : name;
    }
    san = `${SAN_LETTER[kind]}${origin}${taken ? 'x' : ''}${chessSquareName(to)}`;
  }
  san += checkmate ? '#' : check ? '+' : '';
  return {
    piece,
    ...taken ? { captured: taken } : {},
    ...move.promotion ? { promotion: move.promotion } : {},
    ...castle ? { castle } : {},
    ...enPassant ? { enPassant: true as const } : {},
    ...check ? { check: true as const } : {},
    ...checkmate ? { checkmate: true as const } : {},
    san,
  };
}

/** Standard algebraic notation of a legal move. */
export const chessSan = (position: ChessPosition, move: ChessMove): string => chessMoveFacts(position, move).san;
