// ─── Go bot Monte Carlo tree search: UCT with RAVE and priors over a typed-array tree ───
//
// Nodes live in preallocated typed arrays (about 33 bytes each), so a long search allocates nothing and its memory
// is bounded by `TREE_CAPACITY` whatever the board size. Children are stored contiguously; a node is expanded once
// it has `expandAt` real visits and its children start with virtual visits and wins from hand-set tactical priors
// plus the fitted move model (`go-model-weights.ts`). Selection follows the RAVE urgency of MoGo and Michi without
// an exploration term: priors and AMAF statistics already spread the early visits.

import type { GoHash } from '@shared/rules/go';
import {
  BLACK, PASS, boardHash, cloneBoard, copyBoard, isEye, isLegal, playMove, playPass, playoutBalance, selfAtariSize,
} from './go-board';
import type { Board } from './go-board';
import {
  ATARI_LADDER, CAPTURE_LAST, CAPTURE_MANY, CAPTURE_ONE, CAPTURE_SAVES, ESCAPE_SAFE, ESCAPE_TWO, MAX_MOVE_FEATURES,
  analyzeMoves, inEmptyArea, mogoAt, moveFeatures,
} from './go-features';
import type { MoveAnalysis } from './go-features';
import { modelLogStrength } from './go-model';
import { createPlayoutState, recordMove, runPlayout, updateReplies } from './go-playout';
import type { PlayoutState } from './go-playout';

/** Nodes the tree may hold: about 17 MB of typed arrays, allocated once per worker. */
export const TREE_CAPACITY = 1 << 19;

/** Tunable search parameters; `DEFAULT_PARAMETERS` is what the bot plays. */
export interface SearchParameters {
  /** Real visits a leaf needs before its children are added. */
  readonly expandAt: number;
  /** RAVE equivalence: the AMAF value keeps half its weight after about this many visits. */
  readonly raveEquivalence: number;
  /** UCT exploration constant (0: priors and RAVE alone spread the visits). */
  readonly exploration: number;
  readonly priorEven: number;
  readonly priorCaptureOne: number;
  readonly priorCaptureMany: number;
  readonly priorPattern: number;
  /** Bonus for distances 1, 2, and 3 from the last move in the common-fate graph. */
  readonly priorDistance: readonly number[];
  readonly priorEmptyArea: number;
  readonly priorSelfAtari: number;
  /** Weight of the square-rooted probability of the fitted move model. */
  readonly priorModel: number;
  readonly lastGoodReply: boolean;
}

export const DEFAULT_PARAMETERS: SearchParameters = {
  expandAt: 8,
  raveEquivalence: 3500,
  exploration: 0,
  priorEven: 10,
  priorCaptureOne: 15,
  priorCaptureMany: 30,
  priorPattern: 10,
  priorDistance: [24, 22, 8],
  priorEmptyArea: 10,
  priorSelfAtari: 10,
  priorModel: 40,
  lastGoodReply: true,
};

interface Tree {
  readonly move: Int16Array;
  /** Index of the first child, or -1 while the node is a leaf. */
  readonly first: Int32Array;
  readonly count: Uint16Array;
  readonly visits: Float32Array;
  readonly wins: Float32Array;
  readonly priorVisits: Float32Array;
  readonly priorWins: Float32Array;
  readonly raveVisits: Float32Array;
  readonly raveWins: Float32Array;
  /** Recreates an earlier board (superko); never selected again. */
  readonly illegal: Uint8Array;
  size: number;
}

let sharedTree: Tree | null = null;

function freshTree(): Tree {
  sharedTree ??= {
    move: new Int16Array(TREE_CAPACITY), first: new Int32Array(TREE_CAPACITY), count: new Uint16Array(TREE_CAPACITY),
    visits: new Float32Array(TREE_CAPACITY), wins: new Float32Array(TREE_CAPACITY),
    priorVisits: new Float32Array(TREE_CAPACITY), priorWins: new Float32Array(TREE_CAPACITY),
    raveVisits: new Float32Array(TREE_CAPACITY), raveWins: new Float32Array(TREE_CAPACITY),
    illegal: new Uint8Array(TREE_CAPACITY), size: 0,
  };
  sharedTree.size = 0;
  return sharedTree;
}

/** Bytes of typed arrays the tree holds once allocated. */
export const TREE_BYTES = TREE_CAPACITY * (2 + 4 + 2 + 6 * 4 + 1);

function addNode(tree: Tree, move: number, priorVisits: number, priorWins: number): void {
  const node = tree.size++;
  tree.move[node] = move;
  tree.first[node] = -1;
  tree.count[node] = 0;
  tree.visits[node] = 0;
  tree.wins[node] = 0;
  tree.priorVisits[node] = priorVisits;
  tree.priorWins[node] = priorWins;
  tree.raveVisits[node] = 0;
  tree.raveWins[node] = 0;
  tree.illegal[node] = 0;
}

const featureScratch = new Int32Array(MAX_MOVE_FEATURES);

/** Virtual visits and wins of the side to move playing `point`, written to `out` as [visits, wins]. */
function prior(
  board: Board, point: number, analysis: MoveAnalysis, parameters: SearchParameters, modelShare: number,
  out: Float64Array,
): void {
  let visits = parameters.priorEven;
  let wins = parameters.priorEven / 2;
  const capture = analysis.capture[point];
  const escape = analysis.escape[point];
  if (capture === CAPTURE_LAST || capture === CAPTURE_SAVES || capture === CAPTURE_MANY || analysis.atari[point] === ATARI_LADDER) {
    visits += parameters.priorCaptureMany;
    wins += parameters.priorCaptureMany;
  } else if (capture === CAPTURE_ONE || escape === ESCAPE_SAFE || escape === ESCAPE_TWO) {
    visits += parameters.priorCaptureOne;
    wins += parameters.priorCaptureOne;
  }
  if (mogoAt(board, point)) {
    visits += parameters.priorPattern;
    wins += parameters.priorPattern;
  }
  const distance = analysis.distLast[point];
  if (distance >= 1 && distance <= parameters.priorDistance.length) {
    visits += parameters.priorDistance[distance - 1];
    wins += parameters.priorDistance[distance - 1];
  }
  const line = board.geometry.line[point];
  if (line <= 3 && inEmptyArea(board, point)) {
    visits += parameters.priorEmptyArea;
    if (line === 3) wins += parameters.priorEmptyArea;
  }
  if (selfAtariSize(board, point, board.toMove) >= 2) visits += parameters.priorSelfAtari;
  if (modelShare > 0) {
    visits += modelShare * parameters.priorModel;
    wins += modelShare * parameters.priorModel;
  }
  out[0] = visits;
  out[1] = wins;
}

const priorScratch = new Float64Array(2);
/** Model shares of the candidates being expanded; a board has at most 361 points. */
const shareScratch = new Float64Array(512);

/** Adds the children of `node` for the side to move on `board`; `moves` overrides the generated candidates. */
function expand(
  tree: Tree, node: number, board: Board, parameters: SearchParameters, moves: readonly number[] | null, allowPass: boolean,
): void {
  const own = board.toMove;
  const candidates: number[] = [];
  if (moves) {
    candidates.push(...moves);
  } else {
    const { empties } = board;
    for (let slot = 0; slot < board.emptyCount; slot++) {
      const point = empties[slot];
      if (!isEye(board, point, own) && isLegal(board, point)) candidates.push(point);
    }
  }
  const needed = candidates.length + (allowPass || candidates.length === 0 ? 1 : 0);
  if (tree.size + needed > TREE_CAPACITY) return;
  const analysis = analyzeMoves(board);
  let shares: Float64Array | null = null;
  if (parameters.priorModel > 0 && candidates.length > 0) {
    shares = shareScratch;
    let best = -Infinity;
    for (let index = 0; index < candidates.length; index++) {
      const count = moveFeatures(board, candidates[index], analysis, featureScratch);
      shares[index] = modelLogStrength(featureScratch, count);
      if (shares[index] > best) best = shares[index];
    }
    let total = 0;
    for (let index = 0; index < candidates.length; index++) {
      shares[index] = Math.exp(shares[index] - best);
      total += shares[index];
    }
    for (let index = 0; index < candidates.length; index++) shares[index] = Math.sqrt(shares[index] / total);
  }
  tree.first[node] = tree.size;
  tree.count[node] = needed;
  for (let index = 0; index < candidates.length; index++) {
    prior(board, candidates[index], analysis, parameters, shares ? shares[index] : 0, priorScratch);
    addNode(tree, candidates[index], priorScratch[0], priorScratch[1]);
  }
  if (needed > candidates.length) addNode(tree, PASS, parameters.priorEven, parameters.priorEven / 2);
}

/** Tie-breaking noise between equally urgent children. */
const TIE_NOISE = 1e-6;

function select(tree: Tree, node: number, parameters: SearchParameters, random: () => number): number {
  const first = tree.first[node];
  const end = first + tree.count[node];
  const { visits, wins, priorVisits, priorWins, raveVisits, raveWins, illegal } = tree;
  const equivalence = parameters.raveEquivalence;
  const exploration = parameters.exploration;
  const logParent = exploration > 0 ? Math.log(visits[node] + 1) : 0;
  let best = -1;
  let bestValue = -Infinity;
  for (let child = first; child < end; child++) {
    if (illegal[child]) continue;
    const seen = visits[child] + priorVisits[child];
    let value = seen > 0 ? (wins[child] + priorWins[child]) / seen : 0.5;
    const rave = raveVisits[child];
    if (rave > 0) {
      const beta = rave / (rave + seen + seen * rave / equivalence);
      value = beta * (raveWins[child] / rave) + (1 - beta) * value;
    }
    if (exploration > 0) value += exploration * Math.sqrt(logParent / (visits[child] + 1));
    value += random() * TIE_NOISE;
    if (value > bestValue) {
      bestValue = value;
      best = child;
    }
  }
  return best;
}

export interface MctsOptions {
  readonly random: () => number;
  /** Wall-clock limit; `timeLeftMs` also lets the search stop once the choice can no longer change. */
  readonly budget?: { readonly expired: () => boolean; readonly timeLeftMs?: () => number };
  readonly maxIterations?: number;
  /** Komi the playouts score with (the real komi, plus any dynamic komi). */
  readonly komi: number;
  /** Hashes of every earlier board: tree moves that recreate one are illegal. */
  readonly history: ReadonlySet<GoHash>;
  /** Legal root moves (padded points) from the authoritative rules. */
  readonly rootMoves: readonly number[];
  /** Whether the root may pass. */
  readonly allowPass: boolean;
  readonly parameters?: SearchParameters;
}

export interface RootChild {
  /** Padded point, or `PASS`. */
  readonly move: number;
  /** Real visits and their mean result for the side to move. */
  readonly visits: number;
  readonly winRate: number;
}

export interface MctsResult {
  /** Legal root children, most visited first. */
  readonly children: readonly RootChild[];
  readonly iterations: number;
  readonly nodes: number;
}

/**
 * Share of the budget, up to `RESERVE_MS`, left unused for the pass checks after the search and the hand-over to the
 * server. A 19 × 19 playout under load can take tens of milliseconds, so the clock is read before every iteration.
 */
const RESERVE_SHARE = 0.03;
const RESERVE_MS = 60;
/** Iterations between checks whether the choice is already settled. */
const SETTLED_EVERY = 64;
/** Iterations when neither a budget nor a cap is given. */
const DEFAULT_ITERATIONS = 5_000;
/** Iterations after which even a budgeted search stops, should its clock never expire. */
const MAX_ITERATIONS = 2_000_000;

interface SearchScratch {
  readonly work: Board;
  readonly state: PlayoutState;
  readonly firstColour: Uint8Array;
  readonly path: Int32Array;
  readonly pathStart: Int32Array;
  readonly pathHashes: Float64Array;
}

const SCRATCH = new Map<number, SearchScratch>();

function searchScratch(root: Board, random: () => number, lastGoodReply: boolean): SearchScratch {
  const { cells, size } = root.geometry;
  let scratch = SCRATCH.get(size);
  if (!scratch) {
    scratch = {
      work: cloneBoard(root), state: createPlayoutState(root, random, lastGoodReply), firstColour: new Uint8Array(cells),
      path: new Int32Array(cells * 2), pathStart: new Int32Array(cells * 2), pathHashes: new Float64Array(cells * 2),
    };
    SCRATCH.set(size, scratch);
  }
  return scratch;
}

/** Runs the search from `root` (not modified) and returns the root children's statistics. */
export function runMcts(root: Board, options: MctsOptions): MctsResult {
  const parameters = options.parameters ?? DEFAULT_PARAMETERS;
  const { random, komi, history } = options;
  const started = performance.now();
  const tree = freshTree();
  addNode(tree, PASS, 0, 0);
  expand(tree, 0, root, parameters, options.rootMoves, options.allowPass);
  const scratch = searchScratch(root, random, parameters.lastGoodReply);
  const { work, firstColour, path, pathStart, pathHashes } = scratch;
  const state: PlayoutState = { ...scratch.state, random, useReplies: parameters.lastGoodReply };
  state.reply1.fill(-1);
  state.reply2.fill(-1);
  const { cells } = root.geometry;
  const points = root.geometry.size * root.geometry.size;
  const maxPlayout = points * 3;
  const maxIterations = Math.min(MAX_ITERATIONS, options.maxIterations ?? (options.budget ? MAX_ITERATIONS : DEFAULT_ITERATIONS));
  const rootColour = root.toMove;
  const reserve = Math.min(RESERVE_MS, RESERVE_SHARE * (options.budget?.timeLeftMs?.() ?? 0));
  const { move: moveOf, visits, wins, raveVisits, raveWins, first, count } = tree;
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    if (options.budget && iterations > 0) {
      if (options.budget.expired()) break;
      const left = options.budget.timeLeftMs?.();
      if (left !== undefined && (left < reserve
        || (iterations % SETTLED_EVERY === 0 && settled(tree, iterations / (performance.now() - started), left)))) break;
    }
    copyBoard(root, work);
    state.length = 0;
    let depth = 0;
    let node = 0;
    path[0] = 0;
    pathStart[0] = 0;
    let illegal = false;
    while (first[node] >= 0 && work.passes < 2) {
      const child = select(tree, node, parameters, random);
      if (child < 0) break;
      const colour = work.toMove;
      const move = moveOf[child];
      if (move === PASS) {
        playPass(work);
      } else {
        playMove(work, move);
        const hash = boardHash(work);
        let repeated = history.has(hash);
        for (let index = 0; index < depth && !repeated; index++) repeated = pathHashes[index] === hash;
        if (repeated) {
          tree.illegal[child] = 1;
          illegal = true;
          break;
        }
        pathHashes[depth] = hash;
      }
      recordMove(state, move, colour);
      node = child;
      depth++;
      path[depth] = node;
      pathStart[depth] = state.length;
      if (first[node] < 0 && visits[node] >= parameters.expandAt && work.passes < 2) {
        expand(tree, node, work, parameters, null, false);
      }
    }
    if (illegal) continue;
    if (work.passes >= 2) {
      // Two passes inside the tree: the count removes dead stones, so let a playout settle them first.
      work.passes = 0;
    }
    runPlayout(work, state, maxPlayout);
    const blackWins = playoutBalance(work) - komi > 0;
    if (parameters.lastGoodReply) updateReplies(state, cells, blackWins);

    // AMAF: walk the sequence backwards so `firstColour` holds who played each point first from a node's depth on,
    // and credit that node's children once the walk reaches the point where the node was entered.
    firstColour.fill(0);
    let at = state.length - 1;
    const { sequence, sequenceColour } = state;
    for (let index = depth; index >= 0; index--) {
      for (; at >= pathStart[index]; at--) if (sequence[at] !== PASS) firstColour[sequence[at]] = sequenceColour[at];
      const parent = path[index];
      const start = first[parent];
      if (start < 0) continue;
      // Children of a node at even depth were played by the root's colour.
      const childColour = (index % 2 === 0) === (rootColour === BLACK) ? BLACK : 2;
      const childWins = (childColour === BLACK) === blackWins ? 1 : 0;
      const end = start + count[parent];
      for (let child = start; child < end; child++) {
        const point = moveOf[child];
        if (point === PASS || firstColour[point] !== childColour) continue;
        raveVisits[child]++;
        raveWins[child] += childWins;
      }
    }
    for (let index = 0; index <= depth; index++) {
      const visited = path[index];
      visits[visited]++;
      // The node at depth d was reached by a move of the root's colour when d is odd.
      const mover = (index % 2 === 1) === (rootColour === BLACK) ? BLACK : 2;
      if ((mover === BLACK) === blackWins) wins[visited]++;
    }
  }
  const children: RootChild[] = [];
  for (let child = first[0]; child < first[0] + count[0]; child++) {
    if (tree.illegal[child]) continue;
    children.push({ move: moveOf[child], visits: visits[child], winRate: visits[child] > 0 ? wins[child] / visits[child] : 0 });
  }
  children.sort((a, b) => b.visits - a.visits || b.winRate - a.winRate);
  return { children, iterations, nodes: tree.size };
}

/** Whether the most visited root child can no longer be overtaken in the time left, at `speed` iterations a ms. */
function settled(tree: Tree, speed: number, timeLeftMs: number): boolean {
  const remaining = speed * timeLeftMs;
  let best = 0;
  let second = 0;
  for (let child = tree.first[0]; child < tree.first[0] + tree.count[0]; child++) {
    const seen = tree.visits[child];
    if (seen > best) {
      second = best;
      best = seen;
    } else if (seen > second) {
      second = seen;
    }
  }
  return best - second > remaining;
}
