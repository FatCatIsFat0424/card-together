// ─── Land Battle Chess search: perfect-information Monte Carlo over jointly sampled hidden identities ───
//
// Runs inside a bot worker (`GameBot.search`) and reads only the seat's own view. Each sampled world gives
// the opponent's pieces identities drawn from `landbattle-inference.ts`; every root move is then searched
// with alpha-beta and a battle quiescence search in that world, and the move with the best average wins.
// Inside the tree neither side is clairvoyant about battles: a side only starts a battle its own belief
// rates as acceptable (ours: the sampled marginals; the opponent's: what is public about our pieces given
// that world's identities), so the search does not assume the opponent can see through our pieces.

import type { LandBattleVisibleState } from '@shared/types';
import { LB_NODES, LB_QUIET_LIMIT, LB_RANKS, lbCell, lbNode, lbSlotOf } from '@shared/rules/landbattle';
import type { LbMove, LbRank, LbSide } from '@shared/rules/landbattle';
import type { BotAction } from './bot-decisions';
import type { SearchContext } from './search/search-types';
import { botLayout } from './landbattle-deploy';
import { createInference, deploymentPrior, estimateMarginals, sampleAssignment, slotMask } from './landbattle-inference';
import type { Inference } from './landbattle-inference';
import { landBattleKnowledge } from './landbattle-knowledge';
import type { LbKnowledge } from './landbattle-knowledge';
import {
  CAPTAIN, ENGINEER, FLAG, HQ, LIEUTENANT, LOSE_BATTLE, MADE_FLAG, MAJOR, MINE, OUTCOME, RANK_COUNT, TIE_BATTLE, WIN_BATTLE,
  clearWorld, createWorld, defaultWeights, evaluate, generateMoves, hasMove, makeMove, moveFrom, moveTo, placePiece, stepsOf,
  unmakeMove,
} from './landbattle-world';
import type { EvalWeights, World } from './landbattle-world';

/** Score of a captured flag or of an opponent left without a move. */
export const WIN = 10_000;
/** What a side believes a captured flag is worth when weighing a battle. */
const PERCEIVED_FLAG = 1_000;

export interface SearchParams {
  /** Plies searched from the root, the root move included */
  readonly depth: number;
  /** Battles searched beyond the depth */
  readonly quiescence: number;
  /** Worlds sampled at most */
  readonly maxWorlds: number;
  /** A side starts a battle (below the root) only when it expects to lose at most this much material */
  readonly tolerance: number;
  /** Bonus per nat of uncertainty about the target for battles started by low officers */
  readonly probe: number;
  /** Penalty for moving a piece straight back to where it just came from */
  readonly shuffle: number;
  readonly weights: EvalWeights;
}

export function defaultParams(): SearchParams {
  return { depth: 3, quiescence: 3, maxWorlds: 400, tolerance: 12, probe: 6, shuffle: 6, weights: defaultWeights() };
}

/** Parameters of the synchronous fallback, which runs on the event loop. */
export function quickParams(): SearchParams {
  return { ...defaultParams(), depth: 2, quiescence: 2, maxWorlds: 8 };
}

const MAX_PLY = 24;
const MOVES_PER_PLY = 512;
const NEG_INFINITY = -1e9;

/** Material won or lost by an attacker of rank `a` against a defender of rank `d`, as the attacker sees it. */
function battleGain(values: Float64Array, a: number, d: number): number {
  if (d === FLAG) return PERCEIVED_FLAG;
  const outcome = OUTCOME[a * RANK_COUNT + d];
  return outcome === WIN_BATTLE ? values[d] : outcome === LOSE_BATTLE ? -values[a] : values[d] - values[a];
}

/** Everything one decision's search shares between worlds. */
interface SearchState {
  readonly world: World;
  readonly me: LbSide;
  readonly them: LbSide;
  readonly params: SearchParams;
  readonly moves: Int16Array;
  readonly scores: Float64Array;
  /** Our expected battle gain by `token index * RANK_COUNT + attacker rank`, from the marginals */
  readonly ourGain: Float64Array;
  /** The opponent's expected battle gain against our pieces, by `own origin * RANK_COUNT + attacker rank` */
  readonly theirGain: Float64Array;
  /** Index into the inference tokens by opponent origin station, -1 for own pieces */
  readonly tokenIndex: Int8Array;
  /** Last quiet move that caused a cutoff, by ply */
  readonly killers: Int32Array;
  /** Cutoff counts of quiet moves by packed move, shared across worlds */
  readonly history: Float64Array;
  /** The clock; checked every `CLOCK_INTERVAL` nodes once the first world is done */
  readonly expired: () => boolean;
  /** Plies searched from the root in the current world */
  depth: number;
  /** Whether the clock may stop the current world */
  interruptible: boolean;
  /** Set when the clock stopped the current world, whose values are then discarded */
  stopped: boolean;
  nodes: number;
}

const CLOCK_INTERVAL = 512;

/** Counts a node; true when the search must unwind because the clock ran out. */
function tick(state: SearchState): boolean {
  state.nodes++;
  if (state.stopped) return true;
  if (state.interruptible && (state.nodes & (CLOCK_INTERVAL - 1)) === 0 && state.expired()) state.stopped = true;
  return state.stopped;
}

/** Whether the side to move would start this battle, judged by its own belief. */
function willAttack(state: SearchState, mover: number, from: number, to: number): boolean {
  const { world } = state;
  const attacker = world.rank[from];
  const origin = world.origin[to];
  const gain = mover === state.me
    ? state.ourGain[state.tokenIndex[origin] * RANK_COUNT + attacker]
    : state.theirGain[origin * RANK_COUNT + attacker];
  return gain >= -state.params.tolerance;
}

/**
 * Orders the moves in `[start, end)`: winning battles by gain, then the ply's killer moves, then quiet moves
 * by their cutoff history, then losing battles.
 */
function orderMoves(state: SearchState, start: number, end: number, ply: number): void {
  const { world, moves, scores, history } = state;
  const values = state.params.weights.value;
  const killer = state.killers[ply];
  for (let index = start; index < end; index++) {
    const move = moves[index];
    const from = moveFrom(move);
    const to = moveTo(move);
    if (world.rank[to] >= 0) {
      const gain = battleGain(values, world.rank[from], world.rank[to]);
      scores[index] = gain >= 0 ? 100_000 + gain : -100_000 + gain;
    } else scores[index] = move === killer ? 50_000 : history[move];
  }
  // Insertion sort: move lists are short.
  for (let index = start + 1; index < end; index++) {
    const move = moves[index];
    const score = scores[index];
    let at = index - 1;
    while (at >= start && scores[at] < score) {
      moves[at + 1] = moves[at];
      scores[at + 1] = scores[at];
      at--;
    }
    moves[at + 1] = move;
    scores[at + 1] = score;
  }
}

function quiesce(state: SearchState, mover: LbSide, alpha: number, beta: number, ply: number, left: number): number {
  if (tick(state)) return 0;
  const { world } = state;
  const stand = evaluateFor(state, mover);
  if (left <= 0 || stand >= beta || ply >= MAX_PLY - 1) return stand;
  let best = stand;
  if (stand > alpha) alpha = stand;
  const start = ply * MOVES_PER_PLY;
  const end = generateMoves(world, mover, state.moves, start, true);
  orderMoves(state, start, end, ply);
  const next: LbSide = mover === 0 ? 1 : 0;
  for (let index = start; index < end; index++) {
    const move = state.moves[index];
    if (!willAttack(state, mover, moveFrom(move), moveTo(move))) continue;
    const made = makeMove(world, move);
    const score = (made & MADE_FLAG) !== 0 ? WIN - ply : -quiesce(state, next, -beta, -alpha, ply + 1, left - 1);
    unmakeMove(world);
    if (score > best) {
      best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
  }
  return best;
}

function negamax(state: SearchState, mover: LbSide, depth: number, alpha: number, beta: number, ply: number): number {
  if (depth <= 0) return quiesce(state, mover, alpha, beta, ply, state.params.quiescence);
  if (tick(state)) return 0;
  const { world } = state;
  const start = ply * MOVES_PER_PLY;
  const end = generateMoves(world, mover, state.moves, start);
  if (end === start) return -WIN + ply;
  orderMoves(state, start, end, ply);
  const next: LbSide = mover === 0 ? 1 : 0;
  let best = NEG_INFINITY;
  for (let index = start; index < end; index++) {
    const move = state.moves[index];
    const to = moveTo(move);
    if (world.rank[to] >= 0 && !willAttack(state, mover, moveFrom(move), to)) continue;
    const made = makeMove(world, move);
    let score: number;
    if ((made & MADE_FLAG) !== 0) score = WIN - ply;
    else if (world.quiet >= LB_QUIET_LIMIT) score = 0;
    else score = -negamax(state, next, depth - 1, -beta, -alpha, ply + 1);
    unmakeMove(world);
    if (score > best) {
      best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (world.rank[to] < 0) {
          state.killers[ply] = move;
          state.history[move] += depth * depth;
        }
        break;
      }
    }
  }
  // Every move was a battle the side would not start: it stands still in effect.
  return best === NEG_INFINITY ? evaluateFor(state, mover) : best;
}

/**
 * The evaluation for the side to move, plus the immediate flag threats the quiescence search may not reach:
 * a mobile piece next to the opposing flag takes it on its side's move.
 */
function evaluateFor(state: SearchState, mover: LbSide): number {
  const { world } = state;
  const enemyFlag = world.flag[mover === 0 ? 1 : 0];
  if (enemyFlag >= 0 && adjacentMobile(world, enemyFlag, mover)) return WIN * 0.9;
  return evaluate(world, mover, state.params.weights);
}

const NEIGHBOURS: readonly (readonly number[])[] = Array.from({ length: LB_NODES }, (_, index) => stepsOf(index));

function adjacentMobile(world: World, at: number, side: number): boolean {
  for (const next of NEIGHBOURS[at]) {
    if (world.side[next] === side && world.rank[next] !== MINE && world.rank[next] !== FLAG && HQ[next] === 0) return true;
  }
  return false;
}

/** Score of one root move in the current world, for the side `state.me`. */
function rootValue(state: SearchState, move: number): number {
  const { world } = state;
  const made = makeMove(world, move);
  let score: number;
  if ((made & MADE_FLAG) !== 0 || !hasMove(world, state.them)) score = WIN;
  else if (world.quiet >= LB_QUIET_LIMIT) score = 0;
  else score = -negamax(state, state.them, state.depth - 1, NEG_INFINITY, -NEG_INFINITY, 1);
  unmakeMove(world);
  return score;
}

// ─── Belief tables ───

/** Our expected gain attacking each opponent token with each own rank, from the identity marginals. */
function ourGainTable(marginals: Float64Array, tokens: number, values: Float64Array): Float64Array {
  const table = new Float64Array(tokens * RANK_COUNT);
  for (let token = 0; token < tokens; token++) {
    for (let attacker = 0; attacker < RANK_COUNT; attacker++) {
      let gain = 0;
      for (let rank = 0; rank < RANK_COUNT; rank++) {
        const odds = marginals[token * RANK_COUNT + rank];
        if (odds > 0) gain += odds * battleGain(values, attacker, rank);
      }
      table[token * RANK_COUNT + attacker] = gain;
    }
  }
  return table;
}

/**
 * What the opponent can tell about each of our pieces in this world: our deployment rules, movement,
 * turning, and every battle outcome against its own (here sampled) identities, weighted by the broad
 * deployment prior. Fills the opponent's expected battle gain against each of our pieces.
 */
function fillTheirGain(state: SearchState, knowledge: LbKnowledge, assignment: Int8Array, ownFlagShown: boolean): void {
  const broad = deploymentPrior().broad;
  const values = state.params.weights.value;
  const odds = new Float64Array(RANK_COUNT);
  for (const cell of knowledge.board) {
    if (!cell || cell.side !== state.me) continue;
    const slot = lbSlotOf(state.me, cell.token);
    const record = knowledge.ownPublic.get(cell.token);
    let mask = slot >= 0 ? slotMask(slot) : 0xfff;
    if (record?.moved) mask &= ~((1 << MINE) | (1 << FLAG));
    if (record?.turned) mask &= 1 << ENGINEER;
    if (ownFlagShown) mask = cell.rank === 'flag' ? 1 << FLAG : mask & ~(1 << FLAG);
    for (const battle of record?.battles ?? []) {
      const index = state.tokenIndex[battle.token];
      const theirs = index >= 0 ? assignment[index] : -1;
      mask &= ~(1 << FLAG);
      if (theirs < 0) continue;
      const expected = battle.outcome === 'win' ? WIN_BATTLE : battle.outcome === 'lose' ? LOSE_BATTLE : TIE_BATTLE;
      for (let rank = 0; rank < RANK_COUNT; rank++) {
        const outcome = battle.attacked ? OUTCOME[rank * RANK_COUNT + theirs] : OUTCOME[theirs * RANK_COUNT + rank];
        if (outcome !== expected) mask &= ~(1 << rank);
      }
    }
    // A contradiction (the sampled identities cannot explain a battle) falls back to the real identity.
    if (mask === 0) mask = 1 << LB_RANKS.indexOf(cell.rank!);
    let total = 0;
    for (let rank = 0; rank < RANK_COUNT; rank++) {
      odds[rank] = (mask & (1 << rank)) !== 0 ? (slot >= 0 ? broad[slot * RANK_COUNT + rank] : 1) + 1e-6 : 0;
      total += odds[rank];
    }
    for (let attacker = 0; attacker < RANK_COUNT; attacker++) {
      let gain = 0;
      for (let rank = 0; rank < RANK_COUNT; rank++) if (odds[rank] > 0) gain += (odds[rank] / total) * battleGain(values, attacker, rank);
      state.theirGain[cell.token * RANK_COUNT + attacker] = gain;
    }
  }
}

// ─── Root ───

export interface SearchResult {
  readonly move: LbMove;
  readonly score: number;
  readonly worlds: number;
  /** Search nodes visited */
  readonly nodes: number;
}

/** Low officers learn the most for the least when they attack an uncertain piece. */
const PROBE_WEIGHT: Readonly<Record<number, number>> = { [LIEUTENANT]: 1, [CAPTAIN]: 0.8, [MAJOR]: 0.4 };

/** World counts after which the weaker half of the root moves stops being searched. */
const PRUNE_AT: readonly number[] = [3, 6, 12, 24, 48];

/**
 * Averages each own move's search value over sampled worlds until the budget runs out or `maxWorlds` are
 * done. `recent` lists the seat's last moves: undoing one of them costs a little, which breaks idle shuffles.
 */
export function searchMoves(
  knowledge: LbKnowledge, random: () => number, expired: () => boolean, params: SearchParams = defaultParams(), quietMoves = 0,
  recent: readonly { from: number; to: number }[] = [],
): SearchResult | null {
  const me = knowledge.side;
  const them: LbSide = me === 0 ? 1 : 0;
  const world = createWorld();
  fillWorld(world, knowledge, null, null);
  world.quiet = quietMoves;
  const rootMoves = new Int16Array(MOVES_PER_PLY);
  const count = generateMoves(world, me, rootMoves, 0);
  if (count === 0) return null;
  const moves = Array.from(rootMoves.subarray(0, count));
  const toMove = (move: number): LbMove => ({ from: moveFrom(move), to: moveTo(move), path: [] });
  if (moves.length === 1) return { move: toMove(moves[0]), score: 0, worlds: 0, nodes: 0 };

  const inference = createInference(knowledge);
  const tokenIndex = new Int8Array(LB_NODES).fill(-1);
  inference.tokens.forEach((token, index) => { tokenIndex[token] = index; });
  const marginals = estimateMarginals(inference, random, 48);
  if (!marginals) return null;
  const values = params.weights.value;
  const state: SearchState = {
    world, me, them, params, moves: new Int16Array(MAX_PLY * MOVES_PER_PLY), scores: new Float64Array(MAX_PLY * MOVES_PER_PLY),
    ourGain: ourGainTable(marginals, inference.tokens.length, values), theirGain: new Float64Array(LB_NODES * RANK_COUNT),
    tokenIndex, killers: new Int32Array(MAX_PLY).fill(-1), history: new Float64Array(1 << 12), expired, depth: params.depth, interruptible: true, stopped: false, nodes: 0,
  };
  const bonus = moves.map((move) => rootBonus(knowledge, move, marginals, tokenIndex, params, recent));
  const totals = new Float64Array(moves.length);
  const current = new Float64Array(moves.length);
  let active = moves.map((_, index) => index);
  const ownFlagShown = knowledge.ownLost.includes('marshal');
  let worlds = 0;
  while (worlds < params.maxWorlds && (worlds === 0 || !expired())) {
    const assignment = sampleAssignment(inference, random);
    if (!assignment) break;
    fillWorld(world, knowledge, inference, assignment);
    world.quiet = quietMoves;
    fillTheirGain(state, knowledge, assignment, ownFlagShown);
    for (const index of active) current[index] = rootValue(state, moves[index]);
    if (state.stopped && worlds === 0) {
      // Out of time before a single world: a one-ply look at this world still gives an informed move.
      state.stopped = false;
      state.interruptible = false;
      state.depth = 1;
      for (const index of active) current[index] = rootValue(state, moves[index]);
    }
    // Only complete worlds count.
    if (state.stopped) break;
    for (const index of active) totals[index] += current[index];
    worlds++;
    if (PRUNE_AT.includes(worlds) && active.length > 4) {
      active.sort((a, b) => totals[b] + bonus[b] * worlds - (totals[a] + bonus[a] * worlds));
      active = active.slice(0, Math.max(4, Math.ceil(active.length / 2)));
    }
  }
  if (worlds === 0) return null;
  let best = active[0];
  for (const index of active) {
    // Tiny noise keeps equal moves from always resolving the same way.
    const score = totals[index] / worlds + bonus[index] + random() * 1e-3;
    if (score > totals[best] / worlds + bonus[best]) best = index;
  }
  return { move: toMove(moves[best]), score: totals[best] / worlds + bonus[best], worlds, nodes: state.nodes };
}

/** Bonuses outside the search: probing uncertain pieces with low officers, and not undoing the last move. */
function rootBonus(
  knowledge: LbKnowledge, move: number, marginals: Float64Array, tokenIndex: Int8Array, params: SearchParams,
  recent: readonly { from: number; to: number }[],
): number {
  const from = moveFrom(move);
  const to = moveTo(move);
  let bonus = 0;
  if (recent.some((last) => last.to === from && last.from === to)) bonus -= params.shuffle;
  const target = knowledge.board[to];
  const attacker = knowledge.board[from]?.rank;
  if (target && target.side !== knowledge.side && attacker) {
    const weight = PROBE_WEIGHT[LB_RANKS.indexOf(attacker)] ?? 0;
    const index = tokenIndex[target.token];
    if (weight > 0 && index >= 0) {
      let entropy = 0;
      for (let rank = 0; rank < RANK_COUNT; rank++) {
        const odds = marginals[index * RANK_COUNT + rank];
        if (odds > 0) entropy -= odds * Math.log(odds);
      }
      bonus += params.probe * weight * entropy;
    }
  }
  return bonus;
}

/**
 * Puts the knowledge's pieces into `world`: own pieces with their ranks, opponent pieces with the sampled
 * identities, or a placeholder officer when only legality matters.
 */
function fillWorld(world: World, knowledge: LbKnowledge, inference: Inference | null, assignment: Int8Array | null): void {
  clearWorld(world);
  const placeholder = LB_RANKS.indexOf('lieutenant');
  knowledge.board.forEach((cell, at) => {
    if (!cell) return;
    if (cell.side === knowledge.side) {
      placePiece(world, at, cell.side, LB_RANKS.indexOf(cell.rank!), cell.token);
      return;
    }
    const index = inference ? inference.tokens.indexOf(cell.token) : -1;
    placePiece(world, at, cell.side, assignment && index >= 0 ? assignment[index] : placeholder, cell.token);
  });
}

// ─── Actions ───

export function moveAction(move: Pick<LbMove, 'from' | 'to'>): BotAction {
  return { type: 'game-action', request: { gameType: 'landbattle', action: { type: 'move', from: lbNode(move.from), to: lbNode(move.to) } } };
}

export function deployAction(layout: readonly LbRank[]): BotAction {
  return { type: 'game-action', request: { gameType: 'landbattle', action: { type: 'deploy', layout: [...layout] } } };
}

/** The seat's own last moves, newest first, as station pairs. */
export function recentMoves(visible: LandBattleVisibleState, count = 2): { from: number; to: number }[] {
  const own: { from: number; to: number }[] = [];
  for (let index = visible.log.length - 1; index >= 0 && own.length < count; index--) {
    const entry = visible.log[index];
    if (entry.seat !== visible.mySeat) continue;
    const from = lbCell(entry.from);
    const to = lbCell(entry.to);
    if (from !== null && to !== null) own.push({ from, to });
  }
  return own;
}

/** Search strategy for the bot worker pool; deploying returns a fresh formation straight away. */
export function landBattleSearch(visible: LandBattleVisibleState, context: SearchContext): BotAction | null {
  return landBattleDecision(visible, context.random, context.budget.expired, defaultParams());
}

/** The decision for any search budget: a formation while deploying, otherwise the sampled search. */
export function landBattleDecision(
  visible: LandBattleVisibleState, random: () => number, expired: () => boolean, params: SearchParams,
): BotAction | null {
  const side = visible.seats.indexOf(visible.mySeat);
  if (side < 0) return null;
  if (visible.phase === 'deploying') return visible.myLayout ? null : deployAction(botLayout(random));
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const knowledge = landBattleKnowledge(visible);
  if (!knowledge) return null;
  const found = searchMoves(knowledge, random, expired, params, visible.quietMoves, recentMoves(visible));
  return found ? moveAction(found.move) : null;
}
