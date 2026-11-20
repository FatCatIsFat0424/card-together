// ─── Gomoku search: threat-space search, then iterative-deepening alpha-beta over line shapes ───
//
// Runs inside a bot worker (`GameBot.search`) and, with a small node budget, as the cheap synchronous
// fallback when no pool runs or a search fails. It reads only the seat's own view, which for Gomoku is the
// whole public board. Line shapes, threat sets, and the hash live in `gomoku-position`; forced wins by fours
// and open threes in `gomoku-threats`.

import type { GomokuVisibleState } from '@shared/types';
import { GM_SIZE, gmIndex, gmNode, gmSideOfStone, gmStage, gmStoneCount } from '@shared/rules/gomoku';
import type { GmSide } from '@shared/rules/gomoku';
import type { SearchContext as BotSearchContext } from './search/search-types';
import type { BotAction } from './bot-decisions';
import { OPEN_THREE } from './gomoku-patterns';
import { AREA, INDEX_OF, Position, SIDE_HASH } from './gomoku-position';
import { SearchContext, WIN, moveValue, vcf, vct, winThreat } from './gomoku-threats';

export { Position } from './gomoku-position';

const CENTRE = gmIndex((GM_SIZE - 1) / 2, (GM_SIZE - 1) / 2);

/** Deepest ply (forced replies included) the per-ply buffers hold. */
const MAX_PLY = 96;
const STRIDE = 232;

const opponentOf = (side: GmSide): GmSide => (side === 0 ? 1 : 0);

// ─── Transposition table ───

const TT_BITS = 19;
const TT_MASK = (1 << TT_BITS) - 1;
const EXACT = 1;
const LOWER = 2;
const UPPER = 3;
const NO_MOVE = 1023;

/** Shared by every search in the worker: positions hash the same, so one move's search helps the next. */
let ttKey: Int32Array | null = null;
let ttScore: Int32Array | null = null;
let ttInfo: Int32Array | null = null;
let ttGeneration = 0;
let ttRenju = false;

function prepareTable(renju: boolean): void {
  if (ttKey === null || ttScore === null || ttInfo === null) {
    ttKey = new Int32Array(1 << TT_BITS);
    ttScore = new Int32Array(1 << TT_BITS);
    ttInfo = new Int32Array(1 << TT_BITS);
  } else if (renju !== ttRenju) {
    ttInfo.fill(0);
  }
  ttRenju = renju;
  ttGeneration = (ttGeneration + 1) & 255;
}

const toTable = (score: number, ply: number): number => (score > WIN - 1000 ? score + ply : score < -WIN + 1000 ? score - ply : score);
const fromTable = (score: number, ply: number): number => (score > WIN - 1000 ? score - ply : score < -WIN + 1000 ? score + ply : score);

// ─── Search state ───

class Search extends SearchContext {
  readonly moves = new Int16Array(MAX_PLY * STRIDE);
  readonly killers = new Int16Array(MAX_PLY * 2).fill(-1);
  readonly history = new Int32Array(2 * AREA);
  readonly order = new Float64Array(AREA);
  readonly seen = new Int32Array(AREA);
  stamp = 0;
}

/** Plies of open-three attack a threat search may spend. */
const THREAT_THREES = 4;
/** Fours a leaf's continuous-four search may play, and the nodes it may use. */
const LEAF_FOURS = 6;
const LEAF_NODES = 400;

/**
 * Fills the ply's move list best first and returns how many moves it holds. When the opponent threatens to win
 * by force, only cells that make a four for either side are tried, which includes every defence. Otherwise
 * every cell that makes or stops a three or four is kept, plus the `quietLimit` best of the rest.
 */
function generate(search: Search, side: GmSide, ply: number, ttMove: number, quietLimit: number): number {
  const position = search.position;
  const other = opponentOf(side);
  const base = ply * STRIDE;
  const order = search.order;
  let count = 0;
  const restricted = winThreat(position, other);
  const killerA = search.killers[ply * 2];
  const killerB = search.killers[ply * 2 + 1];
  const add = (cell: number): void => {
    let value = moveValue(position, cell, side);
    if (cell === ttMove) value += 1e7;
    else if (cell === killerA) value += 2500;
    else if (cell === killerB) value += 2000;
    else value += Math.min(search.history[side * AREA + cell] / 8, 1500);
    order[count++] = Math.floor((value + 4) * 4) * 1024 + cell;
  };
  if (restricted) {
    search.stamp++;
    for (const set of [position.fours[other], position.fours[side]]) {
      for (let i = 0; i < set.size; i++) {
        const cell = set.list[i];
        if (search.seen[cell] === search.stamp) continue;
        search.seen[cell] = search.stamp;
        add(cell);
      }
    }
  } else {
    const set = position.candidates;
    for (let i = 0; i < set.size; i++) add(set.list[i]);
  }
  order.subarray(0, count).sort();
  let kept = 0;
  let quiet = 0;
  for (let i = count - 1; i >= 0; i--) {
    const cell = order[i] % 1024;
    const tactical = restricted || position.best[side * AREA + cell] >= OPEN_THREE || position.best[other * AREA + cell] >= OPEN_THREE;
    if (!tactical && cell !== ttMove && quiet >= quietLimit) continue;
    if (!position.legal(cell, side)) continue;
    if (!tactical) quiet++;
    search.moves[base + kept++] = cell;
  }
  return kept;
}

/** Quiet moves tried at a node by remaining depth. */
const QUIET_BY_DEPTH = [4, 5, 7, 8, 9, 10, 10, 12];

function negamax(search: Search, side: GmSide, depth: number, alpha: number, beta: number, ply: number): number {
  if (search.tick()) return 0;
  const position = search.position;
  const other = opponentOf(side);
  if (position.winCells(side) > 0) return WIN - ply;
  const threats = position.winCells(other);
  if (threats >= 2) return -(WIN - ply - 1);
  let forced = -1;
  if (threats === 1) {
    forced = position.wins[0];
    if (!position.legal(forced, side)) return -(WIN - ply - 1);
  }
  if (ply >= MAX_PLY - 2) return position.evaluate(side);
  if (forced < 0 && depth <= 0) {
    if (position.fours[side].size > 0) {
      search.limit = search.nodes + LEAF_NODES;
      const win = vcf(search, side, LEAF_FOURS);
      search.limit = Infinity;
      if (search.stopped) return 0;
      if (win >= 0) return WIN - ply - 9;
    }
    return position.evaluate(side);
  }

  const base = ply * STRIDE;
  let ttMove = NO_MOVE;
  let slot = 0;
  let check = 0;
  let count: number;
  const originalAlpha = alpha;
  if (forced >= 0) {
    search.moves[base] = forced;
    count = 1;
  } else {
    slot = (position.hashA ^ (side * 0x1b873593)) & TT_MASK;
    check = side === 0 ? position.hashB : position.hashB ^ SIDE_HASH;
    const info = ttInfo![slot];
    if (info !== 0 && ttKey![slot] === check) {
      ttMove = info & 1023;
      if (((info >> 10) & 63) >= depth) {
        const score = fromTable(ttScore![slot], ply);
        const flag = (info >> 16) & 3;
        if (flag === EXACT) return score;
        if (flag === LOWER && score >= beta) return score;
        if (flag === UPPER && score <= alpha) return score;
      }
    }
    count = generate(search, side, ply, ttMove === NO_MOVE ? -1 : ttMove, QUIET_BY_DEPTH[Math.min(depth, QUIET_BY_DEPTH.length - 1)]);
    if (count === 0) return 0;
  }

  let best = -Infinity;
  let bestMove = NO_MOVE;
  for (let i = 0; i < count; i++) {
    const cell = search.moves[base + i];
    const quiet = forced < 0 && position.best[side * AREA + cell] < OPEN_THREE && position.best[other * AREA + cell] < OPEN_THREE;
    const childDepth = forced >= 0 ? depth : depth - 1;
    position.makeCell(cell, side);
    let value: number;
    if (i === 0) {
      value = -negamax(search, other, childDepth, -beta, -alpha, ply + 1);
    } else {
      const reduction = quiet && i >= 4 && depth >= 3 ? 1 : 0;
      value = -negamax(search, other, childDepth - reduction, -alpha - 1, -alpha, ply + 1);
      if (value > alpha && (reduction > 0 || value < beta)) value = -negamax(search, other, childDepth, -beta, -alpha, ply + 1);
    }
    position.unmakeCell(cell, side);
    if (search.stopped) return 0;
    if (value > best) {
      best = value;
      bestMove = cell;
      if (value > alpha) alpha = value;
      if (alpha >= beta) {
        if (quiet) {
          if (search.killers[ply * 2] !== cell) {
            search.killers[ply * 2 + 1] = search.killers[ply * 2];
            search.killers[ply * 2] = cell;
          }
          search.history[side * AREA + cell] += depth * depth;
        }
        break;
      }
    }
  }
  if (forced < 0) {
    const flag = best <= originalAlpha ? UPPER : best >= beta ? LOWER : EXACT;
    const old = ttInfo![slot];
    if (old === 0 || ((old >> 18) & 255) !== ttGeneration || ((old >> 10) & 63) <= depth) {
      ttKey![slot] = check;
      ttScore![slot] = toTable(best, ply);
      ttInfo![slot] = bestMove | (Math.min(Math.max(depth, 0), 63) << 10) | (flag << 16) | (ttGeneration << 18);
    }
  }
  return best;
}

// ─── Root ───

export interface GomokuSearchOptions {
  /** Deepest ply to search */
  readonly maxDepth: number;
  readonly expired: () => boolean;
  /** Node budget for the cheap synchronous search; unlimited in the worker */
  readonly maxNodes?: number;
  /** Milliseconds left of the wall-clock budget, which sizes the threat searches; unknown for the synchronous move */
  readonly timeLeftMs?: () => number;
  readonly random: () => number;
}

export interface GomokuChoice {
  readonly index: number;
  /** Search value for the side to move: positive favours it, a win is above `WIN / 2` */
  readonly score: number;
}

/** Moves tried at the root besides the tactical ones. */
const ROOT_QUIET = 14;
/** Opening moves within this value of the best are all played at random, for variety. */
const OPENING_MARGIN = 18;
/** Stones on the board up to which the opening choice varies. */
const OPENING_STONES = 5;

const choice = (cell: number, score: number): GomokuChoice => ({ index: INDEX_OF[cell], score });

/** Nodes the threat searches before the main search may use, from the time left. */
function threatNodes(options: GomokuSearchOptions): number {
  if (options.maxNodes !== undefined) return Math.max(200, Math.floor(options.maxNodes / 3));
  const left = options.timeLeftMs?.() ?? 1000;
  return Math.min(60_000, Math.max(1500, Math.floor(left * 20)));
}

/** A random empty point next to the lone stone: the reply a first move gets. */
function adjacentReply(position: Position, random: () => number): number | null {
  const stone = position.stones.findIndex((cell) => cell !== null);
  if (stone < 0) return null;
  const options: number[] = [];
  const col = stone % GM_SIZE;
  const row = Math.floor(stone / GM_SIZE);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = col + dc;
      const r = row + dr;
      if ((dr !== 0 || dc !== 0) && c >= 0 && c < GM_SIZE && r >= 0 && r < GM_SIZE) options.push(gmIndex(c, r));
    }
  }
  return options[Math.floor(random() * options.length)] ?? null;
}

/**
 * Plays the cheapest forced results first (own five, the one block, a forced win by threats), then iterative
 * deepening alpha-beta: the best move of the last completed depth wins. In the first few moves, near-equal
 * moves are chosen between at random so games differ.
 */
export function searchBestMove(
  position: Position, side: GmSide, renju: boolean, options: GomokuSearchOptions,
): GomokuChoice | null {
  position.renju = renju;
  if (position.stoneCount === 0) return { index: CENTRE, score: 0 };
  const other = opponentOf(side);
  if (position.winCells(side) > 0) return choice(position.wins[0], WIN);
  const threats = position.winCells(other);
  if (threats > 0) {
    // One threat has one defence; two (or a forbidden defence) lose whatever is played.
    const open: number[] = [];
    for (let i = 0; i < threats; i++) if (position.legal(position.wins[i], side)) open.push(position.wins[i]);
    const block = open[0] ?? position.candidates.list[0];
    if (block === undefined) return null;
    return choice(block, threats === 1 && open.length === 1 ? 0 : -WIN);
  }
  if (position.stoneCount === 1 && position.stones[CENTRE] !== null) {
    const reply = adjacentReply(position, options.random);
    if (reply !== null) return { index: reply, score: 0 };
  }

  prepareTable(renju);
  const search = new Search(position, options.expired, options.maxNodes ?? Infinity);
  const allowance = threatNodes(options);
  let rootClock: (() => boolean) | null = null;
  if (options.timeLeftMs !== undefined) {
    // The threat searches may use a third of the time, however many nodes that is.
    const cutoff = options.timeLeftMs() * 0.67;
    const left = options.timeLeftMs;
    rootClock = () => left() < cutoff;
  }
  search.threatClock = rootClock;

  // A forced win by fours, then by fours and open threes.
  search.limit = search.nodes + Math.floor(allowance / 3);
  let win = vcf(search, side, 16);
  if (win < 0 && !search.stopped) {
    search.limit = search.nodes + allowance;
    win = vct(search, side, THREAT_THREES);
  }
  search.limit = Infinity;
  if (win >= 0) return choice(win, WIN - 20);
  if (search.stopped) {
    search.threatClock = null;
    return fallbackChoice(search, side);
  }

  const count = generate(search, side, 0, -1, ROOT_QUIET);
  if (count === 0) return null;
  let moves = Array.from(search.moves.subarray(0, count));
  if (count === 1) return choice(moves[0], 0);
  // A move that leaves the opponent a forced win by threats loses however the shallow search sees it.
  const share = Math.max(200, Math.floor(allowance / (2 * moves.length)));
  const safe = moves.filter((cell) => !opponentForcesWin(search, side, cell, share));
  if (safe.length > 0) moves = safe;
  search.threatClock = null;
  return iterate(search, side, moves, options);
}

/** Whether, after `side` plays `cell`, the opponent wins by fours and open threes within `nodes` nodes. */
function opponentForcesWin(search: Search, side: GmSide, cell: number, nodes: number): boolean {
  const position = search.position;
  const other = opponentOf(side);
  position.makeCell(cell, side);
  search.limit = search.nodes + nodes;
  let wins = vcf(search, other, 10) >= 0;
  if (!wins && !search.stopped) {
    search.limit = search.nodes + nodes;
    wins = vct(search, other, THREAT_THREES) >= 0;
  }
  search.limit = Infinity;
  position.unmakeCell(cell, side);
  return wins && !search.stopped;
}

/** The most promising move by its shape alone, when no time is left to search. */
function fallbackChoice(search: Search, side: GmSide): GomokuChoice | null {
  search.stopped = false;
  search.nodes = 0;
  const count = generate(search, side, 0, -1, 1);
  return count === 0 ? null : choice(search.moves[0], 0);
}

function iterate(search: Search, side: GmSide, ordered: number[], options: GomokuSearchOptions): GomokuChoice {
  const position = search.position;
  const other = opponentOf(side);
  const varied = position.stoneCount <= OPENING_STONES;
  let moves = ordered;
  let best = choice(moves[0], 0);
  const maxDepth = varied ? Math.min(options.maxDepth, 6) : options.maxDepth;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const scores = new Map<number, number>();
    let alpha = -Infinity;
    let improved: GomokuChoice | null = null;
    for (let i = 0; i < moves.length; i++) {
      const cell = moves[i];
      position.makeCell(cell, side);
      let value: number;
      if (i === 0 || varied) {
        value = -negamax(search, other, depth - 1, -Infinity, varied ? Infinity : -alpha, 1);
      } else {
        value = -negamax(search, other, depth - 1, -alpha - 1, -alpha, 1);
        if (value > alpha && !search.stopped) value = -negamax(search, other, depth - 1, -Infinity, -alpha, 1);
      }
      position.unmakeCell(cell, side);
      if (search.stopped) break;
      scores.set(cell, value);
      if (value > alpha) {
        alpha = value;
        improved = choice(cell, value);
      }
    }
    if (improved === null && !search.stopped) improved = best;
    if (improved !== null) best = improved;
    if (search.stopped) break;
    moves = [...moves].sort((a, b) => (scores.get(b) ?? -Infinity) - (scores.get(a) ?? -Infinity));
    if (varied && depth === maxDepth) {
      const top = scores.get(moves[0]) ?? 0;
      const near = moves.filter((cell) => (scores.get(cell) ?? -Infinity) >= top - OPENING_MARGIN);
      const pick = near[Math.floor(options.random() * near.length)];
      best = choice(pick, scores.get(pick) ?? 0);
    }
    // A decided position needs no more depth.
    if (Math.abs(best.score) > WIN / 2 || options.expired()) break;
  }
  return best;
}

// ─── Opening stones and colour choice ───

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

/** Milliseconds before the deadline at which a worker search stops. */
const SAFETY_MS = 100;

/** Values this close to even are a coin flip when choosing a colour or balancing an opening. */
const EVEN = 12;

/**
 * Colour choice in the swap opening: the second seat takes black when white, to move on this position, stands
 * worse. `random` breaks an even position.
 */
export function chooseBySearch(visible: GomokuVisibleState, options: GomokuSearchOptions): BotAction {
  const position = new Position(visible.stones, visible.options.renju);
  const result = searchBestMove(position, 1, visible.options.renju, options);
  const score = result?.score ?? 0;
  return chooseAction(Math.abs(score) <= EVEN ? options.random() < 0.5 : score < 0);
}

/**
 * The third opening stone of the swap rule, laid by the first seat: the black stone that leaves white to move
 * in the most even position, since the second seat will take whichever side stands better.
 */
function balancedOpeningStone(visible: GomokuVisibleState, options: GomokuSearchOptions): number {
  const renju = visible.options.renju;
  const position = new Position(visible.stones, renju);
  const candidates: number[] = [];
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const index = gmIndex(7 + dc, 7 + dr);
      if (visible.stones[index] === null) candidates.push(index);
    }
  }
  const started = performance.now();
  const total = options.maxNodes !== undefined ? 0 : (options.timeLeftMs?.() ?? 600) * 0.8;
  const scored: { index: number; value: number }[] = [];
  candidates.forEach((index, slot) => {
    position.make(index, 0);
    const deadline = started + (total * (slot + 1)) / candidates.length;
    const result = searchBestMove(position, 1, renju, {
      maxDepth: 5,
      expired: () => options.expired() || (total > 0 && performance.now() >= deadline),
      maxNodes: options.maxNodes === undefined ? undefined : Math.floor(options.maxNodes / candidates.length),
      random: options.random,
    });
    position.unmake(index, 0);
    scored.push({ index, value: Math.abs(result?.score ?? 0) });
  });
  scored.sort((a, b) => a.value - b.value);
  const even = scored.filter((entry) => entry.value <= scored[0].value + EVEN);
  return even[Math.floor(options.random() * even.length)].index;
}

/** The opening stone for the first seat under the swap rule, or null when the position needs the normal search. */
export function swapOpeningStone(visible: GomokuVisibleState, options: GomokuSearchOptions): number | null {
  if (!visible.options.swap || gmStage(visible.options, visible.log) !== 'placing') return null;
  const placed = gmStoneCount(visible.stones);
  if (placed === 0) return CENTRE;
  if (placed === 1) return adjacentReply(new Position(visible.stones), options.random);
  return placed === 2 ? balancedOpeningStone(visible, options) : null;
}

/** Search strategy for the bot worker pool. */
export function gomokuSearch(visible: GomokuVisibleState, context: BotSearchContext): BotAction | null {
  // Stops a little early: the first search of a worker also pays for loading this module.
  const margin = Math.min(SAFETY_MS, context.budget.timeLeftMs() * 0.06);
  const options: GomokuSearchOptions = {
    maxDepth: context.budget.maxDepth ?? 10, expired: () => context.budget.timeLeftMs() <= margin,
    timeLeftMs: () => Math.max(0, context.budget.timeLeftMs() - margin), random: context.random,
  };
  if (choosingTurn(visible)) return chooseBySearch(visible, options);
  if (!placingTurn(visible)) return null;
  const opening = swapOpeningStone(visible, options);
  if (opening !== null) return placeAction(opening);
  const result = searchBestMove(new Position(visible.stones, visible.options.renju), sideToPlace(visible), visible.options.renju, options);
  return result === null ? null : placeAction(result.index);
}
