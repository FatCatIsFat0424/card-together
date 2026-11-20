// ─── Go search: the bot's move choice, its pass judgement, and its answer to the proposed dead stones ───
//
// Pure and synchronous: the move search (`go-mcts.ts`) runs inside a bot worker for its wall-clock budget; the
// synchronous fallback runs the same search with a small cap. Openings come from `go-opening.ts`; handicap games
// score playouts with a dynamic komi that fades out as the game goes on.

import { goLegalPoints, goMoveLimit, goNode, goOpponent, goScore } from '@shared/rules/go';
import type { GoHash, GoMove, GoPosition, GoSide } from '@shared/rules/go';
import { goMovesOfLog, goReplayLog } from '@shared/rules/go-match';
import { goChainSafety, goEstimateDead, goSafetyIsDead } from '@shared/rules/go-ownership';
import type { GoVisibleState } from '@shared/types';
import type { BotAction } from './bot-decisions';
import { BLACK, PASS, WHITE, boardFromPosition, cloneBoard, copyBoard, isEye, playoutBalance, selfAtariSize } from './go-board';
import type { Board } from './go-board';
import { runMcts } from './go-mcts';
import type { SearchParameters } from './go-mcts';
import { goOpeningMove } from './go-opening';
import { createPlayoutState, runPlayout } from './go-playout';
import type { SearchBudget, SearchContext } from './search/search-types';

/** Below this win rate the bot may pass and accept the count; above `SETTLED` passing cannot cost the game. */
const HOPELESS = 0.1;
const SETTLED = 0.9;
/** Real visits the pass needs before its win rate is trusted. */
const PASS_VISITS = 30;
/** Points of dynamic komi per handicap stone at the start; it fades to nothing after `HANDICAP_FADE` × points moves. */
const HANDICAP_STONE_VALUE = 7;
const HANDICAP_FADE = 0.5;

export interface GoSearchOptions {
  readonly random: () => number;
  /** Wall-clock limit, as in `SearchContext.budget`; without it only `maxIterations` stops the search. */
  readonly budget?: Pick<SearchBudget, 'expired'> & Partial<Pick<SearchBudget, 'timeLeftMs'>>;
  /** Iteration cap: with no budget the search is reproducible for a given `random`. */
  readonly maxIterations?: number;
  /** The moves before this position, oldest first: the last two steer the local replies. */
  readonly recent?: readonly GoMove[];
  /** Handicap stones of the game, for the dynamic komi. */
  readonly handicap?: number;
  /** Overrides the search parameters (tests and tuning). */
  readonly parameters?: SearchParameters;
  /** Skips the opening book (tests and tuning). */
  readonly noBook?: boolean;
}

/** Root candidates from the logical rules: legal (superko included), not an own-eye fill or a large self-atari. */
function rootMoves(position: GoPosition, history: readonly GoHash[], board: Board): number[] {
  const { toPoint } = board.geometry.layout;
  return goLegalPoints(position, history).map((index) => toPoint[index])
    .filter((point) => !isEye(board, point, board.toMove) && selfAtariSize(board, point, board.toMove) < 2);
}

/**
 * Whether the side to move wins the count if play stops after `passes` more passes and the server's dead-stone
 * proposal for that position is accepted (the proposal is seeded by the board and the move number).
 */
function winsCountAfter(position: GoPosition, passes: number): boolean {
  const final = { ...position, moves: position.moves + passes, passes: 2 };
  const score = goScore(position.size, position.stones, goEstimateDead(final), position.komi);
  return score.winner === position.toMove;
}

/** The komi playouts score with: in a handicap game black must also cover a value that fades as play goes on. */
export function goSearchKomi(position: GoPosition, handicap: number): number {
  if (handicap < 2) return position.komi;
  const fade = Math.max(0, 1 - position.moves / (HANDICAP_FADE * position.size * position.size));
  return position.komi + HANDICAP_STONE_VALUE * handicap * fade;
}

const paddedMove = (board: Board, move: GoMove | undefined): number => (
  move === undefined || move === 'pass' ? PASS : board.geometry.layout.toPoint[move]);

/**
 * The bot's move. Passes when no sensible move is left (only own-eye fills or self-ataris); after the opponent's
 * pass when the count already wins (or nothing can save the game); and otherwise when the game looks decided,
 * passing scores at least as well as the best move, and the count after a reply pass would win. `history` holds
 * every earlier board's hash for superko.
 */
export function goBestMove(position: GoPosition, history: readonly GoHash[], options: GoSearchOptions): GoMove {
  const recent = options.recent ?? [];
  const board = boardFromPosition(position);
  board.last = paddedMove(board, recent[recent.length - 1]);
  board.last2 = paddedMove(board, recent[recent.length - 2]);
  const moves = rootMoves(position, history, board);
  const opponentPassed = position.passes > 0;
  if (moves.length === 0) return 'pass';
  if (opponentPassed && winsCountAfter(position, 1)) return 'pass';
  if (!options.noBook) {
    const book = goOpeningMove(position, options.random);
    if (book !== null && moves.includes(board.geometry.layout.toPoint[book])) return book;
  }

  const result = runMcts(board, {
    random: options.random, budget: options.budget, maxIterations: options.maxIterations,
    komi: goSearchKomi(position, options.handicap ?? 0), history: new Set(history), rootMoves: moves,
    allowPass: !opponentPassed, parameters: options.parameters,
  });
  const placements = result.children.filter((child) => child.move !== PASS);
  if (placements.length === 0) return 'pass';
  const [best] = placements;
  if (opponentPassed && best.winRate < HOPELESS) return 'pass';
  const pass = result.children.find((child) => child.move === PASS);
  const decided = best.winRate >= SETTLED || best.winRate <= HOPELESS;
  if (pass && decided && pass.visits >= PASS_VISITS && pass.winRate >= best.winRate
    && (best.winRate <= HOPELESS || winsCountAfter(position, 2))) return 'pass';
  return board.geometry.layout.toIndex[best.move];
}

// ─── Scoring phase ───

/** Playouts behind the marking check. */
const MARKING_PLAYOUTS = 600;
/** A chain counts as clearly alive when its own side owns its points in at least 70% of the playouts. */
const ALIVE_BALANCE = 0.4;

/**
 * Average owner of each intersection (1 black, -1 white) over heavy playouts, half of them started by each side;
 * stops early, after an even number of playouts, once `maxMs` have passed.
 */
export function goPlayoutOwnership(position: GoPosition, random: () => number, playouts: number, maxMs = Infinity): Float64Array {
  const began = performance.now();
  const start = boardFromPosition({ ...position, passes: 0 });
  const board = cloneBoard(start);
  const state = createPlayoutState(start, random, false);
  const points = position.size * position.size;
  const owner = new Int8Array(points);
  const total = new Float64Array(points);
  let runs = 0;
  for (; runs < playouts; runs++) {
    if (runs % 2 === 0 && runs > 0 && performance.now() - began >= maxMs) break;
    copyBoard(start, board);
    board.toMove = runs % 2 === 0 ? BLACK : WHITE;
    state.length = 0;
    runPlayout(board, state, points * 3);
    playoutBalance(board, owner);
    for (let index = 0; index < points; index++) total[index] += owner[index];
  }
  if (runs > 0) for (let index = 0; index < points; index++) total[index] /= runs;
  return total;
}

/**
 * Whether `side` should resume play rather than accept `dead`: some chain of its own is marked dead although its
 * own estimate (unconditional life, or ownership of at least 70%) says the chain lives; or the marking loses the
 * count while also marking the opponent chains its estimate calls dead would win it, so capturing them in play
 * changes the result.
 */
export function goShouldContestMarking(
  position: GoPosition, side: GoSide, dead: readonly number[], random: () => number, maxMs = Infinity,
): boolean {
  const safety = goChainSafety(position, goPlayoutOwnership(position, random, MARKING_PLAYOUTS, maxMs));
  const own = dead.filter((point) => position.stones[point] === side);
  if (own.some((point) => safety[point] >= ALIVE_BALANCE)) return true;
  if (goScore(position.size, position.stones, dead, position.komi).winner === side) return false;
  const opponent = goOpponent(side);
  const deadSet = new Set(dead);
  const estimate = [...dead];
  position.stones.forEach((cell, point) => {
    if (cell === opponent && !deadSet.has(point) && goSafetyIsDead(safety[point])) estimate.push(point);
  });
  return estimate.length > dead.length && goScore(position.size, position.stones, estimate, position.komi).winner === side;
}

// ─── The visible state: what a seat sees, and the actions the bots answer with ───

/** Iterations of the cheap synchronous move that serves a seat when no worker answers. */
export const GO_QUICK_ITERATIONS = 300;
/** Wall-clock cap of the synchronous move, which runs on the server's event loop. */
export const GO_QUICK_MS = 60;

/** Times a bot may send the count back to play: later disagreements are accepted, so bots cannot loop forever. */
export const GO_MAX_CONTESTS = 2;

export interface GoSeatView {
  readonly position: GoPosition;
  readonly history: readonly GoHash[];
  /** Every move so far, oldest first */
  readonly moves: readonly GoMove[];
  /** The viewer's side */
  readonly side: GoSide;
}

/** The position and superko history behind a view, or null for a spectator or an inconsistent log. */
export function goSeatView(visible: GoVisibleState): GoSeatView | null {
  const index = visible.seats.indexOf(visible.mySeat);
  if (index < 0) return null;
  const moves = goMovesOfLog(visible.options.size, visible.log);
  const game = moves && goReplayLog(visible.options, moves, visible.resumes);
  return game && moves ? { position: game.position, history: game.history, moves, side: index === 0 ? 0 : 1 } : null;
}

export const goPlaceAction = (size: GoVisibleState['options']['size'], point: number): BotAction => (
  { type: 'game-action', request: { gameType: 'go', action: { type: 'place', to: goNode(size, point) } } });

export const goPassAction = (): BotAction => ({ type: 'game-action', request: { gameType: 'go', action: { type: 'pass' } } });

export function goMoveAction(visible: GoVisibleState, move: GoMove): BotAction {
  return move === 'pass' ? goPassAction() : goPlaceAction(visible.options.size, move);
}

/** Whether the viewer is to play a stone or a pass now. */
export const goPlayingTurn = (visible: GoVisibleState): boolean => (
  visible.phase === 'playing' && visible.currentTurnSeat === visible.mySeat && visible.seats.includes(visible.mySeat));

/** Whether the viewer still owes an answer to the proposed dead stones. */
export const goMarkingTurn = (visible: GoVisibleState): boolean => (
  visible.phase === 'marking' && visible.seats.includes(visible.mySeat) && !visible.confirmed.includes(visible.mySeat));

export const goConfirmAction = (visible: GoVisibleState): BotAction => (
  { type: 'game-action', request: { gameType: 'go', action: { type: 'confirm-score', dead: [...visible.dead] } } });

/**
 * The answer to the proposed dead stones: send the count back to play when the bot's own estimate disagrees in a
 * way that matters (and play can continue), otherwise accept. `maxMs` caps the estimate's playouts.
 */
export function goMarkingAction(visible: GoVisibleState, random: () => number, maxMs = Infinity): BotAction | null {
  if (!goMarkingTurn(visible)) return null;
  const view = goSeatView(visible);
  if (view && visible.resumes.length < GO_MAX_CONTESTS && view.position.moves < goMoveLimit(visible.options.size)
    && goShouldContestMarking(view.position, view.side, visible.dead, random, maxMs)) {
    return { type: 'game-action', request: { gameType: 'go', action: { type: 'resume' } } };
  }
  return goConfirmAction(visible);
}

/** The move for the viewer's turn within `budget` (or `maxIterations`), as an action. */
export function goTurnAction(
  visible: GoVisibleState, random: () => number, budget: GoSearchOptions['budget'], maxIterations?: number,
): BotAction | null {
  const view = goSeatView(visible);
  if (!view) return null;
  const move = goBestMove(view.position, view.history, {
    random, budget, maxIterations, recent: view.moves.slice(-2), handicap: visible.options.handicap,
  });
  return goMoveAction(visible, move);
}

/** Search strategy for the bot worker pool: plays, passes, or answers the marking. */
export function goSearch(visible: GoVisibleState, context: SearchContext): BotAction | null {
  if (goMarkingTurn(visible)) return goMarkingAction(visible, context.random);
  if (!goPlayingTurn(visible)) return null;
  return goTurnAction(visible, context.random, context.budget);
}
