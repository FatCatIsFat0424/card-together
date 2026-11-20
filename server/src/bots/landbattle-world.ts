// ─── Land Battle Chess search worlds: typed-array boards with make/unmake, move generation and evaluation ───
//
// One world is one fully determined position: own pieces as they are, opponent pieces with sampled identities.
// Ranks are indices into `LB_RANKS` (0 marshal … 8 engineer, 9 mine, 10 bomb, 11 flag); -1 marks an empty
// station. Every piece also carries its deployment station (`origin`), which never changes.

import {
  LB_NODES, LB_RANKS, lbBattle, lbIsCamp, lbIsHq, lbRailSteps, lbSteps,
} from '@shared/rules/landbattle';
import type { LbSide } from '@shared/rules/landbattle';

export const RANK_COUNT = LB_RANKS.length;
export const ENGINEER = LB_RANKS.indexOf('engineer');
export const MINE = LB_RANKS.indexOf('mine');
export const BOMB = LB_RANKS.indexOf('bomb');
export const FLAG = LB_RANKS.indexOf('flag');
export const LIEUTENANT = LB_RANKS.indexOf('lieutenant');
export const CAPTAIN = LB_RANKS.indexOf('captain');
export const MAJOR = LB_RANKS.indexOf('major');

/** Battle outcome codes for the attacker. */
export const WIN_BATTLE = 0;
export const LOSE_BATTLE = 1;
export const TIE_BATTLE = 2;

/** Attacker outcome by `attacker * RANK_COUNT + defender`. */
export const OUTCOME: Int8Array = (() => {
  const table = new Int8Array(RANK_COUNT * RANK_COUNT);
  for (let a = 0; a < RANK_COUNT; a++) {
    for (let d = 0; d < RANK_COUNT; d++) {
      const outcome = lbBattle(LB_RANKS[a], LB_RANKS[d]);
      table[a * RANK_COUNT + d] = outcome === 'win' ? WIN_BATTLE : outcome === 'lose' ? LOSE_BATTLE : TIE_BATTLE;
    }
  }
  return table;
})();

// ─── Topology, flattened into typed arrays once ───

const MAX_STEPS = 8;
/** One-step neighbours, `MAX_STEPS` per station, -1 padded. */
const STEP: Int8Array = new Int8Array(LB_NODES * MAX_STEPS).fill(-1);
const STEP_COUNT: Int8Array = new Int8Array(LB_NODES);
/** Railway neighbours, four per station at most, -1 padded. */
const RAIL: Int8Array = new Int8Array(LB_NODES * 4).fill(-1);
const RAIL_COUNT: Int8Array = new Int8Array(LB_NODES);
/** Straight railway rays: for each station and railway neighbour, the stations along that straight line. */
const RAY_START: Int16Array = new Int16Array(LB_NODES * 4);
const RAY_LENGTH: Int8Array = new Int8Array(LB_NODES * 4);
const RAY_CELLS: number[] = [];
export const CAMP: Uint8Array = Uint8Array.from({ length: LB_NODES }, (_, index) => (lbIsCamp(index) ? 1 : 0));
export const HQ: Uint8Array = Uint8Array.from({ length: LB_NODES }, (_, index) => (lbIsHq(index) ? 1 : 0));

for (let index = 0; index < LB_NODES; index++) {
  const steps = lbSteps(index);
  STEP_COUNT[index] = steps.length;
  steps.forEach((to, slot) => { STEP[index * MAX_STEPS + slot] = to; });
  const rails = lbRailSteps(index);
  RAIL_COUNT[index] = rails.length;
  rails.forEach((first, slot) => {
    RAIL[index * 4 + slot] = first;
    const dc = (first % 5) - (index % 5);
    const dr = Math.floor(first / 5) - Math.floor(index / 5);
    RAY_START[index * 4 + slot] = RAY_CELLS.length;
    let current = first;
    let length = 0;
    for (;;) {
      RAY_CELLS.push(current);
      length++;
      const col = (current % 5) + dc;
      const row = Math.floor(current / 5) + dr;
      const next = col >= 0 && col < 5 && row >= 0 && row < 12 ? row * 5 + col : -1;
      if (next < 0 || !lbRailSteps(current).includes(next)) break;
      current = next;
    }
    RAY_LENGTH[index * 4 + slot] = length;
  });
}
const RAYS: Int8Array = Int8Array.from(RAY_CELLS);

/** Road distances between stations, ignoring pieces, by `from * LB_NODES + to`. */
export const DISTANCE: Uint8Array = (() => {
  const table = new Uint8Array(LB_NODES * LB_NODES).fill(99);
  for (let start = 0; start < LB_NODES; start++) {
    table[start * LB_NODES + start] = 0;
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const base = table[start * LB_NODES + current];
      for (const next of lbSteps(current)) {
        if (table[start * LB_NODES + next] > base + 1) {
          table[start * LB_NODES + next] = base + 1;
          queue.push(next);
        }
      }
    }
  }
  return table;
})();

export const stepsOf = (index: number): number[] => {
  const result: number[] = [];
  for (let slot = 0; slot < STEP_COUNT[index]; slot++) result.push(STEP[index * MAX_STEPS + slot]);
  return result;
};

// ─── Worlds ───

export interface World {
  /** Rank index by station, -1 when empty */
  readonly rank: Int8Array;
  /** Side by station, -1 when empty */
  readonly side: Int8Array;
  /** Deployment station of the piece by station, -1 when empty */
  readonly origin: Int8Array;
  /** Flag station of each side, -1 once taken */
  readonly flag: Int8Array;
  /** Moves since the last battle */
  quiet: number;
  /** Undo records, `UNDO_SIZE` entries per made move */
  readonly undo: Int16Array;
  depth: number;
}

const UNDO_SIZE = 8;
const MAX_UNDO = 64;

export function createWorld(): World {
  return {
    rank: new Int8Array(LB_NODES).fill(-1),
    side: new Int8Array(LB_NODES).fill(-1),
    origin: new Int8Array(LB_NODES).fill(-1),
    flag: new Int8Array(2).fill(-1),
    quiet: 0,
    undo: new Int16Array(MAX_UNDO * UNDO_SIZE),
    depth: 0,
  };
}

export function clearWorld(world: World): void {
  world.rank.fill(-1);
  world.side.fill(-1);
  world.origin.fill(-1);
  world.flag.fill(-1);
  world.quiet = 0;
  world.depth = 0;
}

export function placePiece(world: World, at: number, side: LbSide, rank: number, origin: number): void {
  world.rank[at] = rank;
  world.side[at] = side;
  world.origin[at] = origin;
  if (rank === FLAG) world.flag[side] = at;
}

/** Moves are packed as `from | to << 6`. */
export const moveFrom = (move: number): number => move & 63;
export const moveTo = (move: number): number => move >> 6;

/** Result flags of `makeMove`. */
export const MADE_BATTLE = 1;
export const MADE_FLAG = 2;

/** Plays a generated move; returns MADE_* flags. `unmakeMove` restores the world exactly. */
export function makeMove(world: World, move: number): number {
  const from = move & 63;
  const to = move >> 6;
  const { rank, side, origin, undo } = world;
  const record = world.depth * UNDO_SIZE;
  undo[record] = move;
  undo[record + 1] = rank[to];
  undo[record + 2] = side[to];
  undo[record + 3] = origin[to];
  undo[record + 4] = world.quiet;
  undo[record + 5] = rank[from];
  undo[record + 6] = side[from];
  undo[record + 7] = origin[from];
  world.depth++;
  const attacker = rank[from];
  const defender = rank[to];
  if (defender < 0) {
    rank[to] = attacker;
    side[to] = side[from];
    origin[to] = origin[from];
    world.quiet++;
  } else {
    world.quiet = 0;
    const outcome = OUTCOME[attacker * RANK_COUNT + defender];
    if (defender === FLAG) world.flag[side[to]] = -1;
    if (outcome === WIN_BATTLE) {
      rank[to] = attacker;
      side[to] = side[from];
      origin[to] = origin[from];
    } else if (outcome === TIE_BATTLE) {
      rank[to] = -1;
      side[to] = -1;
      origin[to] = -1;
    }
  }
  rank[from] = -1;
  side[from] = -1;
  origin[from] = -1;
  return defender < 0 ? 0 : defender === FLAG ? MADE_BATTLE | MADE_FLAG : MADE_BATTLE;
}

export function unmakeMove(world: World): void {
  world.depth--;
  const record = world.depth * UNDO_SIZE;
  const { rank, side, origin, undo } = world;
  const move = undo[record];
  const from = move & 63;
  const to = move >> 6;
  rank[from] = undo[record + 5];
  side[from] = undo[record + 6];
  origin[from] = undo[record + 7];
  rank[to] = undo[record + 1];
  side[to] = undo[record + 2];
  origin[to] = undo[record + 3];
  if (rank[to] === FLAG) world.flag[side[to]] = to;
  world.quiet = undo[record + 4];
}

const visitStamp = new Int32Array(LB_NODES);
const seenTo = new Int32Array(LB_NODES);
let stamp = 0;
const bfsQueue = new Int8Array(LB_NODES);

/**
 * Writes `mover`'s legal moves into `out` from `offset` and returns the new end. With `attacksOnly`, only
 * moves onto opponent pieces outside camps.
 */
export function generateMoves(world: World, mover: number, out: Int16Array, offset: number, attacksOnly = false): number {
  const { rank, side } = world;
  let end = offset;
  for (let from = 0; from < LB_NODES; from++) {
    if (side[from] !== mover) continue;
    const piece = rank[from];
    if (piece === MINE || piece === FLAG || HQ[from] === 1) continue;
    stamp++;
    const stepBase = from * MAX_STEPS;
    for (let slot = 0; slot < STEP_COUNT[from]; slot++) {
      const to = STEP[stepBase + slot];
      const occupant = rank[to];
      if (occupant < 0 ? attacksOnly : side[to] === mover || CAMP[to] === 1) continue;
      seenTo[to] = stamp;
      out[end++] = from | (to << 6);
    }
    if (RAIL_COUNT[from] === 0) continue;
    if (piece === ENGINEER) {
      // Breadth-first along railways through empty stations, turning freely.
      visitStamp[from] = stamp;
      let head = 0;
      let tail = 0;
      bfsQueue[tail++] = from;
      while (head < tail) {
        const current = bfsQueue[head++];
        for (let slot = 0; slot < RAIL_COUNT[current]; slot++) {
          const next = RAIL[current * 4 + slot];
          if (visitStamp[next] === stamp) continue;
          visitStamp[next] = stamp;
          if (rank[next] < 0) {
            bfsQueue[tail++] = next;
            if (attacksOnly || seenTo[next] === stamp) continue;
          } else if (side[next] === mover || CAMP[next] === 1 || seenTo[next] === stamp) continue;
          seenTo[next] = stamp;
          out[end++] = from | (next << 6);
        }
      }
      continue;
    }
    for (let slot = 0; slot < RAIL_COUNT[from]; slot++) {
      const start = RAY_START[from * 4 + slot];
      const length = RAY_LENGTH[from * 4 + slot];
      for (let step = 0; step < length; step++) {
        const at = RAYS[start + step];
        if (rank[at] >= 0) {
          if (side[at] !== mover && CAMP[at] === 0 && seenTo[at] !== stamp) {
            seenTo[at] = stamp;
            out[end++] = from | (at << 6);
          }
          break;
        }
        if (!attacksOnly && seenTo[at] !== stamp) {
          seenTo[at] = stamp;
          out[end++] = from | (at << 6);
        }
      }
    }
  }
  return end;
}

/** Whether `mover` has any legal move (a single step suffices: every railway run starts with one). */
export function hasMove(world: World, mover: number): boolean {
  const { rank, side } = world;
  for (let from = 0; from < LB_NODES; from++) {
    if (side[from] !== mover) continue;
    const piece = rank[from];
    if (piece === MINE || piece === FLAG || HQ[from] === 1) continue;
    for (let slot = 0; slot < STEP_COUNT[from]; slot++) {
      const to = STEP[from * MAX_STEPS + slot];
      if (rank[to] < 0 || (side[to] !== mover && CAMP[to] === 0)) return true;
    }
  }
  return false;
}

// ─── Evaluation ───

export interface EvalWeights {
  /** Material by rank index */
  readonly value: Float64Array;
  /** Worth of a mobile piece by its road distance to the opposing flag */
  readonly pressure: Float64Array;
  /** Worth of full advance (back row to the opponent's back row) for officers */
  readonly advance: number;
  readonly camp: number;
  /** Penalty for a mobile piece stuck in a headquarters */
  readonly stuck: number;
  /** Worth of each movable piece below `scarceBelow` */
  readonly scarce: number;
  readonly scarceBelow: number;
  /** Extra worth of each engineer while opponent mines still guard the flag */
  readonly engineerNeed: number;
  /** Worth of each own mobile piece next to the own flag */
  readonly guard: number;
}

export const DEFAULT_VALUES: readonly number[] = [100, 80, 60, 45, 34, 25, 16, 11, 20, 22, 46, 0];

export function defaultWeights(): EvalWeights {
  return {
    value: Float64Array.from(DEFAULT_VALUES),
    pressure: Float64Array.from([0, 60, 28, 14, 9, 6, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    advance: 5,
    camp: 3,
    stuck: 6,
    scarce: 60,
    scarceBelow: 4,
    engineerNeed: 12,
    guard: 6,
  };
}

const rowOf = (index: number): number => (index / 5) | 0;

/** Score of the world for `pov`: positive favours `pov`. */
export function evaluate(world: World, pov: LbSide, weights: EvalWeights): number {
  const { rank, side, flag } = world;
  const value = weights.value;
  const pressure = weights.pressure;
  let score = 0;
  let movers0 = 0;
  let movers1 = 0;
  let engineers0 = 0;
  let engineers1 = 0;
  const flag0 = flag[0];
  const flag1 = flag[1];
  for (let at = 0; at < LB_NODES; at++) {
    const piece = rank[at];
    if (piece < 0) continue;
    const owner = side[at];
    let worth = value[piece];
    if (piece !== MINE && piece !== FLAG) {
      if (HQ[at] === 1) worth -= weights.stuck;
      else if (owner === 0) movers0++;
      else movers1++;
      if (piece === ENGINEER) {
        if (owner === 0) engineers0++;
        else engineers1++;
      }
      if (piece !== BOMB) {
        const target = owner === 0 ? flag1 : flag0;
        if (target >= 0) {
          const distance = DISTANCE[at * LB_NODES + target];
          worth += pressure[distance < 19 ? distance : 19];
        }
        const advanced = owner === 0 ? 11 - rowOf(at) : rowOf(at);
        worth += (advanced / 11) * (piece === ENGINEER ? weights.advance * 0.6 : weights.advance);
        if (CAMP[at] === 1) worth += weights.camp;
      }
      const own = owner === 0 ? flag0 : flag1;
      if (own >= 0 && DISTANCE[at * LB_NODES + own] === 1) worth += weights.guard;
    }
    score += owner === pov ? worth : -worth;
  }
  // The last few movable pieces matter: a side without a legal move loses.
  const scarce0 = Math.max(0, weights.scarceBelow - movers0);
  const scarce1 = Math.max(0, weights.scarceBelow - movers1);
  let own = weights.scarce * (scarce1 - scarce0);
  // Engineers are worth more while mines still stand next to the opposing flag.
  own += weights.engineerNeed * (Math.min(engineers0, minesNear(world, flag1)) - Math.min(engineers1, minesNear(world, flag0)));
  return score + (pov === 0 ? own : -own);
}

function minesNear(world: World, flagAt: number): number {
  if (flagAt < 0) return 0;
  let count = 0;
  const base = flagAt * MAX_STEPS;
  for (let slot = 0; slot < STEP_COUNT[flagAt]; slot++) if (world.rank[STEP[base + slot]] === MINE) count++;
  return count;
}
