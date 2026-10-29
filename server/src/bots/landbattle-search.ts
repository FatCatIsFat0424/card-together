// ─── Land Battle Chess search: sampled opponent identities, a two-ply look, and a positional evaluation ───
//
// Runs inside a bot worker (`GameBot.search`). It reads only the seat's own view: hidden opponent pieces get
// identities drawn from the knowledge built from public battle outcomes and movement, many times over, and
// each own move is scored by its average over those samples.

import type { LandBattleVisibleState } from '@shared/types';
import {
  LB_NODES, LB_POWER, LB_PRESETS, LB_QUIET_LIMIT, lbBattle, lbCell, lbHasMove, lbIsCamp, lbIsHq, lbLegalMoves, lbMirrorLayout, lbMobile, lbNode,
  lbRailSteps, lbSteps, lbSwapSlots,
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

export type World = (Known | null)[];

/** Material values; the flag is decided by the terminal score instead. */
export const LB_VALUE: Readonly<Record<LbRank, number>> = {
  marshal: 100, general: 80, 'major-general': 60, brigadier: 45, colonel: 34, major: 25, captain: 16,
  lieutenant: 11, engineer: 20, mine: 22, bomb: 46, flag: 0,
};

/**
 * A captured flag against material: worth more than a whole army, yet low enough that a slim chance of a
 * flag in one sampled world does not justify throwing an officer onto a likely mine.
 */
const WIN = 2_000;

/**
 * Worth of a mobile piece by its road distance to the opposing flag. It falls off slowly, so pieces far
 * from the flag still have a reason to advance instead of shuffling back and forth.
 */
const FLAG_PRESSURE: readonly number[] = [0, 60, 28, 14, 9, 6, 4, 3, 2, 1];

/** Score of a piece standing next to the opposing flag that the defender cannot remove: the flag falls next. */
const UNSTOPPABLE = WIN * 0.8;

/** Penalty for a flag threat the defender can still answer: it ties down a move and a defender. */
const ANSWERED_THREAT = 40;

/** Worth of each station next to a flag that the attacker can break into and the defender cannot retake. */
const OPENING = 90;

/** Share of the best recapture counted after an opponent capture: the exchange may not end there. */
const RECAPTURE = 0.7;

/** Penalty for each station next to the own flag that no own piece can reach in one move. */
const GUARD = 25;

/** Worth of each movable piece a side has fewer than `SCARCE_BELOW`. */
const SCARCE = 60;
const SCARCE_BELOW = 4;

/** Penalty for moving a piece straight back to where it just came from. */
const SHUFFLE = 6;

/**
 * Reward for attacking at all: low officers probe unknown pieces (a published outcome narrows them down), and
 * the closer the quiet-move limit, the more any battle is worth, so bots do not drift into the draw.
 */
function attackBonus(rank: LbRank, quietMoves: number): number {
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

/** The station one railway step beyond `current` in the direction from `previous`, or -1. */
function straightOn(previous: number, current: number): number {
  const col = 2 * (current % 5) - (previous % 5);
  const row = 2 * rowOf(current) - rowOf(previous);
  const next = row * 5 + col;
  return col >= 0 && col < 5 && row >= 0 && row < 12 && lbRailSteps(current).includes(next) ? next : -1;
}

/**
 * Stations of `side`'s pieces that can move onto `to` in one move: a step, a straight railway run through
 * empty stations, or an engineer's railway route with turns. The occupant of `to` is not checked.
 */
export function lbAttackers(world: World, to: number, side: LbSide): number[] {
  const found: number[] = [];
  const consider = (at: number, engineerOnly: boolean): void => {
    const cell = world[at];
    if (!cell || cell.side !== side || !lbMobile(cell.rank) || lbIsHq(at) || found.includes(at)) return;
    if (!engineerOnly || cell.rank === 'engineer') found.push(at);
  };
  for (const at of lbSteps(to)) consider(at, false);
  const rails = lbRailSteps(to);
  if (rails.length === 0) return found;
  for (const first of rails) {
    let previous = to;
    let current = first;
    while (current >= 0 && !world[current]) {
      const next = straightOn(previous, current);
      previous = current;
      current = next;
    }
    if (current >= 0) consider(current, false);
  }
  const seen = new Set<number>([to]);
  const queue = [to];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of lbRailSteps(current)) {
      if (seen.has(next)) continue;
      seen.add(next);
      if (world[next]) consider(next, true);
      else queue.push(next);
    }
  }
  return found;
}

/** Best material gain of `side` removing the opponent piece on `at` (0 when nothing profitable can). */
function removalGain(world: World, at: number, side: LbSide): number {
  const target = world[at];
  if (!target || target.side === side || lbIsCamp(at)) return 0;
  let best = 0;
  for (const from of lbAttackers(world, at, side)) {
    const rank = world[from]!.rank;
    const outcome = lbBattle(rank, target.rank);
    const gain = outcome === 'win' ? LB_VALUE[target.rank] : outcome === 'tie' ? LB_VALUE[target.rank] - LB_VALUE[rank] : -1;
    best = Math.max(best, gain);
  }
  return best;
}

/** Whether `side` can remove the opponent piece on `at` this move, by winning or trading. */
function removable(world: World, at: number, side: LbSide): boolean {
  const target = world[at]!;
  return lbAttackers(world, at, side).some((from) => lbBattle(world[from]!.rank, target.rank) !== 'lose');
}

/**
 * Stations next to `side`'s flag that the opponent can break into and hold: one of its pieces reaches the
 * station and beats what stands there (only an engineer clears a mine), and no piece of `side` that reaches
 * the station removes the strongest opponent piece that does.
 */
export function flagOpenings(world: World, flag: number, side: LbSide): number {
  if (flag < 0) return 0;
  const them: LbSide = side === 0 ? 1 : 0;
  let open = 0;
  for (const at of lbSteps(flag)) {
    const occupant = world[at];
    if (occupant?.side === them) continue;
    const raiders = lbAttackers(world, at, them);
    if (raiders.length === 0) continue;
    if (occupant && !raiders.some((from) => lbBattle(world[from]!.rank, occupant.rank) !== 'lose')) continue;
    let strongest = world[raiders[0]]!.rank;
    for (const from of raiders) if (LB_POWER[world[from]!.rank] > LB_POWER[strongest]) strongest = world[from]!.rank;
    if (!lbAttackers(world, at, side).some((from) => lbBattle(world[from]!.rank, strongest) !== 'lose')) open++;
  }
  return open;
}

/**
 * Pieces of `attacker` next to the defender's flag decide the match: on the attacker's move the flag falls;
 * on the defender's move it falls unless the single threat can be removed.
 */
function flagThreat(world: World, flag: number, attacker: LbSide, toMove: LbSide): number {
  if (flag < 0) return 0;
  const threats = lbSteps(flag).filter((at) => {
    const cell = world[at];
    return cell?.side === attacker && lbMobile(cell.rank);
  });
  if (threats.length === 0) return 0;
  if (toMove === attacker) return WIN * 0.9;
  const defender: LbSide = attacker === 0 ? 1 : 0;
  return threats.length === 1 && removable(world, threats[0], defender) ? ANSWERED_THREAT : UNSTOPPABLE;
}

/**
 * Score of a world for `me` with `toMove` to play: material, advanced and camped officers, pressure on both
 * flags, and pieces standing next to a flag.
 */
export function evaluateWorld(world: World, me: LbSide, toMove: LbSide = me === 0 ? 1 : 0): number {
  const them: LbSide = me === 0 ? 1 : 0;
  const myFlag = flagOf(world, me);
  const theirFlag = flagOf(world, them);
  let score = 0;
  const movers = [0, 0];
  for (let index = 0; index < LB_NODES; index++) {
    const cell = world[index];
    if (!cell) continue;
    const sign = cell.side === me ? 1 : -1;
    let value = LB_VALUE[cell.rank];
    if (cell.rank !== 'mine' && cell.rank !== 'flag') {
      if (!lbIsHq(index)) movers[cell.side]++;
      value += advance(cell.side, index) * (cell.rank === 'engineer' ? 3 : 5);
      if (lbIsCamp(index)) value += 3;
      if (lbIsHq(index)) value -= 6;
      const enemyFlag = cell.side === me ? theirFlag : myFlag;
      if (enemyFlag >= 0 && cell.rank !== 'bomb') {
        value += FLAG_PRESSURE[Math.min(DISTANCE[index][enemyFlag], FLAG_PRESSURE.length - 1)];
      }
    }
    score += sign * value;
  }
  // A side whose last pieces cannot move loses, so the last few movable pieces are worth more.
  score += SCARCE * (Math.max(0, SCARCE_BELOW - movers[them]) - Math.max(0, SCARCE_BELOW - movers[me]));
  return score + flagThreat(world, theirFlag, me, toMove) - flagThreat(world, myFlag, them, toMove);
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

/**
 * Score of `move` for `me` in one world: the position after it, pulled toward the opponent's most damaging
 * reply. Replies are the opponent's battles and its moves next to our flag; after a capture our best
 * recapture partly counts, and a move that reaches the quiet-move limit is a draw (0).
 */
export function scoreMove(world: World, move: LbMove, me: LbSide, quietMoves = 0): number {
  const them: LbSide = me === 0 ? 1 : 0;
  const battle = world[move.to] !== null;
  const after = play(world, move);
  if (after.flag || !lbHasMove(after.world, them)) return WIN;
  const quiet = battle ? 0 : quietMoves + 1;
  if (quiet >= LB_QUIET_LIMIT) return 0;
  const myFlag = flagOf(after.world, me);
  // Control of the stations around both flags, judged once after our move and carried into every reply.
  const unguarded = myFlag >= 0 ? lbSteps(myFlag).filter((at) => lbAttackers(after.world, at, me).length === 0).length : 0;
  const control = OPENING * (flagOpenings(after.world, flagOf(after.world, them), them) - flagOpenings(after.world, myFlag, me))
    - GUARD * unguarded;
  const base = evaluateWorld(after.world, me, them) + control;
  const guarded = myFlag >= 0 ? lbSteps(myFlag) : [];
  let worst = base;
  for (const reply of lbLegalMoves(after.world, them)) {
    const target = after.world[reply.to];
    if (!target && !guarded.includes(reply.to)) continue;
    const answered = play(after.world, reply);
    if (answered.flag) return -WIN;
    let value: number;
    if (!target && quiet + 1 >= LB_QUIET_LIMIT) value = 0;
    else {
      value = evaluateWorld(answered.world, me, me) + control;
      if (target && !lbHasMove(answered.world, me)) value = -WIN;
      else if (target && answered.world[reply.to]?.side === them) value += RECAPTURE * removalGain(answered.world, reply.to, me);
    }
    worst = Math.min(worst, value);
  }
  // The opponent cannot see our identities either, so its best reply is only partly expected.
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

/**
 * Average scores of the own moves over sampled worlds until the budget runs out or `samples` are done.
 * `recent` lists the seat's last moves: undoing one of them costs a little, which breaks idle shuffles.
 */
export function searchMoves(
  knowledge: LbKnowledge, random: () => number, expired: () => boolean, samples: number, quietMoves = 0,
  recent: readonly { from: number; to: number }[] = [],
): { move: LbMove; score: number } | null {
  const moves = lbLegalMoves(knowledge.board, knowledge.side);
  if (moves.length === 0) return null;
  const bonus = moves.map((move) => {
    const attack = knowledge.board[move.to] ? attackBonus(knowledge.board[move.from]!.rank!, quietMoves) : 0;
    const undo = recent.some((last) => last.to === move.from && last.from === move.to) ? SHUFFLE : 0;
    return attack - undo;
  });
  const totals = new Array<number>(moves.length).fill(0);
  let done = 0;
  while (done < samples && (done === 0 || !expired())) {
    const world = sampleWorld(knowledge, random);
    if (!world) break;
    moves.forEach((move, index) => { totals[index] += scoreMove(world, move, knowledge.side, quietMoves) + bonus[index]; });
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

/**
 * Samples the hard bot draws at most. Bot matches showed more samples playing worse (400 lost to 24), since
 * the evaluation's rare-world errors then decide every move, so the search stops well inside its budget.
 */
const MAX_SAMPLES = 40;

/** Search strategy for the bot worker pool; deploying returns the template deployment straight away. */
export function landBattleSearch(visible: LandBattleVisibleState, context: SearchContext): BotAction | null {
  const side = visible.seats.indexOf(visible.mySeat);
  if (side < 0) return null;
  if (visible.phase === 'deploying') return visible.myLayout ? null : deployAction(templateLayout(context.random));
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const knowledge = landBattleKnowledge(visible);
  if (!knowledge) return null;
  const found = searchMoves(knowledge, context.random, context.budget.expired, MAX_SAMPLES, visible.quietMoves, recentMoves(visible));
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
