// ─── Chinese checkers search ───
//
// Runs inside a bot worker (`GameBot.search`); a shallow run of the same search is the cheap synchronous move. The
// whole board is public, so the seat's own view is all it reads.
//
// Iterative-deepening principal-variation alpha-beta with a transposition table, over the best-ranked moves of each
// side. With two players it duels the opponent; with more it duels one other seat and leaves the rest standing still. A move is ranked by its own progress plus the best move it makes possible next, and a
// position scores by the rows each side still has to travel (stragglers and drift weigh extra), hops that are ready
// to jump, and how tightly the marbles stand.

import type { ChineseCheckersVisibleState } from '@shared/types';
import {
  CC_BOARD, CC_HOLES, CC_NEIGHBOURS, CC_PIECES, CC_TIP_DISTANCE, CC_TRIANGLES, CC_TURN_LIMIT, ccIndex, ccNode, ccTarget,
} from '@shared/rules/chinesecheckers';
import { rotatePoint, sideRotation } from '@shared/rules/board/board-model';
import type { SearchContext } from './search/search-types';
import { seededRandom } from './search/seeded-random';
import type { BotAction } from './bot-decisions';
import { CHINESE_CHECKERS_WEIGHTS } from './chinesecheckers-weights';

/** Marble corners by hole while searching; -1 is empty. */
export type SearchBoard = Int8Array;

export interface SearchMove {
  readonly from: number;
  readonly to: number;
}

/** Slots of the weight vector; `chinesecheckers-weights.ts` holds the tuned values. */
export const CC_W = {
  /** Extra cost per squared row, so a marble left far behind is worth bringing forward first */
  STRAGGLER: 0,
  /** Cost per hole of sideways drift from the line to the target tip, outside the target */
  DRIFT: 1,
  /** Per row of the best hop each marble could make now: jump chains start from ladders */
  HOP: 2,
  /** Per pair of neighbouring own marbles */
  COHESION: 3,
  /** Cohesion weight when ranking moves */
  ORDER_COHESION: 4,
  /** Cost of undoing the previous move at the root */
  BACKTRACK: 5,
  /** Jitter that breaks ties between equal moves */
  NOISE: 6,
  /** Share of the best move a move makes possible next, so a quiet setup for a long jump chain still ranks high */
  FOLLOW: 7,
  COUNT: 8,
} as const;

const DIRECTIONS = 6;
const EMPTY = -1;
const CORNERS = 6;
const NEXT = Int16Array.from(CC_NEIGHBOURS.flat());
/** Hole a jump from each hole over the neighbour in each direction lands on, or -1. */
const LAND = Int16Array.from({ length: CC_HOLES * DIRECTIONS }, (_, slot) => {
  const over = NEXT[slot];
  return over < 0 ? -1 : NEXT[over * DIRECTIONS + (slot % DIRECTIONS)];
});
/** Triangle each hole belongs to, or -1 in the middle of the star. */
const TRI_OF = new Int8Array(CC_HOLES).fill(-1);
CC_TRIANGLES.forEach((triangle, corner) => triangle.forEach((hole) => { TRI_OF[hole] = corner; }));
const TRIANGLE_SIZE = CC_TRIANGLES[0].length;

/** Rows a hop from each hole in each direction gains towards each corner's target tip. */
const HOP_GAIN = Float64Array.from({ length: CORNERS * CC_HOLES * DIRECTIONS }, (_, slot) => {
  const corner = Math.floor(slot / (CC_HOLES * DIRECTIONS));
  const inner = slot % (CC_HOLES * DIRECTIONS);
  const land = LAND[inner];
  if (land < 0) return 0;
  const rows = CC_TIP_DISTANCE[ccTarget(corner)];
  return Math.max(0, rows[Math.floor(inner / DIRECTIONS)] - rows[land]);
});

const IN_TARGET: readonly Uint8Array[] = CC_TRIANGLES.map((_, corner) => {
  const marks = new Uint8Array(CC_HOLES);
  for (const index of CC_TRIANGLES[ccTarget(corner)]) marks[index] = 1;
  return marks;
});

/** Cost of a marble of each corner standing in each hole (`corner * holes + hole`): lower is closer to home. */
export function costTable(weights: ArrayLike<number>): Float64Array {
  const table = new Float64Array(CORNERS * CC_HOLES);
  for (let corner = 0; corner < CORNERS; corner++) {
    const target = ccTarget(corner);
    const turn = sideRotation(CC_BOARD, target);
    CC_BOARD.nodes.forEach((node, index) => {
      const rows = CC_TIP_DISTANCE[target][index];
      const drift = Math.abs(rotatePoint(CC_BOARD, node, turn).x - CC_BOARD.width / 2);
      table[corner * CC_HOLES + index] = rows + weights[CC_W.STRAGGLER] * rows * rows
        + (IN_TARGET[corner][index] ? 0 : weights[CC_W.DRIFT] * drift);
    });
  }
  return table;
}

/** Plain rows to the target tip: what the standings count when the turn limit decides the match. */
const ROW_COST: Float64Array = Float64Array.from({ length: CORNERS * CC_HOLES }, (_, slot) =>
  CC_TIP_DISTANCE[ccTarget(Math.floor(slot / CC_HOLES))][slot % CC_HOLES]);

const tableCache = new WeakMap<ArrayLike<number>, Float64Array>();
function cachedCosts(weights: ArrayLike<number>): Float64Array {
  let table = tableCache.get(weights);
  if (!table) {
    table = costTable(weights);
    tableCache.set(weights, table);
  }
  return table;
}

/** A move that finishes the race beats any progress; handing a rival its last hole is as bad. */
const FINISH_SCORE = 10_000;
const WIN = 1_000_000;

export function searchBoard(holes: ChineseCheckersVisibleState['holes']): SearchBoard {
  return Int8Array.from(holes, (hole) => (hole === null ? EMPTY : hole));
}

// Shared visit stamps per hole avoid clearing arrays for every marble: `listed` marks destinations already
// written, `jumped` the landings the jump search has queued (a step target can still continue a chain).
const listed = new Int32Array(CC_HOLES);
const jumped = new Int32Array(CC_HOLES);
let stamp = 0;
const queue = new Int16Array(CC_HOLES);

/** Writes every hole the marble at `from` can reach into `out` from `start`; returns the new end. */
function reach(board: SearchBoard, from: number, out: Int16Array, start: number): number {
  stamp++;
  let end = start;
  for (let direction = 0; direction < DIRECTIONS; direction++) {
    const next = NEXT[from * DIRECTIONS + direction];
    if (next >= 0 && board[next] === EMPTY) {
      listed[next] = stamp;
      out[end++] = next;
    }
  }
  let head = 0;
  let tail = 0;
  queue[tail++] = from;
  jumped[from] = stamp;
  while (head < tail) {
    const at = queue[head++];
    for (let direction = 0; direction < DIRECTIONS; direction++) {
      const over = NEXT[at * DIRECTIONS + direction];
      if (over < 0 || over === from || board[over] === EMPTY) continue;
      const land = NEXT[over * DIRECTIONS + direction];
      if (land < 0 || board[land] !== EMPTY || jumped[land] === stamp) continue;
      jumped[land] = stamp;
      queue[tail++] = land;
      if (listed[land] !== stamp) {
        listed[land] = stamp;
        out[end++] = land;
      }
    }
  }
  return end;
}

const buffer = new Int16Array(CC_HOLES * 10);

/** Every legal move of `corner`, in hole order. */
export function searchMoves(board: SearchBoard, corner: number): SearchMove[] {
  const moves: SearchMove[] = [];
  for (let from = 0; from < CC_HOLES; from++) {
    if (board[from] !== corner) continue;
    const end = reach(board, from, buffer, 0);
    for (let index = 0; index < end; index++) moves.push({ from, to: buffer[index] });
  }
  return moves;
}

/** Same rule as `ccFinished`: the target is full and holds at least one own marble. */
export function searchFinished(board: SearchBoard, corner: number): boolean {
  let own = 0;
  for (const index of CC_TRIANGLES[ccTarget(corner)]) {
    if (board[index] === EMPTY) return false;
    if (board[index] === corner) own++;
  }
  return own > 0;
}

// ── Position ──

const MAX_PLY = 24;
const MAX_MOVES = 320;
const STACK = 256;

interface Search {
  readonly board: SearchBoard;
  /** Hole of each marble, `corner * 10 + slot`; -1 for corners not in play */
  readonly marbles: Int16Array;
  readonly cost: Float64Array;
  readonly cohesion: Int16Array;
  /** Marbles in each triangle, and of those how many belong to the corner heading for it */
  readonly fill: Int8Array;
  readonly home: Int8Array;
  readonly costs: Float64Array;
  readonly weights: Float64Array;
  readonly expired: () => boolean;
  readonly maxNodes: number;
  readonly moves: Int32Array;
  readonly scores: Float64Array;
  readonly scratchMoves: Int32Array;
  readonly scratchScores: Float64Array;
  readonly stackFrom: Int16Array;
  readonly stackMove: Int32Array;
  readonly table: Table;
  readonly age: number;
  salt: number;
  hash1: number;
  hash2: number;
  sp: number;
  nodes: number;
}

const keyRandom = seededRandom(0x43484b52);
const keyWord = (): number => Math.floor(keyRandom() * 4294967296) | 0;
const KEY_1 = Int32Array.from({ length: CORNERS * CC_HOLES }, keyWord);
const KEY_2 = Int32Array.from({ length: CORNERS * CC_HOLES }, keyWord);
const TURN_1 = keyWord();
const TURN_2 = keyWord();

interface Table {
  readonly mask: number;
  readonly key: Int32Array;
  /** depth (8 bits), bound (2), age (8) */
  readonly data: Int32Array;
  readonly score: Float32Array;
}

const tables = new Map<number, Table>();
let ageCounter = 0;

function tableFor(bits: number): Table {
  let table = tables.get(bits);
  if (!table) {
    const size = 1 << bits;
    table = { mask: size - 1, key: new Int32Array(size), data: new Int32Array(size), score: new Float32Array(size) };
    tables.set(bits, table);
  }
  return table;
}

const EXACT = 0;
const LOWER = 1;
const UPPER = 2;

class Stop {}
const STOP = new Stop();

function ownNeighbours(board: SearchBoard, corner: number, hole: number, except: number): number {
  let count = 0;
  for (let direction = 0; direction < DIRECTIONS; direction++) {
    const next = NEXT[hole * DIRECTIONS + direction];
    if (next >= 0 && next !== except && board[next] === corner) count++;
  }
  return count;
}

function createSearch(
  board: SearchBoard, weights: Float64Array, costs: Float64Array, expired: () => boolean, maxNodes: number, tableBits: number,
  random: () => number,
): Search {
  const s: Search = {
    board: Int8Array.from(board), marbles: new Int16Array(CORNERS * CC_PIECES).fill(-1), cost: new Float64Array(CORNERS),
    cohesion: new Int16Array(CORNERS), fill: new Int8Array(CORNERS), home: new Int8Array(CORNERS), costs, weights, expired,
    maxNodes, moves: new Int32Array(MAX_PLY * MAX_MOVES), scores: new Float64Array(MAX_PLY * MAX_MOVES),
    scratchMoves: new Int32Array(MAX_MOVES), scratchScores: new Float64Array(MAX_MOVES), stackFrom: new Int16Array(STACK),
    stackMove: new Int32Array(STACK), table: tableFor(tableBits), age: (ageCounter = (ageCounter % 250) + 1),
    salt: Math.floor(random() * 4294967296) | 0, hash1: 0, hash2: 0, sp: 0, nodes: 0,
  };
  const used = new Int8Array(CORNERS);
  for (let hole = 0; hole < CC_HOLES; hole++) {
    const corner = board[hole];
    if (corner === EMPTY) continue;
    s.marbles[corner * CC_PIECES + used[corner]++] = hole;
    s.cost[corner] += costs[corner * CC_HOLES + hole];
    s.hash1 ^= KEY_1[corner * CC_HOLES + hole];
    s.hash2 ^= KEY_2[corner * CC_HOLES + hole];
    const triangle = TRI_OF[hole];
    if (triangle >= 0) {
      s.fill[triangle]++;
      if (ccTarget(corner) === triangle) s.home[triangle]++;
    }
    s.cohesion[corner] += ownNeighbours(board, corner, hole, -1);
  }
  // Each neighbouring pair was counted from both ends.
  for (let corner = 0; corner < CORNERS; corner++) s.cohesion[corner] >>= 1;
  return s;
}

/** Move of marble `slot` of its corner from `from` to `to`. */
const encode = (slot: number, from: number, to: number): number => (slot << 14) | (from << 7) | to;

/** Moves marble `slot` of `corner`; `unmake` undoes the last move made. */
function make(s: Search, corner: number, move: number): void {
  const slot = move >> 14;
  const from = (move >> 7) & 127;
  const to = move & 127;
  const { board } = s;
  s.stackFrom[s.sp] = from;
  s.stackMove[s.sp++] = (corner << 24) | move;
  const before = ownNeighbours(board, corner, from, -1);
  board[from] = EMPTY;
  board[to] = corner;
  s.marbles[corner * CC_PIECES + slot] = to;
  s.cost[corner] += s.costs[corner * CC_HOLES + to] - s.costs[corner * CC_HOLES + from];
  s.cohesion[corner] += ownNeighbours(board, corner, to, -1) - before;
  s.hash1 ^= KEY_1[corner * CC_HOLES + from] ^ KEY_1[corner * CC_HOLES + to] ^ TURN_1;
  s.hash2 ^= KEY_2[corner * CC_HOLES + from] ^ KEY_2[corner * CC_HOLES + to] ^ TURN_2;
  const out = TRI_OF[from];
  const into = TRI_OF[to];
  const target = ccTarget(corner);
  if (out >= 0) {
    s.fill[out]--;
    if (out === target) s.home[out]--;
  }
  if (into >= 0) {
    s.fill[into]++;
    if (into === target) s.home[into]++;
  }
}

function unmake(s: Search): void {
  const entry = s.stackMove[--s.sp];
  const corner = entry >> 24;
  const slot = (entry >> 14) & 1023;
  const from = s.stackFrom[s.sp];
  const to = entry & 127;
  const { board } = s;
  const after = ownNeighbours(board, corner, to, -1);
  board[to] = EMPTY;
  board[from] = corner;
  s.marbles[corner * CC_PIECES + slot] = from;
  s.cost[corner] += s.costs[corner * CC_HOLES + from] - s.costs[corner * CC_HOLES + to];
  s.cohesion[corner] += ownNeighbours(board, corner, from, -1) - after;
  s.hash1 ^= KEY_1[corner * CC_HOLES + from] ^ KEY_1[corner * CC_HOLES + to] ^ TURN_1;
  s.hash2 ^= KEY_2[corner * CC_HOLES + from] ^ KEY_2[corner * CC_HOLES + to] ^ TURN_2;
  const out = TRI_OF[from];
  const into = TRI_OF[to];
  const target = ccTarget(corner);
  if (out >= 0) {
    s.fill[out]++;
    if (out === target) s.home[out]++;
  }
  if (into >= 0) {
    s.fill[into]--;
    if (into === target) s.home[into]--;
  }
}

/** The corner whose target the last move completed, or -1. */
function completed(s: Search, to: number): number {
  const triangle = TRI_OF[to];
  return triangle >= 0 && s.fill[triangle] === TRIANGLE_SIZE && s.home[triangle] > 0 ? ccTarget(triangle) : -1;
}

const dest = new Int16Array(CC_HOLES);

/** Writes the moves of `corner` and their ordering scores; returns how many. */
function generate(s: Search, corner: number, moves: Int32Array, scores: Float64Array, start: number): number {
  const { board, costs } = s;
  const orderWeight = s.weights[CC_W.ORDER_COHESION];
  let count = start;
  for (let slot = 0; slot < CC_PIECES; slot++) {
    const from = s.marbles[corner * CC_PIECES + slot];
    if (from < 0) continue;
    const end = reach(board, from, dest, 0);
    const base = costs[corner * CC_HOLES + from];
    const before = ownNeighbours(board, corner, from, -1);
    const leaving = TRI_OF[from];
    for (let index = 0; index < end; index++) {
      const to = dest[index];
      let score = base - costs[corner * CC_HOLES + to] + orderWeight * (ownNeighbours(board, corner, to, from) - before);
      const triangle = TRI_OF[to];
      if (triangle >= 0 && triangle !== leaving && s.fill[triangle] === TRIANGLE_SIZE - 1) {
        const owner = ccTarget(triangle);
        if (owner === corner) score += FINISH_SCORE;
        else if (s.home[triangle] > 0) score -= FINISH_SCORE;
      }
      moves[count] = encode(slot, from, to);
      scores[count++] = score;
    }
  }
  return count - start;
}

/** Moves the `k` best-scored entries of the list to its front, best first. */
function selectBest(moves: Int32Array, scores: Float64Array, start: number, count: number, k: number): void {
  for (let picked = 0; picked < k; picked++) {
    let top = start + picked;
    for (let rest = top + 1; rest < start + count; rest++) if (scores[rest] > scores[top]) top = rest;
    if (top !== start + picked) {
      const move = moves[top];
      const score = scores[top];
      moves[top] = moves[start + picked];
      scores[top] = scores[start + picked];
      moves[start + picked] = move;
      scores[start + picked] = score;
    }
  }
}

/** Rows of the best hop each marble of `corner` could make now. */
function hopPotential(s: Search, corner: number): number {
  const { board } = s;
  let total = 0;
  for (let slot = 0; slot < CC_PIECES; slot++) {
    const from = s.marbles[corner * CC_PIECES + slot];
    if (from < 0) continue;
    let best = 0;
    for (let direction = 0; direction < DIRECTIONS; direction++) {
      const inner = from * DIRECTIONS + direction;
      const over = NEXT[inner];
      if (over < 0 || board[over] === EMPTY) continue;
      const land = LAND[inner];
      if (land < 0 || board[land] !== EMPTY) continue;
      const gain = HOP_GAIN[corner * CC_HOLES * DIRECTIONS + inner];
      if (gain > best) best = gain;
    }
    total += best;
  }
  return total;
}

function standing(s: Search, corner: number): number {
  return s.weights[CC_W.HOP] * hopPotential(s, corner) + s.weights[CC_W.COHESION] * s.cohesion[corner] - s.cost[corner];
}

function checkTime(s: Search): void {
  if (++s.nodes % 32 === 0 && (s.expired() || s.nodes >= s.maxNodes)) throw STOP;
}

const jitter = (s: Search): number => (((s.hash1 ^ s.salt) & 15) - 7.5) * s.weights[CC_W.NOISE] / 7.5;

// ── Two players ──

/** Moves tried at each remaining depth: the root, then one, two, and so on plies from the leaves. */
const BRANCH_DUEL: readonly number[] = [0, 6, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8];
const ROOT_BRANCH = 24;
/**
 * Deepest ply with three or more seats. The search leaves the seats other than the rival standing still, so plans
 * further out rest on a board that will not be there; in matches against the previous bot, lines longer than this
 * played clearly worse.
 */
const CROWDED_DEPTH = 8;

function duel(s: Search, depth: number, alpha: number, beta: number, ply: number, me: number, rival: number): number {
  checkTime(s);
  if (depth <= 0) return standing(s, me) - standing(s, rival) + jitter(s);
  const base = ply * MAX_MOVES;
  const count = generate(s, me, s.moves, s.scores, base);
  if (count === 0) return -duel(s, depth - 1, -beta, -alpha, ply + 1, rival, me);

  const index = s.hash1 & s.table.mask;
  if (s.table.key[index] === s.hash2) {
    const data = s.table.data[index];
    if (((data >> 10) & 255) === s.age && (data & 255) >= depth) {
      const score = s.table.score[index];
      const bound = (data >> 8) & 3;
      if (bound === EXACT || (bound === LOWER && score >= beta) || (bound === UPPER && score <= alpha)) return score;
    }
  }

  const tried = Math.min(count, BRANCH_DUEL[Math.min(depth, BRANCH_DUEL.length - 1)]);
  selectBest(s.moves, s.scores, base, count, tried);
  const originalAlpha = alpha;
  let best = -Infinity;
  for (let picked = 0; picked < tried; picked++) {
    const move = s.moves[base + picked];
    make(s, me, move);
    const winner = completed(s, move & 127);
    let score: number;
    if (winner === me) score = WIN - ply;
    else if (winner >= 0) score = -(WIN - ply);
    else if (picked === 0) score = -duel(s, depth - 1, -beta, -alpha, ply + 1, rival, me);
    else {
      score = -duel(s, depth - 1, -alpha - 1, -alpha, ply + 1, rival, me);
      if (score > alpha && score < beta) score = -duel(s, depth - 1, -beta, -alpha, ply + 1, rival, me);
    }
    unmake(s);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  const bound = best >= beta ? LOWER : best > originalAlpha ? EXACT : UPPER;
  const slot = s.hash1 & s.table.mask;
  s.table.key[slot] = s.hash2;
  s.table.data[slot] = Math.min(depth, 255) | (bound << 8) | (s.age << 10);
  s.table.score[slot] = best;
  return best;
}

// ── Root ──

export interface SearchOptions {
  /** The seat's own previous move, to avoid shuttling straight back */
  readonly previous: SearchMove | null;
  /** Corners of the other seats still playing, in turn order after the searcher */
  readonly opponents: readonly number[];
  readonly expired: () => boolean;
  readonly random: () => number;
  /** Deepest ply (own moves in a race of three or more); default 40 */
  readonly maxDepth?: number;
  /** Turns the searcher still has before the match ends on progress; default no limit in sight */
  readonly turnsLeft?: number;
  readonly weights?: Float64Array;
  readonly maxNodes?: number;
  readonly tableBits?: number;
  /** Receives the depth, score and best move of each completed iteration */
  readonly onDepth?: (depth: number, score: number, nodes: number) => void;
}

/** Turns before the limit from which only plain rows count, as the standings do. */
const ENDGAME_TURNS = 4;

const decode = (move: number): SearchMove => ({ from: (move >> 7) & 127, to: move & 127 });

/**
 * The best move for `corner`, or null when every marble is blocked. Iterative deepening from one ply; the best
 * move of the last completed iteration wins, with equal scores broken by a per-position jitter.
 */
export function searchBestMove(board: SearchBoard, corner: number, options: SearchOptions): SearchMove | null {
  const weights = options.weights ?? CHINESE_CHECKERS_WEIGHTS;
  const plain = options.turnsLeft !== undefined && options.turnsLeft <= ENDGAME_TURNS;
  const s = createSearch(
    board, weights, plain ? ROW_COST : cachedCosts(weights), options.expired, options.maxNodes ?? Infinity,
    options.tableBits ?? 18, options.random,
  );
  const count = generate(s, corner, s.moves, s.scores, 0);
  if (count === 0) return null;
  if (count === 1) return decode(s.moves[0]);
  const opponents = options.opponents;
  const penalty = weights[CC_W.BACKTRACK];
  const previous = options.previous;
  const backtracks = (move: number): boolean => previous !== null && ((move >> 7) & 127) === previous.to && (move & 127) === previous.from;
  for (let index = 0; index < count; index++) if (backtracks(s.moves[index])) s.scores[index] -= penalty;
  // A finishing move beats any search.
  selectBest(s.moves, s.scores, 0, count, 1);
  if (s.scores[0] >= FINISH_SCORE / 2) return decode(s.moves[0]);
  // Every move is ranked by its own progress plus the best move it makes possible next, so a quiet move that
  // sets up a long jump chain is not cut before the deeper search sees it.
  const follow = weights[CC_W.FOLLOW];
  if (follow > 0) {
    for (let index = 0; index < count; index++) {
      // Under a spent clock the moves not yet looked at keep their plain progress.
      if (index % 8 === 7 && options.expired()) break;
      make(s, corner, s.moves[index]);
      const next = generate(s, corner, s.scratchMoves, s.scratchScores, 0);
      let ahead = 0;
      for (let at = 0; at < next; at++) if (s.scratchScores[at] > ahead) ahead = s.scratchScores[at];
      unmake(s);
      s.scores[index] += follow * Math.min(ahead, FINISH_SCORE / 2);
    }
  }
  const rootCount = Math.min(count, ROOT_BRANCH);
  selectBest(s.moves, s.scores, 0, count, rootCount);
  let order = Array.from(s.moves.subarray(0, rootCount));
  if (opponents.length === 0) return decode(order[0]);
  // With three seats the search duels the one that is furthest ahead; with more it duels the one that moves right
  // after, whose answer matters most. The other seats stand still.
  const rival = opponents.length === 2
    ? (s.cost[opponents[1]] < s.cost[opponents[0]] ? opponents[1] : opponents[0])
    : opponents[0];
  let best = order[0];
  const ceiling = Math.min(options.maxDepth ?? MAX_PLY, MAX_PLY - 2, opponents.length > 1 ? CROWDED_DEPTH : MAX_PLY);
  const best1: { move: number } = { move: best };
  try {
    for (let depth = 1; depth <= ceiling; depth++) {
      let alpha = -Infinity;
      const scores: number[] = [];
      let top = -Infinity;
      for (let index = 0; index < order.length; index++) {
        const move = order[index];
        make(s, corner, move);
        const winner = completed(s, move & 127);
        let score: number;
        if (winner === corner) score = WIN;
        else if (winner >= 0) score = -WIN;
        else if (index === 0) score = -duel(s, depth - 1, -Infinity, Infinity, 1, rival, corner);
        else {
          // The first move gets the whole window; the others only have to beat it.
          score = -duel(s, depth - 1, -alpha - 1e-9, -alpha, 1, rival, corner);
          if (score > alpha) score = -duel(s, depth - 1, -Infinity, -alpha, 1, rival, corner);
        }
        unmake(s);
        if (backtracks(move)) score -= penalty;
        scores.push(score);
        if (score > top) {
          top = score;
          best1.move = move;
        }
        if (score > alpha) alpha = score;
      }
      best = best1.move;
      order = order.map((move, index) => ({ move, score: scores[index] })).sort((a, b) => b.score - a.score).map((entry) => entry.move);
      options.onDepth?.(depth, top, s.nodes);
      if (top >= WIN - MAX_PLY || (s.nodes >= s.maxNodes) || options.expired()) break;
    }
  } catch (error) {
    if (error !== STOP) throw error;
  }
  return decode(best);
}

// ── Strategy entry points ──

/** The searching seat's corner, opponents, and previous move from its view, or null off turn. */
export function searchSetup(visible: ChineseCheckersVisibleState): {
  readonly corner: number; readonly opponents: number[]; readonly previous: SearchMove | null; readonly turnsLeft: number;
} | null {
  const index = visible.seats.indexOf(visible.mySeat);
  if (index < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat
    || visible.resigned.includes(visible.mySeat)) return null;
  const opponents: number[] = [];
  for (let step = 1; step < visible.seats.length; step++) {
    const seat = visible.seats[(index + step) % visible.seats.length];
    if (!visible.resigned.includes(seat)) opponents.push(visible.corners[(index + step) % visible.seats.length]);
  }
  const last = [...visible.log].reverse().find((entry) => entry.seat === visible.mySeat && entry.to !== undefined);
  const from = ccIndex(last?.from);
  const to = ccIndex(last?.to);
  const taken = visible.log.filter((entry) => entry.seat === visible.mySeat && !entry.resigned).length;
  return {
    corner: visible.corners[index], opponents, previous: from !== null && to !== null ? { from, to } : null,
    turnsLeft: CC_TURN_LIMIT - taken,
  };
}

export function moveAction(move: SearchMove): BotAction {
  return {
    type: 'game-action',
    request: { gameType: 'chinesecheckers', action: { type: 'move', from: ccNode(move.from), to: ccNode(move.to) } },
  };
}

/** Search strategy for the bot worker pool. */
export function chineseCheckersSearch(visible: ChineseCheckersVisibleState, context: SearchContext): BotAction | null {
  const setup = searchSetup(visible);
  if (!setup) return null;
  const move = searchBestMove(searchBoard(visible.holes), setup.corner, {
    ...setup, expired: context.budget.expired, random: context.random, maxDepth: context.budget.maxDepth,
  });
  return move ? moveAction(move) : null;
}
