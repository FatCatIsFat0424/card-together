// ─── Go search: UCT with RAVE over light playouts, a tactical easy move, and the scoring-phase marking check ───
//
// Pure and synchronous: the hard move runs inside a bot worker for its wall-clock budget; the easy move and the
// marking check are cheap enough for the event loop. Playouts never fill their own single-point eyes, prefer
// capturing or rescuing chains recently left in atari, and are otherwise random (see `go-ownership.ts`).

import { goChain, goLegalPoints, goLiberties, goMoveLimit, goNode, goOpponent, goScore } from '@shared/rules/go';
import type { GoHash, GoMove, GoPosition, GoSide, GoSize } from '@shared/rules/go';
import { goMovesOfLog, goReplayLog } from '@shared/rules/go-match';
import {
  EDGE, EMPTY, goAtariLiberty, goBoardHash, goBoardIsEye, goBoardOwner, goBoardPass, goBoardPlay,
  goChainSafety, goClonePlayoutBoard, goCopyPlayoutBoard, goEstimateDead, goInAtari, goOwnerBalance, goOwnership,
  goPlayoutBoard, goPlayoutCandidate, goRunPlayout, goSelfAtariSize,
} from '@shared/rules/go-ownership';
import type { GoColour, GoPlayoutBoard } from '@shared/rules/go-ownership';
import type { GoVisibleState } from '@shared/types';
import type { BotAction } from './bot-decisions';
import type { SearchBudget, SearchContext } from './search/search-types';

const PASS = -1;

/** Visits a leaf needs before its children are added. */
const EXPAND_AT = 2;
/** Tree size after which leaves stop expanding, so a long budget on 19 × 19 stays within worker memory. */
const MAX_NODES = 1_000_000;
/** UCT exploration constant; RAVE already spreads early visits, so it stays small. */
const EXPLORATION = 0.1;
/** RAVE equivalence: the AMAF value's weight halves after about this many real visits. */
const RAVE_EQUIVALENCE = 600;
/** Prior for a capture or an escape from atari: virtual visits and wins. */
const TACTICAL_PRIOR: readonly [number, number] = [20, 16];
/** Prior for a first-line move: rarely useful, so it starts with a poor record. */
const EDGE_PRIOR: readonly [number, number] = [20, 6];
/** Value of a child with neither visits nor AMAF record. */
const UNKNOWN_VALUE = 0.5;
/** Breaks exact ties between equally scored children at random. */
const TIE_NOISE = 1e-6;
/** Root iterations between clock checks. */
const CLOCK_EVERY = 8;
/** Below this win rate the bot may pass and accept the count; above `SETTLED` passing cannot cost the game. */
const HOPELESS = 0.1;
const SETTLED = 0.9;
/** Real visits the pass needs before its win rate is trusted. */
const PASS_VISITS = 30;
/** Iterations when neither a budget nor a cap is given. */
const DEFAULT_ITERATIONS = 5_000;

interface TreeNode {
  /** Padded point, or `PASS`. */
  readonly move: number;
  /** The colour that played `move`. */
  readonly colour: GoColour;
  children: TreeNode[] | null;
  /** Visits and wins, the prior's virtual ones included. */
  visits: number;
  wins: number;
  /** The virtual visits and wins of the prior, left out of the final choice. */
  readonly prior: number;
  readonly priorWins: number;
  raveVisits: number;
  raveWins: number;
  /** Recreates an earlier board (superko); never selected again. */
  illegal: boolean;
}

const newNode = (move: number, colour: GoColour, prior: readonly [number, number] = [0, 0]): TreeNode => ({
  move, colour, children: null, visits: prior[0], wins: prior[1], prior: prior[0], priorWins: prior[1],
  raveVisits: 0, raveWins: 0, illegal: false,
});

/** Real visits, without the prior. */
const played = (node: TreeNode): number => node.visits - node.prior;

export interface GoSearchOptions {
  readonly random: () => number;
  /** Wall-clock limit, as in `SearchContext.budget`; without it only `maxIterations` stops the search. */
  readonly budget?: Pick<SearchBudget, 'expired'>;
  /** Iteration cap: with no budget the search is reproducible for a given `random`. */
  readonly maxIterations?: number;
}

/** First-line points: distance 0 from the edge. */
function onFirstLine(board: GoPlayoutBoard, point: number): boolean {
  const { size, toIndex } = board.layout;
  const index = toIndex[point];
  const col = index % size;
  const row = Math.floor(index / size);
  return col === 0 || row === 0 || col === size - 1 || row === size - 1;
}

/** Liberties of every chain in atari, for the expansion prior: captures for one side, escapes for the other. */
function tacticalPoints(board: GoPlayoutBoard): Set<number> {
  const points = new Set<number>();
  for (const point of board.layout.toPoint) {
    const colour = board.colour[point];
    if (colour !== EMPTY && colour !== EDGE && goInAtari(board, board.head[point])) {
      points.add(goAtariLiberty(board, board.head[point]));
    }
  }
  return points;
}

function expand(node: TreeNode, board: GoPlayoutBoard, roots?: readonly number[]): number {
  const colour = board.toMove;
  const tactical = tacticalPoints(board);
  const moves = roots ?? Array.from(board.empties.subarray(0, board.emptyCount)).filter((point) => goPlayoutCandidate(board, point));
  const stoneCount = board.layout.size * board.layout.size - board.emptyCount;
  node.children = moves.map((point) => newNode(point, colour,
    tactical.has(point) ? TACTICAL_PRIOR : stoneCount < 2 * board.layout.size && onFirstLine(board, point) ? EDGE_PRIOR : undefined));
  if (node.children.length === 0) node.children.push(newNode(PASS, colour));
  return node.children.length;
}

function select(node: TreeNode, random: () => number): TreeNode | null {
  const children = node.children!;
  const logParent = Math.log(node.visits + 1);
  let best: TreeNode | null = null;
  let bestValue = -Infinity;
  for (const child of children) {
    if (child.illegal) continue;
    // Unvisited children rank by their AMAF record (beta is 1 at zero visits), so priors and RAVE steer breadth.
    const mean = child.visits > 0 ? child.wins / child.visits : 0;
    const amaf = child.raveVisits > 0 ? child.raveWins / child.raveVisits : UNKNOWN_VALUE;
    const beta = Math.sqrt(RAVE_EQUIVALENCE / (3 * child.visits + RAVE_EQUIVALENCE));
    const value = (1 - beta) * mean + beta * amaf + EXPLORATION * Math.sqrt(logParent / (child.visits + 1))
      + random() * TIE_NOISE;
    if (value > bestValue) {
      bestValue = value;
      best = child;
    }
  }
  return best;
}

/** Mean result of a node's real visits for the side that played into it. */
const winRate = (node: TreeNode): number => (played(node) > 0 ? (node.wins - node.priorWins) / played(node) : 0);

/** Root candidates from the logical rules: legal (superko included), not an own-eye fill or a large self-atari. */
function rootMoves(position: GoPosition, history: readonly GoHash[], board: GoPlayoutBoard): number[] {
  const { toPoint } = board.layout;
  return goLegalPoints(position, history).map((index) => toPoint[index])
    .filter((point) => !goBoardIsEye(board, point, board.toMove) && goSelfAtariSize(board, point) < 2);
}

/** Whether the side to move wins if play stopped now and the server's dead-stone proposal were accepted. */
function winsCountNow(position: GoPosition): boolean {
  const score = goScore(position.size, position.stones, goEstimateDead(position), position.komi);
  return score.winner === position.toMove;
}

/**
 * UCT with RAVE from the position. Passes when no sensible move is left (only own-eye fills or self-ataris), when
 * the game looks decided either way and passing scores at least as well as the best move, or after the
 * opponent's pass when the count already wins (or nothing can save the game). `history` holds every earlier
 * board's hash for superko.
 */
export function goBestMove(position: GoPosition, history: readonly GoHash[], options: GoSearchOptions): GoMove {
  const root = goPlayoutBoard(position);
  const moves = rootMoves(position, history, root);
  const opponentPassed = position.passes > 0;
  if (moves.length === 0) return 'pass';
  if (opponentPassed && winsCountNow(position)) return 'pass';

  const ownColour = root.toMove;
  const tree = newNode(PASS, ownColour === 1 ? 2 : 1);
  let nodes = expand(tree, root, moves);
  if (!opponentPassed) tree.children!.push(newNode(PASS, ownColour));

  const seen = new Set<GoHash>(history);
  const work = goClonePlayoutBoard(root);
  const { cells } = root.layout;
  const points = root.layout.size * root.layout.size;
  const owner = new Int8Array(points);
  const firstColour = new Uint8Array(cells);
  const sequencePoints: number[] = [];
  const sequenceColours: GoColour[] = [];
  const path: TreeNode[] = [];
  /** Sequence length when each path node was entered. */
  const pathStarts: number[] = [];
  const pathHashes: GoHash[] = [];
  const maxIterations = options.maxIterations ?? (options.budget ? Infinity : DEFAULT_ITERATIONS);
  const random = options.random;
  const record = (point: number, colour: GoColour): void => {
    sequencePoints.push(point);
    sequenceColours.push(colour);
  };

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (options.budget && iteration % CLOCK_EVERY === 0 && iteration > 0 && options.budget.expired()) break;
    goCopyPlayoutBoard(root, work);
    path.length = 0;
    pathStarts.length = 0;
    pathHashes.length = 0;
    sequencePoints.length = 0;
    sequenceColours.length = 0;
    let node = tree;
    path.push(node);
    pathStarts.push(0);
    let illegal = false;
    while (node.children && work.passes < 2) {
      const child = select(node, random);
      if (!child) break;
      if (child.move === PASS) {
        goBoardPass(work);
      } else {
        const colour = work.toMove;
        goBoardPlay(work, child.move);
        const hash = goBoardHash(work);
        if (seen.has(hash) || pathHashes.includes(hash)) {
          child.illegal = true;
          illegal = true;
          break;
        }
        pathHashes.push(hash);
        record(child.move, colour);
      }
      node = child;
      path.push(node);
      pathStarts.push(sequencePoints.length);
      if (!node.children && played(node) >= EXPAND_AT && work.passes < 2 && nodes < MAX_NODES) nodes += expand(node, work);
    }
    if (illegal) continue;

    if (work.passes < 2) goRunPlayout(work, random, owner, { maxMoves: points * 3, onMove: record });
    else goBoardOwner(work, owner);
    const blackWins = goOwnerBalance(owner) - position.komi > 0;

    // AMAF: walk the sequence backwards so `firstColour` holds who played each point first from a node's depth
    // on, and credit that node's children once the walk reaches the point where the node was entered.
    firstColour.fill(0);
    let at = sequencePoints.length - 1;
    for (let index = path.length - 1; index >= 0; index--) {
      for (; at >= pathStarts[index]; at--) firstColour[sequencePoints[at]] = sequenceColours[at];
      updateRave(path[index], firstColour, blackWins);
    }
    for (const visited of path) {
      visited.visits++;
      if ((visited.colour === 1) === blackWins) visited.wins++;
    }
  }

  const children = tree.children!.filter((child) => !child.illegal);
  const placements = children.filter((child) => child.move !== PASS);
  if (placements.length === 0) return 'pass';
  const best = placements.reduce((top, child) => (played(child) > played(top) ? child : top));
  if (opponentPassed && winRate(best) < HOPELESS) return 'pass';
  const pass = children.find((child) => child.move === PASS);
  const decided = winRate(best) >= SETTLED || winRate(best) <= HOPELESS;
  if (pass && decided && played(pass) >= PASS_VISITS && winRate(pass) >= winRate(best)) return 'pass';
  return root.layout.toIndex[best.move];
}

/**
 * Credits a node's children with the playout's result when their move was first played, by their colour, at or
 * after the node's depth: the all-moves-as-first heuristic.
 */
function updateRave(node: TreeNode, firstColour: Uint8Array, blackWins: boolean): void {
  if (!node.children) return;
  for (const child of node.children) {
    if (child.move === PASS || firstColour[child.move] !== child.colour) continue;
    child.raveVisits++;
    if ((child.colour === 1) === blackWins) child.raveWins++;
  }
}

// ─── Easy ───

/** Chebyshev distance from an existing stone within which the easy bot plays its random moves. */
const EASY_REACH = 2;

const pickRandom = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)];

/**
 * Easy: capture the most stones it can, else save its largest chain in atari, else a random move that neither
 * fills its own eye nor puts itself in atari, near the stones already down when it can, else pass. Also serves
 * a player's timeout, so it passes only when no such move is left.
 */
export function goEasyMove(position: GoPosition, history: readonly GoHash[], random: () => number): GoMove {
  if (position.passes >= 2) return 'pass';
  const { size, stones, toMove } = position;
  const board = goPlayoutBoard(position);
  const { toPoint } = board.layout;
  const legal = goLegalPoints(position, history).filter((index) => !goBoardIsEye(board, toPoint[index], board.toMove));
  if (legal.length === 0) return 'pass';
  const legalSet = new Set(legal);

  const chains: number[][] = [];
  const inChain = new Uint8Array(stones.length);
  for (let index = 0; index < stones.length; index++) {
    if (stones[index] === null || inChain[index]) continue;
    const chain = goChain(size, stones, index);
    for (const stone of chain) inChain[stone] = 1;
    chains.push(chain);
  }
  let capture: { point: number; size: number } | null = null;
  let escape: { point: number; size: number } | null = null;
  for (const chain of chains) {
    const liberties = goLiberties(size, stones, chain);
    if (liberties.length !== 1 || !legalSet.has(liberties[0])) continue;
    const point = liberties[0];
    if (stones[chain[0]] === goOpponent(toMove)) {
      if (!capture || chain.length > capture.size) capture = { point, size: chain.length };
    } else if (goSelfAtariSize(board, toPoint[point]) === 0) {
      if (!escape || chain.length > escape.size) escape = { point, size: chain.length };
    }
  }
  if (capture) return capture.point;
  if (escape) return escape.point;

  const quiet = legal.filter((index) => goSelfAtariSize(board, toPoint[index]) === 0);
  const near = quiet.filter((index) => {
    const col = index % size;
    const row = Math.floor(index / size);
    for (let dr = -EASY_REACH; dr <= EASY_REACH; dr++) {
      for (let dc = -EASY_REACH; dc <= EASY_REACH; dc++) {
        const c = col + dc;
        const r = row + dr;
        if (c >= 0 && c < size && r >= 0 && r < size && stones[r * size + c] !== null) return true;
      }
    }
    return false;
  });
  if (near.length > 0) return pickRandom(near, random);
  if (quiet.length === 0) return 'pass';
  // Nothing down yet (or nothing near): start away from the edge rather than anywhere.
  const inner = quiet.filter((index) => {
    const col = index % size;
    const row = Math.floor(index / size);
    return Math.min(col, row, size - 1 - col, size - 1 - row) >= 2;
  });
  return pickRandom(inner.length > 0 ? inner : quiet, random);
}

// ─── Scoring phase ───

/** Playouts behind the marking check. */
const MARKING_PLAYOUTS = 400;
/** A chain counts as clearly alive when its own side owns its points in at least 70% of the playouts. */
const ALIVE_BALANCE = 0.4;

/**
 * Whether `side` should resume play rather than accept `dead`: some chain of its own is marked dead although its
 * own estimate (unconditional life, or ownership of at least 70%) says the chain lives.
 */
export function goShouldContestMarking(
  position: GoPosition, side: GoSide, dead: readonly number[], random: () => number,
): boolean {
  const own = dead.filter((point) => position.stones[point] === side);
  if (own.length === 0) return false;
  const safety = goChainSafety(position, goOwnership(position, { random, playouts: MARKING_PLAYOUTS }));
  return own.some((point) => safety[point] >= ALIVE_BALANCE);
}

// ─── The visible state: what a seat sees, and the actions the bots answer with ───

/**
 * Iteration caps for the worker search, from the measured engine speed (about 30k iterations a second on 9 × 9,
 * 16k on 13 × 13, 8k on 19 × 19): roughly a third of a second on 9 × 9 and a second or two on the larger boards.
 */
export const GO_SEARCH_ITERATIONS: Readonly<Record<GoSize, number>> = { 9: 8_000, 13: 14_000, 19: 16_000 };

/** Iterations of the cheap synchronous move that serves a seat on auto-play. */
export const GO_QUICK_ITERATIONS = 300;

/** Times a bot may send the count back to play: later disagreements are accepted, so bots cannot loop forever. */
export const GO_MAX_CONTESTS = 2;

export interface GoSeatView {
  readonly position: GoPosition;
  readonly history: readonly GoHash[];
  /** The viewer's side */
  readonly side: GoSide;
}

/** The position and superko history behind a view, or null for a spectator or an inconsistent log. */
export function goSeatView(visible: GoVisibleState): GoSeatView | null {
  const index = visible.seats.indexOf(visible.mySeat);
  if (index < 0) return null;
  const moves = goMovesOfLog(visible.options.size, visible.log);
  const game = moves && goReplayLog(visible.options, moves, visible.resumes);
  return game ? { position: game.position, history: game.history, side: index === 0 ? 0 : 1 } : null;
}

export const goPlaceAction = (size: GoSize, point: number): BotAction => (
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
 * The answer to the proposed dead stones: send the count back to play when the bot's own estimate says one of
 * its chains marked dead lives (and play can continue), otherwise accept.
 */
export function goMarkingAction(visible: GoVisibleState, random: () => number): BotAction | null {
  if (!goMarkingTurn(visible)) return null;
  const view = goSeatView(visible);
  if (view && visible.resumes.length < GO_MAX_CONTESTS && view.position.moves < goMoveLimit(visible.options.size)
    && goShouldContestMarking(view.position, view.side, visible.dead, random)) {
    return { type: 'game-action', request: { gameType: 'go', action: { type: 'resume' } } };
  }
  return goConfirmAction(visible);
}

/** Search strategy for the bot worker pool: plays, passes, or answers the marking. */
export function goSearch(visible: GoVisibleState, context: SearchContext): BotAction | null {
  if (goMarkingTurn(visible)) return goMarkingAction(visible, context.random);
  if (!goPlayingTurn(visible)) return null;
  const view = goSeatView(visible);
  if (!view) return null;
  const move = goBestMove(view.position, view.history, {
    random: context.random, budget: context.budget, maxIterations: GO_SEARCH_ITERATIONS[visible.options.size],
  });
  return goMoveAction(visible, move);
}
