// ─── Chess evaluation: tapered middlegame/endgame terms over a tunable weight vector ───
//
// Every term is a count times one weight pair (middlegame, endgame), so the score is linear in the weights and
// `scripts/board-bot-tuning` can fit them by logistic regression on self-play results (Texel tuning). The same
// function fills a trace of those counts for the tuner, which keeps training and play on one definition.

import * as chessRules from '@shared/rules/chess';
import type { ChessBoardState } from './chess-engine';
import * as chessEngine from './chess-engine';
import { CHESS_TUNED_WEIGHTS } from './chess-eval-weights';

// Imported bindings are read once into module constants: under the CommonJS loader every use of an imported
// binding is a getter call, which costs measurably in the search's inner loops.
const { CHESS_BISHOP, CHESS_KING, CHESS_KNIGHT, CHESS_PAWN, CHESS_QUEEN, CHESS_ROOK } = chessRules;
const { KING_STEPS, KNIGHT_STEPS, RAY, RAY_LENGTH } = chessEngine;

// ─── Weight layout: each parameter is a (middlegame, endgame) pair ───

let parameters = 0;
const block = (size: number): number => {
  const start = parameters;
  parameters += size;
  return start;
};

/** Pawn to queen, by engine code − 1. */
const P_MATERIAL = block(5);
/** Piece-square tables by kind (pawn to king) on 32 squares: own rank (0 = back rank) × file folded to a–d. */
const P_PST = block(6 * 32);
const P_MOBILITY_KNIGHT = block(9);
const P_MOBILITY_BISHOP = block(14);
const P_MOBILITY_ROOK = block(15);
const P_MOBILITY_QUEEN = block(28);
/** By own rank (1–6). */
const P_PASSED = block(8);
/** Passed pawn whose stop square is empty, by own rank. */
const P_PASSED_FREE = block(8);
/** King distances to a passed pawn's stop square, times its rank − 1. */
const P_PASSED_OWN_KING = block(1);
const P_PASSED_ENEMY_KING = block(1);
const P_DOUBLED = block(1);
const P_ISOLATED = block(1);
/** Pawn with a neighbour on the same rank, by own rank. */
const P_PHALANX = block(8);
/** Pawn defended by a pawn, by own rank. */
const P_SUPPORTED = block(8);
const P_ROOK_OPEN = block(1);
const P_ROOK_SEMI_OPEN = block(1);
const P_ROOK_SEVENTH = block(1);
const P_BISHOP_PAIR = block(1);
const P_KNIGHT_OUTPOST = block(1);
const P_BISHOP_OUTPOST = block(1);
const P_SHIELD_NEAR = block(1);
const P_SHIELD_FAR = block(1);
const P_KING_OPEN_FILE = block(1);
/** Attack on the enemy king zone by its weight (0–39). */
const P_KING_ATTACK = block(40);
/** Knight to queen attacked by an enemy pawn, by kind − 2. */
const P_PAWN_THREAT = block(4);
/** Enemy piece attacked and not defended, by kind − 1 (pawn to queen). */
const P_HANGING = block(5);
const P_TEMPO = block(1);

/** Number of (middlegame, endgame) parameter pairs. */
export const CHESS_EVAL_PARAMETERS = parameters;
/** Trace slots after the parameter counts: game phase (0–24), endgame scale (of 128), and an untuned extra. */
export const CHESS_TRACE_PHASE = parameters;
export const CHESS_TRACE_SCALE = parameters + 1;
export const CHESS_TRACE_EXTRA = parameters + 2;
export const CHESS_TRACE_SIZE = parameters + 3;

// ─── Starting weights (hand-set; the tuner refines them) ───

// Diagrams from white's side, first row rank 8; folded onto files a–d by averaging the mirror files.
const PAWN_DIAGRAM = [
  0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
];
const KNIGHT_DIAGRAM = [
  -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
];
const BISHOP_DIAGRAM = [
  -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20,
];
const ROOK_DIAGRAM = [
  0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
];
const QUEEN_DIAGRAM = [
  -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
];
const KING_MIDDLE_DIAGRAM = [
  -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
];
const KING_END_DIAGRAM = [
  -50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50,
];

/** Folded 32-entry table of a diagram: own rank (0 = rank 1) × file bucket. */
function fold(diagram: readonly number[]): number[] {
  const table: number[] = [];
  for (let rank = 0; rank < 8; rank++) {
    const row = 7 - rank;
    for (let bucket = 0; bucket < 4; bucket++) {
      table.push(Math.round((diagram[row * 8 + bucket] + diagram[row * 8 + 7 - bucket]) / 2));
    }
  }
  return table;
}

/** The hand-set weights the tuner starts from: `[mg0, eg0, mg1, eg1, …]`. */
export function chessDefaultWeights(): number[] {
  const weights = new Array<number>(CHESS_EVAL_PARAMETERS * 2).fill(0);
  const set = (index: number, middle: number, end: number): void => {
    weights[index * 2] = middle;
    weights[index * 2 + 1] = end;
  };
  [[85, 110], [330, 300], [345, 315], [470, 530], [1000, 960]].forEach(([middle, end], index) => set(P_MATERIAL + index, middle, end));
  const tables = [PAWN_DIAGRAM, KNIGHT_DIAGRAM, BISHOP_DIAGRAM, ROOK_DIAGRAM, QUEEN_DIAGRAM].map(fold);
  tables.forEach((table, kind) => table.forEach((value, square) => set(P_PST + kind * 32 + square, value, value)));
  const kingMiddle = fold(KING_MIDDLE_DIAGRAM);
  const kingEnd = fold(KING_END_DIAGRAM);
  for (let square = 0; square < 32; square++) set(P_PST + 5 * 32 + square, kingMiddle[square], kingEnd[square]);
  for (let count = 0; count < 9; count++) set(P_MOBILITY_KNIGHT + count, (count - 4) * 4, (count - 4) * 4);
  for (let count = 0; count < 14; count++) set(P_MOBILITY_BISHOP + count, (count - 6) * 5, (count - 6) * 5);
  for (let count = 0; count < 15; count++) set(P_MOBILITY_ROOK + count, (count - 7) * 2, (count - 7) * 4);
  for (let count = 0; count < 28; count++) set(P_MOBILITY_QUEEN + count, count - 13, (count - 13) * 2);
  const passedMiddle = [0, 5, 10, 15, 30, 50, 80, 0];
  const passedEnd = [0, 10, 15, 30, 55, 90, 140, 0];
  for (let rank = 0; rank < 8; rank++) {
    set(P_PASSED + rank, passedMiddle[rank], passedEnd[rank]);
    set(P_PASSED_FREE + rank, 0, rank * 5);
    set(P_PHALANX + rank, [0, 3, 5, 8, 15, 25, 40, 0][rank], [0, 2, 4, 6, 12, 20, 30, 0][rank]);
    set(P_SUPPORTED + rank, [0, 5, 7, 10, 15, 25, 30, 0][rank], [0, 4, 6, 8, 12, 20, 25, 0][rank]);
  }
  set(P_PASSED_OWN_KING, 0, -2);
  set(P_PASSED_ENEMY_KING, 0, 4);
  set(P_DOUBLED, -10, -20);
  set(P_ISOLATED, -10, -12);
  set(P_ROOK_OPEN, 30, 10);
  set(P_ROOK_SEMI_OPEN, 12, 8);
  set(P_ROOK_SEVENTH, 15, 25);
  set(P_BISHOP_PAIR, 30, 50);
  set(P_KNIGHT_OUTPOST, 25, 10);
  set(P_BISHOP_OUTPOST, 15, 5);
  set(P_SHIELD_NEAR, 12, 0);
  set(P_SHIELD_FAR, 6, 0);
  set(P_KING_OPEN_FILE, -20, 0);
  for (let units = 0; units < 40; units++) set(P_KING_ATTACK + units, Math.round(Math.min(units * units / 2.5, 500)), 0);
  [[45, 35], [45, 35], [60, 45], [70, 55]].forEach(([middle, end], index) => set(P_PAWN_THREAT + index, middle, end));
  [[5, 10], [20, 20], [20, 20], [30, 30], [40, 40]].forEach(([middle, end], index) => set(P_HANGING + index, middle, end));
  set(P_TEMPO, 15, 5);
  return weights;
}

// ─── Active weights and derived tables ───

const MIDDLE = new Int32Array(CHESS_EVAL_PARAMETERS);
const END = new Int32Array(CHESS_EVAL_PARAMETERS);
/** Material plus piece-square value per `(code + 6) * 64 + square`, white positive. */
const PSQ_MIDDLE = new Int32Array(13 * 64);
const PSQ_END = new Int32Array(13 * 64);

/** Installs a weight vector (used by the tuner; play uses the committed tuned weights). */
export function chessSetWeights(weights: readonly number[]): void {
  if (weights.length !== CHESS_EVAL_PARAMETERS * 2) throw new Error('Chess weight vector has the wrong length');
  for (let index = 0; index < CHESS_EVAL_PARAMETERS; index++) {
    MIDDLE[index] = Math.round(weights[index * 2]);
    END[index] = Math.round(weights[index * 2 + 1]);
  }
  for (let code = -6; code <= 6; code++) {
    if (code === 0) continue;
    const kind = code > 0 ? code : -code;
    const sign = code > 0 ? 1 : -1;
    for (let square = 0; square < 64; square++) {
      const entry = pstIndex(code > 0 ? 0 : 1, square);
      const material = kind === CHESS_KING ? 0 : 1;
      PSQ_MIDDLE[(code + 6) * 64 + square] = sign * (material * MIDDLE[P_MATERIAL + kind - 1] + MIDDLE[P_PST + (kind - 1) * 32 + entry]);
      PSQ_END[(code + 6) * 64 + square] = sign * (material * END[P_MATERIAL + kind - 1] + END[P_PST + (kind - 1) * 32 + entry]);
    }
  }
}

/** The tuned weights when they match the layout, otherwise the hand-set ones. */
export function chessActiveWeights(): number[] {
  return CHESS_TUNED_WEIGHTS.length === CHESS_EVAL_PARAMETERS * 2 ? [...CHESS_TUNED_WEIGHTS] : chessDefaultWeights();
}


// ─── Geometry helpers ───

/** Rank seen from `side`: 0 is its back rank, 7 the promotion rank. */
const ownRank = (side: number, square: number): number => (side === 0 ? 7 - (square >> 3) : square >> 3);
function pstIndex(side: number, square: number): number {
  const file = square & 7;
  return ownRank(side, square) * 4 + (file < 4 ? file : 7 - file);
}
const distance = (a: number, b: number): number => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));
const centreDistance = (square: number): number =>
  Math.max(3 - (square & 7), (square & 7) - 4) + Math.max(3 - (square >> 3), (square >> 3) - 4);

/** `KING_ZONE[(side * 64 + king) * 64 + square]`: 2 next to the king, 1 two ranks ahead of it, else 0. */
const KING_ZONE: Uint8Array = (() => {
  const zone = new Uint8Array(2 * 64 * 64);
  for (let side = 0; side < 2; side++) {
    for (let king = 0; king < 64; king++) {
      for (let square = 0; square < 64; square++) {
        const near = distance(king, square) <= 1;
        const ahead = Math.abs((square & 7) - (king & 7)) <= 1 && (square >> 3) === (king >> 3) + (side === 0 ? -2 : 2);
        zone[(side * 64 + king) * 64 + square] = near ? 2 : ahead ? 1 : 0;
      }
    }
  }
  return zone;
})();
const ATTACK_WEIGHT = [0, 0, 2, 2, 3, 5, 0];
const PHASE_WEIGHT = [0, 0, 1, 1, 2, 4, 0];
const PIECE_VALUE = [0, 100, 320, 330, 500, 950, 0];

// Scratch maps, per side × square.
const attacks = new Uint8Array(128);
const pawnAttacks = new Uint8Array(128);
/** Most and least advanced pawn row per side × file; 8 / −1 when the file has none. */
const pawnMinRow = new Int8Array(16);
const pawnMaxRow = new Int8Array(16);
const pawnsOnFile = new Uint8Array(16);

const kingUnits = new Int32Array(2);
const kingAttackers = new Int32Array(2);

// Running totals of the evaluation in progress, and its trace when the tuner asks for one.
let middle = 0;
let end = 0;
let traced: Float64Array | null = null;

function add(index: number, count: number): void {
  middle += MIDDLE[index] * count;
  end += END[index] * count;
  if (traced !== null) traced[index] += count;
}

function nonPawnMaterial(counts: Int32Array, sign: number): number {
  return counts[sign * CHESS_KNIGHT + 6] * PIECE_VALUE[CHESS_KNIGHT] + counts[sign * CHESS_BISHOP + 6] * PIECE_VALUE[CHESS_BISHOP]
    + counts[sign * CHESS_ROOK + 6] * PIECE_VALUE[CHESS_ROOK] + counts[sign * CHESS_QUEEN + 6] * PIECE_VALUE[CHESS_QUEEN];
}

/**
 * Score in centipawns for white (positive) at `state`; insufficient material scores 0. With a trace, also
 * records each parameter's net count (white minus black), the phase, scale, and untuned extra.
 */
export function chessEvaluateWhite(state: ChessBoardState, trace: Float64Array | null): number {
  const { squares, counts } = state;
  const wn = counts[CHESS_KNIGHT + 6];
  const wb = counts[CHESS_BISHOP + 6];
  const bn = counts[-CHESS_KNIGHT + 6];
  const bb = counts[-CHESS_BISHOP + 6];
  const pawns = counts[CHESS_PAWN + 6] + counts[-CHESS_PAWN + 6];
  const heavy = counts[CHESS_ROOK + 6] + counts[-CHESS_ROOK + 6] + counts[CHESS_QUEEN + 6] + counts[-CHESS_QUEEN + 6];
  if (pawns === 0 && heavy === 0 && wn + wb + bn + bb <= 1) {
    if (trace) trace.fill(0);
    return 0;
  }
  middle = 0;
  end = 0;
  traced = trace;
  let phase = 0;
  if (trace) trace.fill(0);

  attacks.fill(0);
  pawnAttacks.fill(0);
  pawnMinRow.fill(8);
  pawnMaxRow.fill(-1);
  pawnsOnFile.fill(0);

  // Material, piece-square values, pawn files and pawn attacks.
  for (let square = 0; square < 64; square++) {
    const piece = squares[square];
    if (piece === 0) continue;
    const side = piece > 0 ? 0 : 1;
    const kind = piece > 0 ? piece : -piece;
    phase += PHASE_WEIGHT[kind];
    if (trace) {
      const sign = side === 0 ? 1 : -1;
      if (kind !== CHESS_KING) trace[P_MATERIAL + kind - 1] += sign;
      trace[P_PST + (kind - 1) * 32 + pstIndex(side, square)] += sign;
    }
    middle += PSQ_MIDDLE[(piece + 6) * 64 + square];
    end += PSQ_END[(piece + 6) * 64 + square];
    if (kind === CHESS_PAWN) {
      const file = square & 7;
      const row = square >> 3;
      const slot = side * 8 + file;
      pawnsOnFile[slot]++;
      if (row < pawnMinRow[slot]) pawnMinRow[slot] = row;
      if (row > pawnMaxRow[slot]) pawnMaxRow[slot] = row;
      const front = square + (side === 0 ? -8 : 8);
      if (front >= 0 && front < 64) {
        if (file > 0) {
          pawnAttacks[side * 64 + front - 1]++;
          attacks[side * 64 + front - 1]++;
        }
        if (file < 7) {
          pawnAttacks[side * 64 + front + 1]++;
          attacks[side * 64 + front + 1]++;
        }
      }
    }
  }
  if (phase > 24) phase = 24;

  // Pawn structure.
  for (let square = 0; square < 64; square++) {
    const piece = squares[square];
    if (piece !== CHESS_PAWN && piece !== -CHESS_PAWN) continue;
    const side = piece > 0 ? 0 : 1;
    const sign = side === 0 ? 1 : -1;
    const enemy = 1 - side;
    const file = square & 7;
    const row = square >> 3;
    const rank = ownRank(side, square);
    if (pawnsOnFile[side * 8 + file] > 1 && (side === 0 ? pawnMinRow[file] !== row : pawnMaxRow[8 + file] !== row)) {
      add(P_DOUBLED, sign);
    }
    const left = file > 0 ? pawnsOnFile[side * 8 + file - 1] : 0;
    const right = file < 7 ? pawnsOnFile[side * 8 + file + 1] : 0;
    if (left === 0 && right === 0) add(P_ISOLATED, sign);
    if ((file > 0 && squares[square - 1] === piece) || (file < 7 && squares[square + 1] === piece)) add(P_PHALANX + rank, sign);
    if (pawnAttacks[side * 64 + square] > 0) add(P_SUPPORTED + rank, sign);
    let passed = true;
    for (let other = Math.max(0, file - 1); other <= Math.min(7, file + 1) && passed; other++) {
      // A white pawn is passed when no black pawn stands on a lower row nearby; black mirrors it.
      passed = side === 0 ? pawnMinRow[8 + other] >= row : pawnMaxRow[other] <= row;
    }
    if (!passed) continue;
    // Doubled pawns only count the front one as passed.
    if (side === 0 ? pawnMinRow[file] !== row : pawnMaxRow[8 + file] !== row) continue;
    add(P_PASSED + rank, sign);
    const stop = square + (side === 0 ? -8 : 8);
    if (squares[stop] === 0) add(P_PASSED_FREE + rank, sign);
    if (rank > 1) {
      add(P_PASSED_OWN_KING, sign * distance(state.kings[side], stop) * (rank - 1));
      add(P_PASSED_ENEMY_KING, sign * distance(state.kings[enemy], stop) * (rank - 1));
    }
  }

  // Pieces: mobility, files, outposts, attacks on the king zone.
  kingUnits.fill(0);
  kingAttackers.fill(0);
  for (let square = 0; square < 64; square++) {
    const piece = squares[square];
    if (piece === 0) continue;
    const kind = piece > 0 ? piece : -piece;
    if (kind === CHESS_PAWN) continue;
    const side = piece > 0 ? 0 : 1;
    const sign = side === 0 ? 1 : -1;
    const enemy = 1 - side;
    const enemyKing = state.kings[enemy];
    const zoneBase = (enemy * 64 + enemyKing) * 64;
    let mobility = 0;
    let hits = 0;
    if (kind === CHESS_KNIGHT || kind === CHESS_KING) {
      const steps = kind === CHESS_KNIGHT ? KNIGHT_STEPS : KING_STEPS;
      for (let index = square * 8, last = index + steps.count[square]; index < last; index++) {
        const to = steps.list[index];
        attacks[side * 64 + to]++;
        if (kind === CHESS_KING) continue;
        if (squares[to] * sign <= 0 && pawnAttacks[enemy * 64 + to] === 0) mobility++;
        hits += KING_ZONE[zoneBase + to];
      }
    } else {
      const first = kind === CHESS_BISHOP ? 4 : 0;
      const last = kind === CHESS_ROOK ? 4 : 8;
      for (let direction = first; direction < last; direction++) {
        const base = (square * 8 + direction) * 8;
        for (let step = 0, length = RAY_LENGTH[square * 8 + direction]; step < length; step++) {
          const to = RAY[base + step];
          attacks[side * 64 + to]++;
          const target = squares[to];
          if (target * sign <= 0 && pawnAttacks[enemy * 64 + to] === 0) mobility++;
          hits += KING_ZONE[zoneBase + to];
          if (target !== 0) break;
        }
      }
    }
    if (kind === CHESS_KING) continue;
    if (hits > 0) {
      kingAttackers[side]++;
      kingUnits[side] += ATTACK_WEIGHT[kind] + hits;
    }
    const file = square & 7;
    switch (kind) {
      case CHESS_KNIGHT:
      case CHESS_BISHOP: {
        add((kind === CHESS_KNIGHT ? P_MOBILITY_KNIGHT : P_MOBILITY_BISHOP) + mobility, sign);
        const rank = ownRank(side, square);
        if (rank >= 3 && rank <= 5 && pawnAttacks[side * 64 + square] > 0) {
          const row = square >> 3;
          let safe = true;
          for (let other = file - 1; other <= file + 1 && safe; other += 2) {
            if (other < 0 || other > 7) continue;
            safe = side === 0 ? pawnMinRow[8 + other] >= row : pawnMaxRow[other] <= row;
          }
          if (safe) add(kind === CHESS_KNIGHT ? P_KNIGHT_OUTPOST : P_BISHOP_OUTPOST, sign);
        }
        break;
      }
      case CHESS_ROOK: {
        add(P_MOBILITY_ROOK + mobility, sign);
        if (pawnsOnFile[side * 8 + file] === 0) add(pawnsOnFile[enemy * 8 + file] === 0 ? P_ROOK_OPEN : P_ROOK_SEMI_OPEN, sign);
        if (ownRank(side, square) === 6) add(P_ROOK_SEVENTH, sign);
        break;
      }
      default:
        add(P_MOBILITY_QUEEN + Math.min(mobility, 27), sign);
    }
  }

  if (wb >= 2) add(P_BISHOP_PAIR, 1);
  if (bb >= 2) add(P_BISHOP_PAIR, -1);

  // King shelter and attack.
  for (let side = 0; side < 2; side++) {
    const sign = side === 0 ? 1 : -1;
    const king = state.kings[side];
    const kingFile = king & 7;
    const forward = side === 0 ? -8 : 8;
    const pawn = side === 0 ? CHESS_PAWN : -CHESS_PAWN;
    for (let file = Math.max(0, kingFile - 1); file <= Math.min(7, kingFile + 1); file++) {
      const base = (king & ~7) + file;
      const near = base + forward;
      const far = near + forward;
      if (near >= 0 && near < 64 && squares[near] === pawn) add(P_SHIELD_NEAR, sign);
      else if (far >= 0 && far < 64 && squares[far] === pawn) add(P_SHIELD_FAR, sign);
      if (pawnsOnFile[side * 8 + file] === 0) add(P_KING_OPEN_FILE, sign);
    }
    const attackerSide = 1 - side;
    const units = kingAttackers[attackerSide] >= 2 || (kingAttackers[attackerSide] >= 1 && counts[(attackerSide === 0 ? CHESS_QUEEN : -CHESS_QUEEN) + 6] > 0)
      ? Math.min(kingUnits[attackerSide], 39) : 0;
    if (units > 0) add(P_KING_ATTACK + units, -sign);
  }

  // Threats: pieces attacked by pawns, and undefended pieces under attack.
  for (let square = 0; square < 64; square++) {
    const piece = squares[square];
    if (piece === 0) continue;
    const kind = piece > 0 ? piece : -piece;
    if (kind === CHESS_KING) continue;
    const side = piece > 0 ? 0 : 1;
    const enemy = 1 - side;
    // The attacking side owns the term.
    const sign = enemy === 0 ? 1 : -1;
    if (kind !== CHESS_PAWN && pawnAttacks[enemy * 64 + square] > 0) add(P_PAWN_THREAT + kind - 2, sign);
    else if (attacks[enemy * 64 + square] > 0 && attacks[side * 64 + square] === 0) add(P_HANGING + kind - 1, sign);
  }

  add(P_TEMPO, state.side === 0 ? 1 : -1);

  // Endgame scale: no pawns for the stronger side and less than a rook ahead is hard to win.
  let scale = 128;
  const whiteMaterial = nonPawnMaterial(counts, 1);
  const blackMaterial = nonPawnMaterial(counts, -1);
  const strong = end >= 0 ? 0 : 1;
  const strongPawns = counts[(strong === 0 ? CHESS_PAWN : -CHESS_PAWN) + 6];
  const strongMaterial = strong === 0 ? whiteMaterial : blackMaterial;
  const weakMaterial = strong === 0 ? blackMaterial : whiteMaterial;
  if (strongPawns === 0 && strongMaterial - weakMaterial < PIECE_VALUE[CHESS_ROOK]) scale = strongMaterial <= PIECE_VALUE[CHESS_BISHOP] ? 0 : 16;
  else if (phase <= 2 && wb === 1 && bb === 1 && wn + bn === 0 && heavy === 0) {
    let colour = 0;
    for (let square = 0; square < 64; square++) {
      if (squares[square] === CHESS_BISHOP || squares[square] === -CHESS_BISHOP) colour += (((square >> 3) + square) & 1) * (squares[square] > 0 ? 1 : 2);
    }
    // Opposite-coloured bishops: exactly one of the two stands on a dark square.
    if (colour === 1 || colour === 2) scale = 64;
  }

  // Mop-up: with a decisive material lead and no enemy pawns, drive the bare king to the edge.
  let extra = 0;
  const lead = whiteMaterial + counts[CHESS_PAWN + 6] * 100 - blackMaterial - counts[-CHESS_PAWN + 6] * 100;
  if (Math.abs(lead) >= PIECE_VALUE[CHESS_ROOK] && phase <= 8) {
    const leader = lead > 0 ? 0 : 1;
    const loser = 1 - leader;
    if (counts[(loser === 0 ? CHESS_PAWN : -CHESS_PAWN) + 6] === 0) {
      const loserKing = state.kings[loser];
      extra = (leader === 0 ? 1 : -1) * (10 * centreDistance(loserKing) + 4 * (14 - (
        Math.abs((state.kings[0] & 7) - (state.kings[1] & 7)) + Math.abs((state.kings[0] >> 3) - (state.kings[1] >> 3)))));
    }
  }

  if (trace) {
    trace[CHESS_TRACE_PHASE] = phase;
    trace[CHESS_TRACE_SCALE] = scale;
    trace[CHESS_TRACE_EXTRA] = extra;
  }
  traced = null;
  return Math.trunc((middle * phase + end * (24 - phase) * scale / 128) / 24) + extra;
}

/** Score for the side to move. */
export function chessEvaluate(state: ChessBoardState): number {
  const white = chessEvaluateWhite(state, null);
  return state.side === 0 ? white : -white;
}

chessSetWeights(chessActiveWeights());
