// ─── Banqi search: expectimax over the unflipped pieces, from the seat's own view only ───
//
// A flip, and a blind attack on a face-down piece, is a chance node: the piece under a face-down cell is drawn
// from the pieces the seat has not seen (the full set minus the face-up pieces and the captures in the public
// log). Both players are equally uncertain, so the opponent is modelled with the same distribution. A capture
// chain is searched as it is played: after a capture the same side moves again, with only further captures or a
// stop. Runs inside a bot worker (`GameBot.search`) and, with a tiny node budget, as the synchronous fallback.
//
// Scores are in (-1, 1), a win-chance-like scale, so an expectation over flips is an expected result. Chance
// nodes use star1 pruning (bounds on the unsearched outcomes), decision nodes alpha-beta with a transposition
// table, killer-free history ordering, and a capture-only quiescence search at the horizon.

import type { BanqiVisibleState } from '@shared/games/banqi/types';
import { banqiRules } from '@shared/banqi-options';
import {
  BQ_CANNON, BQ_DOWN, BQ_PIECE_COUNT, bqCell, bqFullSet, bqNode, bqTally, isBqPiece,
} from '@shared/rules/banqi';
import type { BqColour, BqMove, BqRules } from '@shared/rules/banqi';
import type { SearchContext } from './search/search-types';
import type { BotAction } from './bot-decisions';
import { BASE_VALUES, evaluate } from './banqi-eval';
import {
  BLIND, BLIND_TAKES, CAN_CAPTURE, CAPTURE, CELLS, COLOUR, DOWN, EMPTY, FLIP, QUIET, QUIET_LIMIT, RANK, STOP,
  createPosition, drawFromPool, generateAll, generateFrom, keyHigh, keyLow, moveFrom, moveKind, moveTo, packMove,
  poolTotal, rayOf, returnToPool, setCell,
} from './banqi-position';
import type { Position } from './banqi-position';

class Stop extends Error {}

export interface BanqiSearchOptions {
  readonly maxDepth: number;
  readonly expired: () => boolean;
  readonly random: () => number;
  /** Transposition table size as a power of two; small for the synchronous fallback. */
  readonly tableBits?: number;
  /** Filled in as the search goes: nodes visited and the deepest completed iteration. */
  readonly stats?: { nodes: number; depth: number };
  /** Plain expectimax without pruning or table: the reference the pruned search is tested against. */
  readonly exhaustive?: boolean;
  /** Leaves the transposition table unused, so values depend on the position alone, not on earlier work. */
  readonly noTable?: boolean;
  /** Called after each complete iteration with every root choice's score (a bound for the moves it refuted). */
  readonly onIteration?: (depth: number, scores: readonly { choice: Choice; score: number }[]) => void;
}

export type Choice =
  | { readonly kind: 'flip'; readonly cell: number }
  | { readonly kind: 'move'; readonly move: BqMove }
  | { readonly kind: 'stop' };

// ─── Constants ───

/** Bound of every score: wins score a little above 1, faster wins higher. */
const BOUND = 1.1;
const winScore = (depth: number): number => 1 + 0.002 * Math.max(0, depth);
/** Root moves whose scores differ by less than this are equal; one of them is chosen at random. */
const TIE = 2e-4;

const MAX_PLY = 96;
const MOVES_PER_PLY = 160;
const QUIESCENCE_DEPTH = 6;
/** Covered cells tried at a flip node, by remaining depth: wide at the root, narrow near the horizon. */
const ROOT_FLIPS = 8;
const flipLimit = (depth: number): number => (depth >= 4 ? 3 : depth === 3 ? 2 : 1);
/** Blind attacks tried below the root: the ones with the best expected immediate result. */
const blindLimit = (depth: number): number => (depth >= 3 ? 3 : depth === 2 ? 2 : 1);

// ─── Transposition table ───

const EXACT = 0;
const LOWER = 1;
const UPPER = 2;

interface Table {
  readonly mask: number;
  readonly key: Int32Array;
  readonly value: Float32Array;
  readonly depth: Int8Array;
  readonly flag: Uint8Array;
  readonly move: Int16Array;
}

let sharedTable: Table | null = null;

/** The module's table, cleared: one search at a time uses it, and positions do not carry across decisions. */
function acquireTable(bits: number): Table {
  const size = 1 << bits;
  if (sharedTable === null || sharedTable.key.length !== size) {
    sharedTable = {
      mask: size - 1, key: new Int32Array(size), value: new Float32Array(size), depth: new Int8Array(size),
      flag: new Uint8Array(size), move: new Int16Array(size),
    };
  }
  sharedTable.depth.fill(-1);
  return sharedTable;
}

// ─── Search state ───

interface Run {
  readonly position: Position;
  readonly mine: number;
  readonly expired: () => boolean;
  readonly table: Table;
  readonly moves: Int32Array;
  readonly order: Float64Array;
  readonly history: Int32Array;
  readonly scratch: Int32Array;
  /** Chance-node scratch per ply: outcome pieces and their proven bounds. */
  readonly outcomes: Int8Array;
  readonly lower: Float64Array;
  readonly upper: Float64Array;
  /** Flip-class scratch. */
  readonly classKey: Float64Array;
  readonly classCell: Int8Array;
  readonly classScore: Float64Array;
  readonly exhaustive: boolean;
  readonly tabled: boolean;
  nodes: number;
}

function createRun(position: Position, mine: number, expired: () => boolean, tableBits: number, exhaustive: boolean, tabled: boolean): Run {
  return {
    position, mine, expired, exhaustive, tabled, table: acquireTable(tableBits),
    moves: new Int32Array(MAX_PLY * MOVES_PER_PLY), order: new Float64Array(MAX_PLY * MOVES_PER_PLY),
    history: new Int32Array(CELLS * CELLS), scratch: new Int32Array(64),
    outcomes: new Int8Array(MAX_PLY * BQ_PIECE_COUNT), lower: new Float64Array(MAX_PLY * BQ_PIECE_COUNT),
    upper: new Float64Array(MAX_PLY * BQ_PIECE_COUNT),
    classKey: new Float64Array(CELLS), classCell: new Int8Array(CELLS), classScore: new Float64Array(CELLS),
    nodes: 0,
  };
}

// ─── Move generation and ordering ───

const unitValue = (piece: number): number => BASE_VALUES[RANK[piece]];

/** Expected result, in material, of a blind attack: the unseen pieces it takes, minus the attacker it may lose. */
function blindGain(position: Position, from: number): number {
  const attacker = position.board[from];
  const rank = RANK[attacker];
  let gain = 0;
  for (let piece = 0; piece < BQ_PIECE_COUNT; piece++) {
    const count = position.pool[piece];
    if (count === 0) continue;
    if (BLIND_TAKES[attacker * 14 + piece] === 1) gain += count * unitValue(piece);
    else if (rank !== BQ_CANNON && COLOUR[piece] !== COLOUR[attacker] && CAN_CAPTURE[piece * 14 + attacker] === 1) {
      gain -= count * unitValue(attacker);
    }
  }
  const total = poolTotal(position);
  return total === 0 ? 0 : gain / total;
}

/** A face-down cell's neighbourhood: what sits in the two nearest cells of every line, `off` outside the board. */
function cellClass(board: Int8Array, cell: number): number {
  let key = 0;
  for (let direction = 0; direction < 4; direction++) {
    const ray = rayOf(cell, direction);
    for (let step = 0; step < 2; step++) key = key * 17 + (step < ray.length ? board[ray[step]] + 3 : 0);
  }
  return key;
}

/**
 * Expected material change of flipping `cell` for `side`, over what the cell may hide. A piece of the flipper's
 * colour is exposed to an adjacent enemy that can capture it; an enemy piece strikes first at the flipper's
 * neighbours. Covered neighbours are unknown and ignored.
 */
function flipSafety(position: Position, side: number, cell: number): number {
  const { board, pool } = position;
  let result = 0;
  let neighbours = false;
  for (let direction = 0; direction < 4; direction++) {
    const ray = rayOf(cell, direction);
    if (ray.length > 0 && board[ray[0]] >= 0) neighbours = true;
  }
  if (!neighbours) return 0;
  for (let piece = 0; piece < BQ_PIECE_COUNT; piece++) {
    const count = pool[piece];
    if (count === 0) continue;
    const mineRevealed = COLOUR[piece] === side;
    let exposed = false;
    let reach = 0;
    for (let direction = 0; direction < 4; direction++) {
      const ray = rayOf(cell, direction);
      if (ray.length === 0) continue;
      const near = board[ray[0]];
      if (near < 0 || COLOUR[near] === COLOUR[piece]) continue;
      if (CAN_CAPTURE[near * 14 + piece] === 1) exposed = true;
      if (CAN_CAPTURE[piece * 14 + near] === 1) reach = Math.max(reach, unitValue(near));
    }
    if (mineRevealed) result -= count * (exposed ? unitValue(piece) : -0.3 * reach);
    else result -= count * 0.8 * reach;
  }
  const total = poolTotal(position);
  return total === 0 ? 0 : result / total;
}

/** Appends the flips worth trying: the best cell of each distinct neighbourhood, by flip safety, at most `limit`. */
function addFlips(run: Run, side: number, limit: number, count: number): number {
  const { position, classKey, classCell, classScore, moves, order } = run;
  let classes = 0;
  for (let cell = 0; cell < CELLS; cell++) {
    if (position.board[cell] !== DOWN) continue;
    const key = cellClass(position.board, cell);
    let index = 0;
    while (index < classes && classKey[index] !== key) index++;
    // Cells with the same surroundings are alike for the next plies: the first of each stands for the rest.
    if (index < classes) continue;
    classKey[classes] = key;
    classCell[classes] = cell;
    classScore[classes++] = flipSafety(position, side, cell);
  }
  for (let taken = 0; taken < Math.min(limit, classes); taken++) {
    let best = taken;
    for (let index = taken + 1; index < classes; index++) if (classScore[index] > classScore[best]) best = index;
    const cell = classCell[best];
    const score = classScore[best];
    classKey[best] = classKey[taken];
    classCell[best] = classCell[taken];
    classScore[best] = classScore[taken];
    moves[count] = packMove(cell, cell, FLIP);
    order[count++] = 4e5 + score;
  }
  return count;
}

/**
 * Generates the moves of `side` at `ply` into the run's buffers, best first by score, and returns the end index.
 * In a capture chain only further captures, blind attacks, and a stop exist. Below the root only the most
 * promising blind attacks are kept, as each one branches like a flip.
 */
function generateMoves(run: Run, side: number, chain: number, depth: number, ply: number, ttMove: number, root: boolean): number {
  const { position, moves, order, history } = run;
  const base = ply * MOVES_PER_PLY;
  let count = base;
  if (chain >= 0) {
    count = generateFrom(position, chain, true, moves, count);
    moves[count++] = packMove(0, 0, STOP);
  } else {
    count = generateAll(position, side, false, moves, count);
  }
  let blinds = 0;
  for (let index = base; index < count; index++) {
    const move = moves[index];
    const kind = moveKind(move);
    if (move === ttMove) order[index] = 1e9;
    else if (kind === CAPTURE) {
      const from = moveFrom(move);
      order[index] = 1e6 + 16 * unitValue(position.board[moveTo(move)]) - unitValue(position.board[from]);
    } else if (kind === BLIND) {
      order[index] = 5e5 + blindGain(position, moveFrom(move));
      blinds++;
    } else if (kind === STOP) order[index] = 1e5;
    else order[index] = history[moveFrom(move) * CELLS + moveTo(move)];
  }
  // A blind attack in a chain branches again after every success, so inside a chain only one is kept.
  const limitBlind = chain >= 0 ? (depth >= 2 ? 1 : 0) : blindLimit(depth);
  if (!root && blinds > 0 && (blinds > limitBlind)) {
    // Drop all but the best blind attacks: find the cut-off score, then compact.
    const scores: number[] = [];
    for (let index = base; index < count; index++) if (moveKind(moves[index]) === BLIND) scores.push(order[index]);
    scores.sort((a, b) => b - a);
    const cut = limitBlind === 0 ? Infinity : scores[limitBlind - 1];
    let kept = 0;
    let write = base;
    for (let index = base; index < count; index++) {
      const move = moves[index];
      if (moveKind(move) === BLIND && (order[index] < cut || (order[index] === cut && ++kept > limitBlind))) continue;
      moves[write] = move;
      order[write++] = order[index];
    }
    count = write;
  }
  if (chain < 0 && position.down > 0) {
    // A flip of the TT move keeps its priority; the rest rank by safety.
    const before = count;
    count = addFlips(run, side, root ? ROOT_FLIPS : flipLimit(depth), count);
    if (ttMove >= 0) for (let index = before; index < count; index++) if (moves[index] === ttMove) order[index] = 1e9;
  }
  return count;
}

// ─── Applying moves ───

/** Whether the piece that just captured on `cell` may keep capturing under the room's chain rule. */
function continuesChain(run: Run, cell: number): boolean {
  return run.position.chain && generateFrom(run.position, cell, true, run.scratch, 0) > 0;
}

/** Value of a move for `side`: a capture hands on to the chain or the opponent, a flip or blind attack to chance. */
function moveValue(run: Run, side: number, move: number, depth: number, alpha: number, beta: number, ply: number): number {
  const kind = moveKind(move);
  const { position } = run;
  const opponent = 1 - side;
  if (kind === STOP) return node(run, opponent, -1, depth - 1, alpha, beta, ply + 1);
  if (kind === FLIP || kind === BLIND) return chance(run, side, move, depth, alpha, beta, ply);
  const from = moveFrom(move);
  const to = moveTo(move);
  const mover = position.board[from];
  const victim = position.board[to];
  const quiet = position.quiet;
  setCell(position, to, mover);
  setCell(position, from, EMPTY);
  let value: number;
  if (kind === CAPTURE) {
    position.quiet = 0;
    position.alive[COLOUR[victim]]--;
    value = continuesChain(run, to) ? node(run, side, to, depth, alpha, beta, ply + 1)
      : node(run, opponent, -1, depth - 1, alpha, beta, ply + 1);
    position.alive[COLOUR[victim]]++;
  } else {
    position.quiet = quiet + 1;
    value = node(run, opponent, -1, depth - 1, alpha, beta, ply + 1);
  }
  position.quiet = quiet;
  setCell(position, from, mover);
  setCell(position, to, kind === CAPTURE ? victim : EMPTY);
  return value;
}

/**
 * Expected value of revealing a face-down cell, by a flip or by the blind attack `move`: each unseen piece type
 * weighted by how many of it remain. Star1 pruning: outcomes not yet searched are bounded by the score range, so
 * the node stops as soon as the searched ones put its value outside (alpha, beta), and each outcome is searched
 * only in the window that can still matter.
 */
function chance(run: Run, side: number, move: number, depth: number, alpha: number, beta: number, ply: number): number {
  const { position, outcomes, lower, upper } = run;
  const { pool, board } = position;
  const flipping = moveKind(move) === FLIP;
  const from = moveFrom(move);
  const to = moveTo(move);
  const opponent = 1 - side;
  const total = poolTotal(position);
  const base = ply * BQ_PIECE_COUNT;
  let count = 0;
  // Most likely outcomes first: they remove the most unsearched probability.
  for (let piece = 0; piece < BQ_PIECE_COUNT; piece++) {
    if (pool[piece] === 0) continue;
    let slot = count++;
    while (slot > 0 && pool[outcomes[base + slot - 1]] < pool[piece]) {
      outcomes[base + slot] = outcomes[base + slot - 1];
      slot--;
    }
    outcomes[base + slot] = piece;
  }
  for (let index = 0; index < count; index++) {
    lower[base + index] = -BOUND;
    upper[base + index] = BOUND;
  }
  let sumLow = -BOUND;
  let sumHigh = BOUND;
  const attacker = flipping ? -1 : board[from];
  const quiet = position.quiet;
  if (run.exhaustive) {
    alpha = -BOUND;
    beta = BOUND;
  }
  for (let index = 0; index < count; index++) {
    if (!run.exhaustive && sumHigh <= alpha) return sumHigh;
    if (!run.exhaustive && sumLow >= beta) return sumLow;
    const piece = outcomes[base + index];
    const probability = pool[piece] / total;
    const low = lower[base + index];
    const high = upper[base + index];
    const childAlpha = run.exhaustive ? -BOUND : Math.max(-BOUND, (alpha - (sumHigh - probability * high)) / probability);
    const childBeta = run.exhaustive ? BOUND : Math.min(BOUND, (beta - (sumLow - probability * low)) / probability);

    let value: number;
    drawFromPool(position, piece);
    position.quiet = 0;
    if (flipping) {
      setCell(position, from, piece);
      value = node(run, opponent, -1, depth - 1, childAlpha, childBeta, ply + 1);
      setCell(position, from, DOWN);
    } else if (BLIND_TAKES[attacker * 14 + piece] === 1) {
      setCell(position, to, attacker);
      setCell(position, from, EMPTY);
      position.alive[COLOUR[piece]]--;
      // A blind attack in a chain branches again after every success, so the continuation costs a ply.
      value = continuesChain(run, to) ? node(run, side, to, depth - 1, childAlpha, childBeta, ply + 1)
        : node(run, opponent, -1, depth - 1, childAlpha, childBeta, ply + 1);
      position.alive[COLOUR[piece]]++;
      setCell(position, from, attacker);
      setCell(position, to, DOWN);
    } else {
      setCell(position, to, piece);
      value = node(run, opponent, -1, depth - 1, childAlpha, childBeta, ply + 1);
      setCell(position, to, DOWN);
    }
    position.quiet = quiet;
    returnToPool(position, piece);

    let newLow = low;
    let newHigh = high;
    if (value <= childAlpha) newHigh = Math.min(high, value);
    else if (value >= childBeta) newLow = Math.max(low, value);
    else {
      newLow = value;
      newHigh = value;
    }
    sumLow += probability * (newLow - low);
    sumHigh += probability * (newHigh - high);
    lower[base + index] = newLow;
    upper[base + index] = newHigh;
  }
  return (sumLow + sumHigh) / 2;
}

// ─── Search ───

function terminal(run: Run, side: number, depth: number): number | null {
  const { position } = run;
  if (position.alive[side] === 0) return side === run.mine ? -winScore(depth) : winScore(depth);
  if (position.quiet >= QUIET_LIMIT) return 0;
  return null;
}

/**
 * Captures only: a side may stand on the position's score, or capture. Keeps a capture the horizon cuts in half
 * from being mistaken for a win or a loss. A chain continuation may stop, which hands the move on.
 */
function quiesce(run: Run, side: number, chain: number, alpha: number, beta: number, ply: number, qd: number): number {
  if ((++run.nodes & 255) === 0 && run.expired()) throw new Stop();
  const { position } = run;
  if (chain < 0) {
    const done = terminal(run, side, 0);
    if (done !== null) return done;
  }
  const maximising = side === run.mine;
  const opponent = 1 - side;
  if (qd >= QUIESCENCE_DEPTH || ply >= MAX_PLY - 2) return evaluate(position, run.mine);
  let best = chain >= 0 ? quiesce(run, opponent, -1, alpha, beta, ply + 1, qd + 1) : evaluate(position, run.mine);
  if (maximising) {
    if (best >= beta) return best;
    if (best > alpha) alpha = best;
  } else {
    if (best <= alpha) return best;
    if (best < beta) beta = best;
  }
  const base = ply * MOVES_PER_PLY;
  const { moves, order } = run;
  let count = base;
  if (chain >= 0) count = generateFrom(position, chain, true, moves, count);
  else count = generateAll(position, side, true, moves, count);
  let write = base;
  for (let index = base; index < count; index++) {
    const move = moves[index];
    if (moveKind(move) !== CAPTURE) continue;
    moves[write] = move;
    order[write++] = 16 * unitValue(position.board[moveTo(move)]) - unitValue(position.board[moveFrom(move)]);
  }
  count = write;
  for (let index = base; index < count; index++) {
    let pick = index;
    for (let other = index + 1; other < count; other++) if (order[other] > order[pick]) pick = other;
    const move = moves[pick];
    moves[pick] = moves[index];
    order[pick] = order[index];
    moves[index] = move;

    const from = moveFrom(move);
    const to = moveTo(move);
    const mover = position.board[from];
    const victim = position.board[to];
    const quiet = position.quiet;
    setCell(position, to, mover);
    setCell(position, from, EMPTY);
    position.quiet = 0;
    position.alive[COLOUR[victim]]--;
    const value = continuesChain(run, to) ? quiesce(run, side, to, alpha, beta, ply + 1, qd + 1)
      : quiesce(run, opponent, -1, alpha, beta, ply + 1, qd + 1);
    position.alive[COLOUR[victim]]++;
    position.quiet = quiet;
    setCell(position, from, mover);
    setCell(position, to, victim);

    if (maximising) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }
  return best;
}

/** Value of the position for `mine` with `side` to move, inside a capture chain at `chain` or -1 at a turn's start. */
function node(run: Run, side: number, chain: number, depth: number, alpha: number, beta: number, ply: number): number {
  if ((++run.nodes & 255) === 0 && run.expired()) throw new Stop();
  const { position, table, moves, order, history } = run;
  if (chain < 0) {
    const done = terminal(run, side, depth);
    if (done !== null) return done;
  }
  if (depth <= 0) return quiesce(run, side, chain, alpha, beta, ply, 0);
  if (ply >= MAX_PLY - 2) return evaluate(position, run.mine);

  if (run.exhaustive) {
    alpha = -BOUND;
    beta = BOUND;
  }
  const key0 = keyLow(position, side, chain);
  const key1 = keyHigh(position, side, chain);
  const slot = key0 & table.mask;
  let ttMove = -1;
  if (run.tabled && !run.exhaustive && table.depth[slot] >= 0 && table.key[slot] === key1) {
    ttMove = table.move[slot];
    if (table.depth[slot] >= depth) {
      const stored = table.value[slot];
      const flag = table.flag[slot];
      if (flag === EXACT) return stored;
      if (flag === LOWER && stored >= beta) return stored;
      if (flag === UPPER && stored <= alpha) return stored;
    }
  }

  const maximising = side === run.mine;
  const base = ply * MOVES_PER_PLY;
  const count = generateMoves(run, side, chain, depth, ply, ttMove, false);
  const startAlpha = alpha;
  const startBeta = beta;
  let best = maximising ? -BOUND - 1 : BOUND + 1;
  let bestMove = -1;
  if (count === base) {
    // No piece can move and nothing is face down: the side to move has lost.
    return maximising ? -winScore(depth) : winScore(depth);
  }
  for (let index = base; index < count; index++) {
    let pick = index;
    for (let other = index + 1; other < count; other++) if (order[other] > order[pick]) pick = other;
    const move = moves[pick];
    moves[pick] = moves[index];
    order[pick] = order[index];
    moves[index] = move;

    const value = run.exhaustive ? moveValue(run, side, move, depth, -BOUND, BOUND, ply) : moveValue(run, side, move, depth, alpha, beta, ply);
    if (maximising) {
      if (value > best) {
        best = value;
        bestMove = move;
      }
      if (best > alpha) alpha = best;
    } else {
      if (value < best) {
        best = value;
        bestMove = move;
      }
      if (best < beta) beta = best;
    }
    if (alpha >= beta && !run.exhaustive) {
      if (moveKind(move) === QUIET) history[moveFrom(move) * CELLS + moveTo(move)] += depth * depth;
      break;
    }
  }

  if (run.tabled && !run.exhaustive && (table.depth[slot] < 0 || table.key[slot] === key1 || depth >= table.depth[slot])) {
    table.key[slot] = key1;
    table.value[slot] = best;
    table.depth[slot] = Math.min(127, Math.max(0, depth));
    table.flag[slot] = best <= startAlpha ? UPPER : best >= startBeta ? LOWER : EXACT;
    table.move[slot] = bestMove;
  }
  return best;
}

// ─── Position of the seat and root search ───

/** Everything the seat may know, or null when it is not their turn in a running match. */
export function banqiState(visible: BanqiVisibleState): { position: Position; colour: BqColour | null; rules: BqRules } | null {
  const index = visible.seats.indexOf(visible.mySeat);
  if (index < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const pool = Int8Array.from(bqTally(bqFullSet()));
  for (const slot of visible.board) if (isBqPiece(slot)) pool[slot]--;
  for (const entry of visible.log) if (entry.captured !== undefined) pool[entry.captured]--;
  const rules = banqiRules(visible.options);
  return {
    position: createPosition(visible.board, pool, visible.quietMoves, rules),
    colour: visible.colours === null ? null : visible.colours[index],
    rules,
  };
}

function choiceOf(move: number): Choice {
  const kind = moveKind(move);
  if (kind === STOP) return { kind: 'stop' };
  if (kind === FLIP) return { kind: 'flip', cell: moveFrom(move) };
  return {
    kind: 'move',
    move: { from: moveFrom(move), to: moveTo(move), capture: kind === CAPTURE, ...(kind === BLIND ? { blind: true as const } : {}) },
  };
}

export function banqiAction(choice: Choice): BotAction {
  const action = choice.kind === 'flip' ? { type: 'flip' as const, to: bqNode(choice.cell) }
    : choice.kind === 'stop' ? { type: 'stop' as const }
      : { type: 'move' as const, from: bqNode(choice.move.from), to: bqNode(choice.move.to) };
  return { type: 'game-action', request: { gameType: 'banqi', action } };
}

/**
 * Iterative deepening over the root moves: the best move of the last complete depth wins, or a move that beat the
 * previous best at the depth the clock interrupted. Equal moves are chosen between at random. Before colours exist
 * every flip is alike, so a random covered cell is flipped.
 */
export function searchBanqi(visible: BanqiVisibleState, options: BanqiSearchOptions): BotAction | null {
  const view = banqiState(visible);
  if (!view) return null;
  const { position, colour } = view;
  if (colour === null) {
    const covered = [...position.board].flatMap((slot, cell) => (slot === BQ_DOWN ? [cell] : []));
    return covered.length === 0 ? null
      : banqiAction({ kind: 'flip', cell: covered[Math.floor(options.random() * covered.length)] });
  }
  const chain = visible.chain === null ? -1 : bqCell(visible.chain) ?? -1;
  const run = createRun(position, colour, options.expired, options.tableBits ?? 19, options.exhaustive === true, options.noTable !== true);
  const end = generateMoves(run, colour, chain, ROOT_FLIPS, 0, -1, true);
  const roots: { move: number; score: number }[] = [];
  for (let index = 0; index < end; index++) roots.push({ move: run.moves[index], score: run.order[index] });
  roots.sort((a, b) => b.score - a.score);
  if (roots.length === 0) return null;
  if (roots.length === 1) return banqiAction(choiceOf(roots[0].move));
  let best = roots[0].move;
  for (const root of roots) root.score = -Infinity;
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    let top = -Infinity;
    let searched = 0;
    try {
      for (const root of roots) {
        const alpha = top === -Infinity || run.exhaustive ? -BOUND : top - TIE;
        root.score = moveValue(run, colour, root.move, depth, alpha, BOUND, 0);
        searched++;
        if (root.score > top) top = root.score;
      }
    } catch (error) {
      if (!(error instanceof Stop)) throw error;
    }
    // A partial iteration counts when its first move, the previous best, completed: later moves beat it fairly.
    if (searched === roots.length) options.onIteration?.(depth, roots.map((root) => ({ choice: choiceOf(root.move), score: root.score })));
    if (options.stats) {
      options.stats.nodes = run.nodes;
      if (searched === roots.length) options.stats.depth = depth;
    }
    if (searched > 0) {
      const done = roots.slice(0, searched);
      const leaders = done.filter((root) => root.score >= top - TIE);
      best = leaders[Math.floor(options.random() * leaders.length)].move;
    }
    if (searched < roots.length || top >= 1 || options.expired()) break;
    roots.sort((a, b) => b.score - a.score);
  }
  return banqiAction(choiceOf(best));
}

/** Plies the synchronous move looks ahead, and how many time checks (one per 256 nodes) it may use. */
export const QUICK_DEPTH = 3;
export const QUICK_CHECKS = 24;
export const QUICK_TABLE_BITS = 15;

/** Search strategy for the bot worker pool. */
export function banqiSearch(visible: BanqiVisibleState, context: SearchContext): BotAction | null {
  return searchBanqi(visible, {
    maxDepth: context.budget.maxDepth ?? 20, expired: context.budget.expired, random: context.random,
  });
}

