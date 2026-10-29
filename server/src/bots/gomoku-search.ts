// ─── Gomoku search: five-cell window scores, forced-move extensions, and iterative-deepening alpha-beta ───
//
// Runs inside a bot worker (`GameBot.search`) and, with a small node budget, as the cheap synchronous move that
// serves player timeouts. It reads only the seat's own view, which for Gomoku is the whole public board.

import type { GomokuVisibleState } from '@shared/types';
import {
  GM_AXES, GM_CELLS, GM_SIZE, gmForbiddenInPlace, gmIndex, gmNode, gmSideOfStone, gmStage, gmStoneCount, gmWins,
} from '@shared/rules/gomoku';
import type { GmCell, GmSide } from '@shared/rules/gomoku';
import type { SearchContext } from './search/search-types';
import type { BotAction } from './bot-decisions';

/** What a stone is worth in a five-cell window that holds none of the opponent's: index = own stones there. */
const LINE_VALUE: readonly number[] = [0, 1, 10, 100, 1200, 100_000];

/** Score of a certain win; a sooner win scores higher. */
const WIN = 1_000_000;

const CENTRE = gmIndex((GM_SIZE - 1) / 2, (GM_SIZE - 1) / 2);

/** Every run of five intersections on the board. */
const WINDOWS: readonly (readonly number[])[] = (() => {
  const windows: number[][] = [];
  for (const [dx, dy] of GM_AXES) {
    for (let row = 0; row < GM_SIZE; row++) {
      for (let col = 0; col < GM_SIZE; col++) {
        const endCol = col + 4 * dx;
        const endRow = row + 4 * dy;
        if (endCol < 0 || endCol >= GM_SIZE || endRow < 0 || endRow >= GM_SIZE) continue;
        windows.push([0, 1, 2, 3, 4].map((step) => gmIndex(col + step * dx, row + step * dy)));
      }
    }
  }
  return windows;
})();

const CELL_WINDOWS: readonly (readonly number[])[] = (() => {
  const byCell: number[][] = Array.from({ length: GM_CELLS }, () => []);
  WINDOWS.forEach((cells, id) => cells.forEach((cell) => byCell[cell].push(id)));
  return byCell;
})();

/** Intersections within two steps of each cell: where a sensible next stone can go. */
const NEAR: readonly (readonly number[])[] = Array.from({ length: GM_CELLS }, (_, index) => {
  const col = index % GM_SIZE;
  const row = Math.floor(index / GM_SIZE);
  const near: number[] = [];
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const c = col + dc;
      const r = row + dr;
      if ((dc !== 0 || dr !== 0) && c >= 0 && c < GM_SIZE && r >= 0 && r < GM_SIZE) near.push(gmIndex(c, r));
    }
  }
  return near;
});

/** Distance from the centre, so equally good moves prefer the middle. */
const CENTRE_BIAS: readonly number[] = Array.from({ length: GM_CELLS }, (_, index) =>
  -Math.max(Math.abs((index % GM_SIZE) - 7), Math.abs(Math.floor(index / GM_SIZE) - 7)) * 0.1);

const windowValue = (black: number, white: number): number =>
  white === 0 ? LINE_VALUE[black] : black === 0 ? -LINE_VALUE[white] : 0;

/** A board with incremental window counts, so a move costs a few dozen updates rather than a rescan. */
export class Position {
  readonly stones: GmCell[];
  /** Stones per window, by side */
  private readonly counts: readonly [Uint8Array, Uint8Array] = [new Uint8Array(WINDOWS.length), new Uint8Array(WINDOWS.length)];
  /** Windows holding four stones of a side and none of the other: that side wins by filling the gap */
  readonly fours: [number, number] = [0, 0];
  /** How many stones sit within two steps of each cell */
  private readonly near = new Uint8Array(GM_CELLS);
  /** Black's window value minus white's */
  score = 0;
  stoneCount = 0;

  constructor(stones: readonly GmCell[]) {
    this.stones = new Array<GmCell>(GM_CELLS).fill(null);
    stones.forEach((cell, index) => {
      if (cell !== null) this.make(index, cell);
    });
  }

  private shift(index: number, side: GmSide, delta: 1 | -1): void {
    for (const id of CELL_WINDOWS[index]) {
      const black = this.counts[0][id];
      const white = this.counts[1][id];
      this.score -= windowValue(black, white);
      if (white === 0 && black === 4) this.fours[0]--;
      if (black === 0 && white === 4) this.fours[1]--;
      this.counts[side][id] += delta;
      const nextBlack = this.counts[0][id];
      const nextWhite = this.counts[1][id];
      this.score += windowValue(nextBlack, nextWhite);
      if (nextWhite === 0 && nextBlack === 4) this.fours[0]++;
      if (nextBlack === 0 && nextWhite === 4) this.fours[1]++;
    }
  }

  make(index: number, side: GmSide): void {
    this.stones[index] = side;
    this.stoneCount++;
    this.shift(index, side, 1);
    for (const cell of NEAR[index]) this.near[cell]++;
  }

  unmake(index: number, side: GmSide): void {
    this.stones[index] = null;
    this.stoneCount--;
    this.shift(index, side, -1);
    for (const cell of NEAR[index]) this.near[cell]--;
  }

  isCandidate(index: number): boolean {
    return this.stones[index] === null && this.near[index] > 0;
  }

  /** Window value gained by `side` playing `index`, plus the opponent's value there that the stone cuts off. */
  heuristic(index: number, side: GmSide): number {
    const mine = this.counts[side];
    const theirs = this.counts[side === 0 ? 1 : 0];
    let total = CENTRE_BIAS[index];
    for (const id of CELL_WINDOWS[index]) {
      if (theirs[id] === 0) total += LINE_VALUE[mine[id] + 1] - LINE_VALUE[mine[id]];
      else if (mine[id] === 0) total += LINE_VALUE[theirs[id]] * 0.9;
    }
    return total;
  }

  /** Empty cells where `side` completes a winning line. */
  winningCells(side: GmSide, renju: boolean): number[] {
    if (this.fours[side] === 0) return [];
    const found: number[] = [];
    const mine = this.counts[side];
    const theirs = this.counts[side === 0 ? 1 : 0];
    WINDOWS.forEach((cells, id) => {
      if (mine[id] !== 4 || theirs[id] !== 0) return;
      const gap = cells.find((cell) => this.stones[cell] === null);
      if (gap !== undefined && !found.includes(gap) && gmWins(this.stones, gap, side, renju)) found.push(gap);
    });
    return found;
  }

  /** Whether `side` may play the empty cell: black avoids forbidden points under Renju. */
  allows(index: number, side: GmSide, renju: boolean): boolean {
    return this.stones[index] === null && !(renju && side === 0 && gmForbiddenInPlace(this.stones, index));
  }

  /** The `limit` best legal moves near the stones, strongest first; the centre when the board is empty. */
  candidates(side: GmSide, renju: boolean, limit: number): number[] {
    if (this.stoneCount === 0) return [CENTRE];
    const scored: { index: number; value: number }[] = [];
    for (let index = 0; index < GM_CELLS; index++) {
      if (this.isCandidate(index)) scored.push({ index, value: this.heuristic(index, side) });
    }
    scored.sort((a, b) => b.value - a.value || a.index - b.index);
    const moves: number[] = [];
    for (const { index } of scored) {
      if (!this.allows(index, side, renju)) continue;
      moves.push(index);
      if (moves.length >= limit) break;
    }
    return moves;
  }
}

class Stop extends Error {}

interface SearchState {
  readonly position: Position;
  readonly renju: boolean;
  readonly expired: () => boolean;
  readonly maxNodes: number;
  nodes: number;
}

/** Moves tried at each ply from the root: wide where the choice matters, narrow deeper down. */
const BREADTH = [14, 10, 8, 6, 5, 4];

/** Plies a chain of forced replies may add beyond the depth, so a run of fours is read to its end. */
const FORCED_EXTENSION = 24;

const opponentOf = (side: GmSide): GmSide => (side === 0 ? 1 : 0);

function evaluate(position: Position, side: GmSide): number {
  return side === 0 ? position.score : -position.score;
}

function negamax(
  state: SearchState, side: GmSide, depth: number, alpha: number, beta: number, ply: number, extension: number,
): number {
  if (++state.nodes > state.maxNodes || ((state.nodes & 127) === 0 && state.expired())) throw new Stop();
  const { position, renju } = state;
  if (position.winningCells(side, renju).length > 0) return WIN - ply;
  const other = opponentOf(side);
  let moves: number[];
  let forced = false;
  const threats = position.winningCells(other, renju);
  if (threats.length >= 2) return -(WIN - ply - 1);
  if (threats.length === 1) {
    // The only defence is to fill the gap, which black may not do if it is forbidden.
    if (!position.allows(threats[0], side, renju)) return -(WIN - ply - 1);
    moves = [threats[0]];
    forced = true;
  } else {
    if (depth <= 0) return evaluate(position, side);
    moves = position.candidates(side, renju, BREADTH[Math.min(ply, BREADTH.length - 1)]);
    if (moves.length === 0) return 0;
  }
  // A forced reply costs no depth while the extension lasts.
  const free = forced && extension > 0;
  let best = -Infinity;
  for (const move of moves) {
    position.make(move, side);
    let value: number;
    try {
      value = -negamax(state, other, free ? depth : depth - 1, -beta, -alpha, ply + 1, free ? extension - 1 : extension);
    } finally {
      position.unmake(move, side);
    }
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export interface GomokuSearchOptions {
  /** Deepest ply to search */
  readonly maxDepth: number;
  readonly expired: () => boolean;
  /** Node budget for the cheap synchronous search; unlimited in the worker */
  readonly maxNodes?: number;
  readonly random: () => number;
}

export interface GomokuChoice {
  readonly index: number;
  /** Search value for the side to move: positive favours it, a win is above `WIN / 2` */
  readonly score: number;
}

/** Number of moves tried at the root. */
const ROOT_BREADTH = 16;

/**
 * Iterative deepening from the shallowest ply: the best move of the last fully searched depth wins, and equal
 * moves are chosen between at random. A move that wins, or a forced block, is returned without searching.
 */
export function searchBestMove(
  position: Position, side: GmSide, renju: boolean, options: GomokuSearchOptions,
): GomokuChoice | null {
  const wins = position.winningCells(side, renju);
  if (wins.length > 0) return { index: wins[0], score: WIN };
  const threats = position.winningCells(opponentOf(side), renju);
  if (threats.length > 0) {
    // One threat has one defence; two (or a forbidden defence) lose whatever is played.
    const block = threats.find((cell) => position.allows(cell, side, renju)) ?? position.candidates(side, renju, 1)[0];
    if (block === undefined) return null;
    return { index: block, score: threats.length === 1 && position.allows(threats[0], side, renju) ? 0 : -WIN };
  }
  const first = position.candidates(side, renju, ROOT_BREADTH);
  if (first.length === 0) return null;
  let ordered = first;
  let best: GomokuChoice = { index: first[0], score: 0 };
  if (first.length === 1) return best;
  const state: SearchState = {
    position, renju, expired: options.expired, maxNodes: options.maxNodes ?? Infinity, nodes: 0,
  };
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const scores: { index: number; score: number }[] = [];
    let alpha = -Infinity;
    try {
      for (const move of ordered) {
        position.make(move, side);
        let value: number;
        try {
          // Equal scores are all kept, so the window may only cut moves that are strictly worse.
          value = -negamax(state, opponentOf(side), depth - 1, -Infinity, -alpha + 1, 1, FORCED_EXTENSION);
        } finally {
          position.unmake(move, side);
        }
        scores.push({ index: move, score: value });
        if (value > alpha) alpha = value;
      }
    } catch (error) {
      if (error instanceof Stop) break;
      throw error;
    }
    scores.sort((a, b) => b.score - a.score);
    const top = scores.filter((entry) => entry.score === scores[0].score);
    const pick = top[Math.floor(options.random() * top.length)];
    best = { index: pick.index, score: pick.score };
    ordered = scores.map((entry) => entry.index);
    // A decided position needs no more depth.
    if (Math.abs(best.score) > WIN / 2 || options.expired()) break;
  }
  return best;
}

/** The side whose stone goes down next, from the stones on the board. */
export const sideToPlace = (visible: GomokuVisibleState): GmSide => gmSideOfStone(gmStoneCount(visible.stones));

/** Whether the viewer has to place a stone now (not choose a colour). */
export function placingTurn(visible: GomokuVisibleState): boolean {
  return visible.phase === 'playing' && visible.currentTurnSeat === visible.mySeat
    && gmStage(visible.options, visible.log) !== 'choosing';
}

export function choosingTurn(visible: GomokuVisibleState): boolean {
  return visible.phase === 'playing' && visible.currentTurnSeat === visible.mySeat
    && gmStage(visible.options, visible.log) === 'choosing';
}

export function placeAction(index: number): BotAction {
  return { type: 'game-action', request: { gameType: 'gomoku', action: { type: 'place', to: gmNode(index) } } };
}

export function chooseAction(swap: boolean): BotAction {
  return { type: 'game-action', request: { gameType: 'gomoku', action: { type: 'choose-side', swap } } };
}

/** Plies the synchronous move looks ahead, and the nodes it may spend: enough to see a four, cheap for a timeout. */
export const QUICK_DEPTH = 4;
export const QUICK_NODES = 2500;

/**
 * Colour choice in the swap opening: the second seat takes black when white, to move on this position, stands
 * worse. `random` breaks an even position.
 */
export function chooseBySearch(visible: GomokuVisibleState, options: GomokuSearchOptions): BotAction {
  const position = new Position(visible.stones);
  const choice = searchBestMove(position, 1, visible.options.renju, options);
  const score = choice?.score ?? 0;
  return chooseAction(score === 0 ? options.random() < 0.5 : score < 0);
}

/** Search strategy for the bot worker pool. */
export function gomokuSearch(visible: GomokuVisibleState, context: SearchContext): BotAction | null {
  const options: GomokuSearchOptions = {
    maxDepth: context.budget.maxDepth ?? 10, expired: context.budget.expired, random: context.random,
  };
  if (choosingTurn(visible)) return chooseBySearch(visible, options);
  if (!placingTurn(visible)) return null;
  const choice = searchBestMove(new Position(visible.stones), sideToPlace(visible), visible.options.renju, options);
  return choice === null ? null : placeAction(choice.index);
}
