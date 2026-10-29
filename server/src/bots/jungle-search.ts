// ─── Jungle search: iterative-deepening alpha-beta over material, advance toward the den, and captures ───
//
// Runs inside a bot worker (`GameBot.search`) and, at a shallow depth, as the cheap synchronous move that
// serves player timeouts. It reads only the seat's own view, which for Jungle is the whole public board.

import type { JungleVisibleState } from '@shared/types';
import {
  JG_CELLS, JG_COLS, jgDenCell, jgIsDen, jgLegalMoves, jgNode, jgOpponent, jgRankOf, jgSideOf, jgTrapped,
} from '@shared/rules/jungle';
import type { JgMove, JgSide } from '@shared/rules/jungle';
import type { SearchContext } from './search/search-types';
import type { BotAction } from './bot-decisions';

type Cells = Int8Array;

/** Worth of a rank in centipawn-like units: the rat stays valuable because it is the elephant's only hunter. */
const VALUE: readonly number[] = [0, 300, 200, 250, 320, 420, 600, 700, 800];

/** Score of a won game; a nearer win scores higher, a nearer loss lower. */
const WIN = 100_000;

const STEP_WEIGHT = 6;
/** Pieces within this many steps of the enemy den get a growing bonus. */
const NEAR_DEN = 3;
const NEAR_WEIGHT = 50;

/** Capture-only plies searched past the nominal depth. */
const QUIET_DEPTH = 3;

const distance = (a: number, b: number): number =>
  Math.abs((a % JG_COLS) - (b % JG_COLS)) + Math.abs(Math.floor(a / JG_COLS) - Math.floor(b / JG_COLS));

/** Steps from every cell to the den of each side. */
const DEN_DISTANCE: readonly (readonly number[])[] = ([0, 1] as const).map((side) =>
  Array.from({ length: JG_CELLS }, (_, index) => distance(index, jgDenCell(side))));

class Stop extends Error {}

interface Limits {
  readonly expired: () => boolean;
}

function child(cells: Cells, move: JgMove): Cells {
  const next = cells.slice();
  next[move.to] = next[move.from];
  next[move.from] = 0;
  return next;
}

/** Score for `side`: its pieces' worth and advance minus the opponent's. */
function evaluate(cells: Cells, side: JgSide): number {
  let score = 0;
  for (let index = 0; index < JG_CELLS; index++) {
    const piece = cells[index];
    if (piece === 0) continue;
    const owner = jgSideOf(piece);
    const rank = jgRankOf(piece);
    // The den to attack is the opponent's, which is the other side's index.
    const steps = DEN_DISTANCE[jgOpponent(owner)][index];
    let value = jgTrapped(index, owner) ? VALUE[rank] * 0.3 : VALUE[rank];
    value += (14 - steps) * STEP_WEIGHT;
    if (steps < NEAR_DEN) value += (NEAR_DEN - steps) * NEAR_WEIGHT;
    score += owner === side ? value : -value;
  }
  return score;
}

/** Moves with the most promising first: den entries, then big captures, then advances. */
function ordered(cells: Cells, side: JgSide, capturesOnly: boolean): JgMove[] {
  const opponent = jgOpponent(side);
  const scored: { move: JgMove; score: number }[] = [];
  for (const move of jgLegalMoves(cells, side)) {
    const target = cells[move.to];
    const winning = jgIsDen(move.to, opponent);
    if (capturesOnly && target === 0 && !winning) continue;
    const gain = DEN_DISTANCE[opponent][move.from] - DEN_DISTANCE[opponent][move.to];
    scored.push({
      move,
      score: (winning ? 10_000 : 0) + (target === 0 ? 0 : 100 + VALUE[jgRankOf(target)] - VALUE[jgRankOf(cells[move.from])] / 10) + gain,
    });
  }
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.move);
}

function quiesce(
  cells: Cells, side: JgSide, alpha: number, beta: number, depth: number, ply: number, limits: Limits, counter: { nodes: number },
): number {
  if ((++counter.nodes & 255) === 0 && limits.expired()) throw new Stop();
  let best = evaluate(cells, side);
  if (depth <= 0 || best >= beta) return best;
  if (best > alpha) alpha = best;
  const opponent = jgOpponent(side);
  for (const move of ordered(cells, side, true)) {
    if (jgIsDen(move.to, opponent)) return WIN - ply - 1;
    const score = -quiesce(child(cells, move), opponent, -beta, -alpha, depth - 1, ply + 1, limits, counter);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function searchNode(
  cells: Cells, side: JgSide, depth: number, alpha: number, beta: number, ply: number, limits: Limits,
  counter: { nodes: number },
): number {
  if ((++counter.nodes & 255) === 0 && limits.expired()) throw new Stop();
  const moves = ordered(cells, side, false);
  // A side that cannot move loses.
  if (moves.length === 0) return -(WIN - ply);
  const opponent = jgOpponent(side);
  let best = -Infinity;
  for (const move of moves) {
    if (jgIsDen(move.to, opponent)) return WIN - ply - 1;
    const next = child(cells, move);
    const score = depth <= 1
      ? -quiesce(next, opponent, -beta, -alpha, QUIET_DEPTH, ply + 1, limits, counter)
      : -searchNode(next, opponent, depth - 1, -beta, -alpha, ply + 1, limits, counter);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export interface JungleSearchOptions {
  /** Deepest ply to search. */
  readonly maxDepth: number;
  readonly expired: () => boolean;
  readonly random: () => number;
}

/**
 * Iterative deepening from the shallowest ply: the best move of the last fully searched depth wins, and equal
 * moves are chosen between at random. Returns null when `side` has no legal move.
 */
export function searchBestMove(cells: Cells, side: JgSide, options: JungleSearchOptions): JgMove | null {
  const moves = ordered(cells, side, false);
  if (moves.length === 0) return null;
  let best = moves[0];
  if (moves.length === 1) return best;
  const opponent = jgOpponent(side);
  const winning = moves.find((move) => jgIsDen(move.to, opponent));
  if (winning) return winning;
  let order = moves;
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const counter = { nodes: 0 };
    let alpha = -Infinity;
    let scores: { move: JgMove; score: number }[] = [];
    try {
      for (const move of order) {
        // Equal scores are all kept, so the window may only cut moves that are strictly worse.
        const score = -searchNode(child(cells, move), opponent, depth, -Infinity, -alpha + 1, 1, options, counter);
        scores.push({ move, score });
        if (score > alpha) alpha = score;
      }
    } catch (error) {
      if (error instanceof Stop) break;
      throw error;
    }
    scores = scores.sort((a, b) => b.score - a.score);
    const top = scores.filter((entry) => entry.score === scores[0].score);
    best = top[Math.floor(options.random() * top.length)].move;
    order = scores.map((entry) => entry.move);
    // A forced win or loss will not change with more depth.
    if (Math.abs(scores[0].score) > WIN - 1000 || options.expired()) break;
  }
  return best;
}

/** The searcher's board for a view's cells. */
export function searchCells(cells: JungleVisibleState['cells']): Cells {
  return Int8Array.from(cells);
}

export function moveAction(move: JgMove): BotAction {
  return {
    type: 'game-action',
    request: { gameType: 'jungle', action: { type: 'move', from: jgNode(move.from), to: jgNode(move.to) } },
  };
}

/** Plies the synchronous move looks ahead: enough to avoid hanging pieces, cheap enough for a timeout. */
export const QUICK_DEPTH = 3;

/** Search strategy for the bot worker pool. */
export function jungleSearch(visible: JungleVisibleState, context: SearchContext): BotAction | null {
  const side = visible.seats.indexOf(visible.mySeat);
  if (side < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const move = searchBestMove(searchCells(visible.cells), side === 0 ? 0 : 1, {
    maxDepth: context.budget.maxDepth ?? 12, expired: context.budget.expired, random: context.random,
  });
  return move === null ? null : moveAction(move);
}
