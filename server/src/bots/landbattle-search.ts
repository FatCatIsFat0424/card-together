// ─── Land Battle Chess search: sampled opponent identities, a two-ply look, and a positional evaluation ───
//
// Runs inside a bot worker (`GameBot.search`). It reads only the seat's own view: hidden opponent pieces get
// identities drawn from the knowledge built from public battle outcomes and movement, many times over, and
// each own move is scored by its average over those samples.

import type { LandBattleVisibleState } from '@shared/types';
import {
  LB_NODES, LB_PRESETS, LB_QUIET_LIMIT, lbBattle, lbHasMove, lbIsCamp, lbIsHq, lbLegalMoves, lbMirrorLayout, lbNode, lbSteps, lbSwapSlots,
} from '@shared/rules/landbattle';
import type { LbMove, LbRank, LbSide } from '@shared/rules/landbattle';
import type { BotAction } from './bot-decisions';
import type { SearchContext } from './search/search-types';
import { landBattleKnowledge, sampleIdentities } from './landbattle-knowledge';
import type { LbKnowledge } from './landbattle-knowledge';

/** A fully known piece in one sampled world. */
interface Known {
  readonly side: LbSide;
  readonly rank: LbRank;
}

type World = (Known | null)[];

/** Material values; the flag is decided by the terminal score instead. */
export const LB_VALUE: Readonly<Record<LbRank, number>> = {
  marshal: 100, general: 80, 'major-general': 60, brigadier: 45, colonel: 34, major: 25, captain: 16,
  lieutenant: 11, engineer: 20, mine: 22, bomb: 46, flag: 0,
};

const WIN = 100_000;

/** Worth of a mobile piece by its road distance to the opposing flag (0 to 4 or more stations). */
const FLAG_PRESSURE: readonly number[] = [0, 60, 25, 8, 0];

/**
 * Reward for attacking at all: low officers probe unknown pieces (a published outcome narrows them down), and
 * the closer the quiet-move limit, the more any battle is worth, so bots do not drift into the draw.
 */
export function attackBonus(rank: LbRank, quietMoves: number): number {
  const probe = rank === 'lieutenant' || rank === 'captain' || rank === 'major' ? 8 : 0;
  return probe + 40 * Math.max(0, quietMoves - LB_QUIET_LIMIT / 3) / LB_QUIET_LIMIT;
}

/** Road distances between stations, ignoring pieces. */
const DISTANCE: readonly (readonly number[])[] = Array.from({ length: LB_NODES }, (_, start) => {
  const distance = new Array<number>(LB_NODES).fill(99);
  distance[start] = 0;
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of lbSteps(current)) {
      if (distance[next] > distance[current] + 1) {
        distance[next] = distance[current] + 1;
        queue.push(next);
      }
    }
  }
  return distance;
});

/** Stations between two stations by road, ignoring pieces. */
export const lbRoadDistance = (a: number, b: number): number => DISTANCE[a][b];

const rowOf = (index: number): number => Math.floor(index / 5);

/** How far a side's piece has advanced, from 0 at its own back row to 1 at the opponent's. */
const advance = (side: LbSide, index: number): number => (side === 0 ? 11 - rowOf(index) : rowOf(index)) / 11;

function flagOf(world: World, side: LbSide): number {
  for (let index = 0; index < LB_NODES; index++) {
    const cell = world[index];
    if (cell?.side === side && cell.rank === 'flag') return index;
  }
  return -1;
}

/**
 * Score of a world for `me`: material, advanced and camped officers, pressure on the opponent's flag, and
 * danger around our own.
 */
export function evaluateWorld(world: World, me: LbSide): number {
  const myFlag = flagOf(world, me);
  const theirFlag = flagOf(world, me === 0 ? 1 : 0);
  let score = 0;
  for (let index = 0; index < LB_NODES; index++) {
    const cell = world[index];
    if (!cell) continue;
    const sign = cell.side === me ? 1 : -1;
    let value = LB_VALUE[cell.rank];
    if (cell.rank !== 'mine' && cell.rank !== 'flag') {
      value += advance(cell.side, index) * (cell.rank === 'engineer' ? 3 : 5);
      if (lbIsCamp(index)) value += 3;
      if (lbIsHq(index)) value -= 6;
      const enemyFlag = cell.side === me ? theirFlag : myFlag;
      if (enemyFlag >= 0 && cell.rank !== 'bomb') value += FLAG_PRESSURE[Math.min(DISTANCE[index][enemyFlag], 4)];
    }
    score += sign * value;
  }
  return score;
}

/** Applies a generated move in a fully known world. */
function play(world: World, move: LbMove): { world: World; flag: boolean } {
  const next = [...world];
  const attacker = world[move.from]!;
  const defender = world[move.to];
  next[move.from] = null;
  if (!defender) {
    next[move.to] = attacker;
    return { world: next, flag: false };
  }
  const outcome = lbBattle(attacker.rank, defender.rank);
  next[move.to] = outcome === 'win' ? attacker : outcome === 'lose' ? defender : null;
  return { world: next, flag: defender.rank === 'flag' };
}

/** Score of `move` for `me` in one world: the position after it, pulled toward the opponent's best capture. */
function scoreMove(world: World, move: LbMove, me: LbSide): number {
  const them: LbSide = me === 0 ? 1 : 0;
  const after = play(world, move);
  if (after.flag || !lbHasMove(after.world, them)) return WIN;
  const base = evaluateWorld(after.world, me);
  let worst = base;
  for (const reply of lbLegalMoves(after.world, them)) {
    if (!after.world[reply.to]) continue;
    const answered = play(after.world, reply);
    if (answered.flag) return -WIN;
    worst = Math.min(worst, evaluateWorld(answered.world, me));
  }
  // The opponent cannot see our identities either, so its best capture is only partly expected.
  return base - 0.6 * (base - worst);
}

/** One sampled world: own pieces as they are, opponent pieces with drawn identities. */
export function sampleWorld(knowledge: LbKnowledge, random: () => number): World | null {
  const identities = sampleIdentities(knowledge, random);
  if (!identities) return null;
  return knowledge.board.map((cell) => {
    if (!cell) return null;
    if (cell.side === knowledge.side) return { side: cell.side, rank: cell.rank! };
    return { side: cell.side, rank: identities.get(cell.token)! };
  });
}

export function moveAction(move: Pick<LbMove, 'from' | 'to'>): BotAction {
  return { type: 'game-action', request: { gameType: 'landbattle', action: { type: 'move', from: lbNode(move.from), to: lbNode(move.to) } } };
}

export function deployAction(layout: readonly LbRank[]): BotAction {
  return { type: 'game-action', request: { gameType: 'landbattle', action: { type: 'deploy', layout: [...layout] } } };
}

/** Average scores of the own moves over sampled worlds until the budget runs out or `samples` are done. */
export function searchMoves(
  knowledge: LbKnowledge, random: () => number, expired: () => boolean, samples: number, quietMoves = 0,
): { move: LbMove; score: number } | null {
  const moves = lbLegalMoves(knowledge.board, knowledge.side);
  if (moves.length === 0) return null;
  const bonus = moves.map((move) => (knowledge.board[move.to] ? attackBonus(knowledge.board[move.from]!.rank!, quietMoves) : 0));
  const totals = new Array<number>(moves.length).fill(0);
  let done = 0;
  while (done < samples && (done === 0 || !expired())) {
    const world = sampleWorld(knowledge, random);
    if (!world) break;
    moves.forEach((move, index) => { totals[index] += scoreMove(world, move, knowledge.side) + bonus[index]; });
    done++;
  }
  if (done === 0) return null;
  let best = 0;
  for (let index = 1; index < moves.length; index++) {
    // Tiny noise keeps equal moves from always resolving the same way.
    if (totals[index] + random() * 1e-3 > totals[best]) best = index;
  }
  return { move: moves[best], score: totals[best] / done };
}

/** Samples the hard bot draws at most; the clock usually stops it first. */
const MAX_SAMPLES = 400;

/** Search strategy for the bot worker pool; deploying returns the template deployment straight away. */
export function landBattleSearch(visible: LandBattleVisibleState, context: SearchContext): BotAction | null {
  const side = visible.seats.indexOf(visible.mySeat);
  if (side < 0) return null;
  if (visible.phase === 'deploying') return visible.myLayout ? null : deployAction(templateLayout(context.random));
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const knowledge = landBattleKnowledge(visible);
  if (!knowledge) return null;
  const found = searchMoves(knowledge, context.random, context.budget.expired, MAX_SAMPLES, visible.quietMoves);
  return found ? moveAction(found.move) : null;
}

/** Ranks a template may trade places with without changing its character. */
const PEERS: readonly (readonly LbRank[])[] = [
  ['major-general', 'brigadier', 'general'], ['colonel', 'major', 'brigadier'], ['captain', 'lieutenant', 'major'],
  ['engineer', 'lieutenant', 'captain'],
];

/** A preset formation, mirrored at random, with a few exchanges between pieces of similar strength. */
export function templateLayout(random: () => number): LbRank[] {
  const base = LB_PRESETS[Math.min(LB_PRESETS.length - 1, Math.floor(random() * LB_PRESETS.length))];
  let layout = random() < 0.5 ? lbMirrorLayout(base) : [...base];
  for (let swap = 0; swap < 4; swap++) {
    const a = Math.floor(random() * layout.length);
    const peers = PEERS.find((group) => group.includes(layout[a]));
    if (!peers) continue;
    const options = layout.flatMap((rank, slot) => (slot !== a && peers.includes(rank) && rank !== layout[a] ? [slot] : []));
    if (options.length === 0) continue;
    layout = lbSwapSlots(layout, a, options[Math.floor(random() * options.length)]) ?? layout;
  }
  return layout;
}
