// ─── Banqi search: expectimax over the unflipped pieces, from the seat's own view only ───
//
// A flip, and a blind attack on a face-down piece, is a chance node: the piece under a face-down cell is drawn
// from the pieces the seat has not seen (the full set minus the face-up pieces and the captures in the public
// log). Both players are equally
// uncertain, so the opponent is modelled with the same distribution. Runs inside a bot worker
// (`GameBot.search`) and, with a tiny node budget, as the synchronous move that serves player timeouts.

import type { BanqiVisibleState } from '@shared/games/banqi/types';
import { banqiRules } from '@shared/banqi-options';
import {
  BQ_CELLS, BQ_DOWN, BQ_EMPTY, BQ_PIECE_COUNT, bqBlindTakes, bqCell, bqColour, bqFullSet, bqMovesFrom, bqNode, bqOpposite, bqRank, bqTally,
  isBqPiece,
} from '@shared/rules/banqi';
import type { BqColour, BqMove, BqRules } from '@shared/rules/banqi';
import type { SearchContext } from './search/search-types';
import type { BotAction } from './bot-decisions';

/** Material by rank (general first); the cannon is strong on this board and the soldier is cheap. */
const VALUES: readonly number[] = [100, 60, 40, 30, 20, 35, 12];
const WIN = 10_000;

/** Covered cells tried at each flip node: the ones next to the most pieces, since the rest are alike. */
const FLIP_CANDIDATES = 4;
/**
 * Blind attacks tried below the root, the ones with the best immediate expected take. They replace flips in the
 * same four chance nodes, so the tree grows no wider than without them.
 */
const BLIND_CANDIDATES = 2;

class Stop extends Error {}

export interface BanqiSearchOptions {
  readonly maxDepth: number;
  readonly expired: () => boolean;
  readonly random: () => number;
}

/** The searcher's picture of a position. */
interface State {
  readonly board: number[];
  /** Unseen pieces by type */
  readonly pool: Int8Array;
  readonly down: number;
}

export type Choice =
  | { readonly kind: 'flip'; readonly cell: number }
  | { readonly kind: 'move'; readonly move: BqMove }
  | { readonly kind: 'stop' };

const valueOf = (piece: number): number => VALUES[bqRank(piece)];

/** Everything the seat may know, or null when it is not their turn in a running match. */
export function banqiState(visible: BanqiVisibleState): { state: State; colour: BqColour | null; rules: BqRules } | null {
  const index = visible.seats.indexOf(visible.mySeat);
  if (index < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const seen: number[] = [];
  const board = [...visible.board];
  for (const slot of board) if (isBqPiece(slot)) seen.push(slot);
  for (const entry of visible.log) if (entry.captured !== undefined) seen.push(entry.captured);
  const pool = Int8Array.from(bqTally(bqFullSet()));
  for (const piece of seen) pool[piece]--;
  const down = board.reduce((count, slot) => count + (slot === BQ_DOWN ? 1 : 0), 0);
  return {
    state: { board, pool, down },
    colour: visible.colours === null ? null : visible.colours[index],
    rules: banqiRules(visible.options),
  };
}

/** Number of unseen pieces, which is what a flip's probabilities are taken from. */
function poolTotal(state: State): number {
  let total = 0;
  for (const count of state.pool) total += count;
  return total;
}

function neighbourCount(board: readonly number[], cell: number): number {
  const col = cell % 8;
  let count = 0;
  if (col > 0 && board[cell - 1] !== BQ_EMPTY) count++;
  if (col < 7 && board[cell + 1] !== BQ_EMPTY) count++;
  if (cell >= 8 && board[cell - 8] !== BQ_EMPTY) count++;
  if (cell < BQ_CELLS - 8 && board[cell + 8] !== BQ_EMPTY) count++;
  return count;
}

function flipCells(state: State, limit = FLIP_CANDIDATES): number[] {
  if (state.down === 0) return [];
  const cells: number[] = [];
  for (let cell = 0; cell < BQ_CELLS; cell++) if (state.board[cell] === BQ_DOWN) cells.push(cell);
  return cells.map((cell) => ({ cell, near: neighbourCount(state.board, cell) }))
    .sort((a, b) => b.near - a.near || a.cell - b.cell).slice(0, limit).map((entry) => entry.cell);
}

/** Expected material a blind attack takes at once, over the unseen pieces it may reveal. */
function blindGain(state: State, move: BqMove): number {
  const total = poolTotal(state);
  const attacker = state.board[move.from];
  let gain = 0;
  for (let piece = 0; piece < BQ_PIECE_COUNT; piece++) {
    if (state.pool[piece] > 0 && bqBlindTakes(attacker, piece)) gain += state.pool[piece] * valueOf(piece);
  }
  return total === 0 ? 0 : gain / total;
}

/**
 * Moves of `colour`: captures first, which tightens the alpha-beta window, then blind attacks, then the rest.
 * Below the root only the most promising blind attacks are kept, as each one branches like a flip.
 */
function movesOf(state: State, colour: BqColour, rules: BqRules, allBlind = false): BqMove[] {
  const plain: BqMove[] = [];
  const blind: BqMove[] = [];
  for (let from = 0; from < BQ_CELLS; from++) {
    const piece = state.board[from];
    if (!isBqPiece(piece) || bqColour(piece) !== colour) continue;
    for (const move of bqMovesFrom(state.board, from, rules)) (move.blind ? blind : plain).push(move);
  }
  plain.sort((a, b) => Number(b.capture) - Number(a.capture));
  const tried = allBlind ? blind : blind.map((move) => ({ move, gain: blindGain(state, move) }))
    .sort((a, b) => b.gain - a.gain).slice(0, BLIND_CANDIDATES).map((entry) => entry.move);
  return [...plain, ...tried];
}

/** Total material a colour still owns: face-up pieces plus its share of the unseen pool. */
function material(state: State, colour: BqColour): number {
  let total = 0;
  for (const slot of state.board) if (isBqPiece(slot) && bqColour(slot) === colour) total += valueOf(slot);
  for (let piece = 0; piece < BQ_PIECE_COUNT; piece++) if (bqColour(piece) === colour) total += state.pool[piece] * valueOf(piece);
  return total;
}

function pieceCount(state: State, colour: BqColour): number {
  let total = 0;
  for (const slot of state.board) if (isBqPiece(slot) && bqColour(slot) === colour) total++;
  for (let piece = 0; piece < BQ_PIECE_COUNT; piece++) if (bqColour(piece) === colour) total += state.pool[piece];
  return total;
}

/** Static score for `mine`, plus the best capture the side to move already threatens. */
function evaluate(state: State, mine: BqColour, toMove: BqColour, rules: BqRules): number {
  let score = material(state, mine) - material(state, bqOpposite(mine));
  let threat = 0;
  for (let from = 0; from < BQ_CELLS; from++) {
    const piece = state.board[from];
    if (!isBqPiece(piece) || bqColour(piece) !== toMove) continue;
    for (const move of bqMovesFrom(state.board, from, rules, true)) {
      if (move.capture) threat = Math.max(threat, valueOf(state.board[move.to]));
    }
  }
  score += toMove === mine ? threat * 0.8 : -threat * 0.8;
  return score;
}

function applyMove(state: State, move: BqMove): State {
  const board = [...state.board];
  board[move.to] = board[move.from];
  board[move.from] = BQ_EMPTY;
  return { board, pool: state.pool, down: state.down };
}

/** A blind attack that revealed `piece`: taken when the attacker may take it, otherwise left face up. */
function applyBlind(state: State, move: BqMove, piece: number): State {
  const board = [...state.board];
  if (bqBlindTakes(board[move.from], piece)) {
    board[move.to] = board[move.from];
    board[move.from] = BQ_EMPTY;
  } else {
    board[move.to] = piece;
  }
  const pool = Int8Array.from(state.pool);
  pool[piece]--;
  return { board, pool, down: state.down - 1 };
}

function applyFlip(state: State, cell: number, piece: number): State {
  const board = [...state.board];
  board[cell] = piece;
  const pool = Int8Array.from(state.pool);
  pool[piece]--;
  return { board, pool, down: state.down - 1 };
}

interface Run {
  readonly mine: BqColour;
  readonly rules: BqRules;
  readonly expired: () => boolean;
  nodes: number;
}

/**
 * Expected value of revealing a face-down cell, by a flip of `cell` or by the blind attack `cell` is: each unseen
 * piece type weighted by how many of it remain.
 */
function expectation(run: Run, state: State, cell: number | BqMove, next: BqColour, depth: number): number {
  const total = poolTotal(state);
  if (total === 0) return evaluate(state, run.mine, next, run.rules);
  let expected = 0;
  for (let piece = 0; piece < BQ_PIECE_COUNT; piece++) {
    if (state.pool[piece] === 0) continue;
    const after = typeof cell === 'number' ? applyFlip(state, cell, piece) : applyBlind(state, cell, piece);
    expected += (state.pool[piece] / total) * value(run, after, next, depth - 1, -Infinity, Infinity);
  }
  return expected;
}

/** Value of a move: a blind attack is a chance node like a flip; others are searched directly. */
function moveValue(run: Run, state: State, move: BqMove, next: BqColour, depth: number, alpha: number, beta: number): number {
  return move.blind ? expectation(run, state, move, next, depth) : value(run, applyMove(state, move), next, depth - 1, alpha, beta);
}

function value(run: Run, state: State, toMove: BqColour, depth: number, alpha: number, beta: number): number {
  if ((++run.nodes & 63) === 0 && run.expired()) throw new Stop();
  const opponent = bqOpposite(toMove);
  if (pieceCount(state, run.mine) === 0) return -WIN - depth;
  if (pieceCount(state, bqOpposite(run.mine)) === 0) return WIN + depth;
  // While a piece is face down the side to move can always flip, so a leaf needs no move list.
  if (depth === 0 && state.down > 0) return evaluate(state, run.mine, toMove, run.rules);
  const moves = movesOf(state, toMove, run.rules);
  if (moves.length === 0 && state.down === 0) return toMove === run.mine ? -WIN - depth : WIN + depth;
  if (depth === 0) return evaluate(state, run.mine, toMove, run.rules);
  const flips = flipCells(state, FLIP_CANDIDATES - moves.filter((move) => move.blind).length);

  const maximising = toMove === run.mine;
  let best = maximising ? -Infinity : Infinity;
  const consider = (score: number): boolean => {
    if (maximising) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    return alpha >= beta;
  };
  for (const move of moves) {
    if (consider(moveValue(run, state, move, opponent, depth, alpha, beta))) return best;
  }
  for (const cell of flips) {
    // A flip is a chance node: weigh every piece the cell may hide by how many of it remain unseen.
    if (consider(expectation(run, state, cell, opponent, depth))) return best;
  }
  return best;
}

/** Best choice for `mine` on its turn. In a chain only captures by the chaining piece, or stopping, are legal. */
function rootChoices(state: State, mine: BqColour, rules: BqRules, chain: number | null): Choice[] {
  if (chain !== null) {
    return [...bqMovesFrom(state.board, chain, rules, true).map((move): Choice => ({ kind: 'move', move })), { kind: 'stop' }];
  }
  return [...movesOf(state, mine, rules, true).map((move): Choice => ({ kind: 'move', move })),
    ...flipCells(state).map((cell): Choice => ({ kind: 'flip', cell }))];
}

function choiceValue(run: Run, state: State, choice: Choice, depth: number): number {
  const opponent = bqOpposite(run.mine);
  if (choice.kind === 'stop') return value(run, state, opponent, depth - 1, -Infinity, Infinity);
  if (choice.kind === 'move') return moveValue(run, state, choice.move, opponent, depth, -Infinity, Infinity);
  return expectation(run, state, choice.cell, opponent, depth);
}

export function banqiAction(choice: Choice): BotAction {
  const action = choice.kind === 'flip' ? { type: 'flip' as const, to: bqNode(choice.cell) }
    : choice.kind === 'stop' ? { type: 'stop' as const }
      : { type: 'move' as const, from: bqNode(choice.move.from), to: bqNode(choice.move.to) };
  return { type: 'game-action', request: { gameType: 'banqi', action } };
}

/**
 * Iterative deepening: the best choice of the last fully searched depth wins, ties broken at random.
 * Before colours exist every flip is alike, so a random covered cell is flipped.
 */
export function searchBanqi(visible: BanqiVisibleState, options: BanqiSearchOptions): BotAction | null {
  const view = banqiState(visible);
  if (!view) return null;
  const { state, colour, rules } = view;
  if (colour === null) {
    const covered = [...state.board].flatMap((slot, cell) => (slot === BQ_DOWN ? [cell] : []));
    return covered.length === 0 ? null
      : banqiAction({ kind: 'flip', cell: covered[Math.floor(options.random() * covered.length)] });
  }
  const chain = visible.chain === null ? null : bqCell(visible.chain);
  const choices = rootChoices(state, colour, rules, chain);
  if (choices.length === 0) return null;
  if (choices.length === 1) return banqiAction(choices[0]);
  const run: Run = { mine: colour, rules, expired: options.expired, nodes: 0 };
  let best = choices[0];
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const scored: { choice: Choice; score: number }[] = [];
    try {
      for (const choice of choices) scored.push({ choice, score: choiceValue(run, state, choice, depth) });
    } catch (error) {
      if (error instanceof Stop) break;
      throw error;
    }
    const top = Math.max(...scored.map((entry) => entry.score));
    const leaders = scored.filter((entry) => entry.score >= top - 1e-9);
    best = leaders[Math.floor(options.random() * leaders.length)].choice;
    if (top >= WIN - 100 || options.expired()) break;
  }
  return banqiAction(best);
}

/** Plies the synchronous move looks ahead, and how many time checks (one per 64 nodes) it may use. */
export const QUICK_DEPTH = 2;
export const QUICK_CHECKS = 40;

/** Search strategy for the bot worker pool. */
export function banqiSearch(visible: BanqiVisibleState, context: SearchContext): BotAction | null {
  return searchBanqi(visible, {
    maxDepth: context.budget.maxDepth ?? 6, expired: context.budget.expired, random: context.random,
  });
}
