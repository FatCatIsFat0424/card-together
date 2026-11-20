// ─── Jungle evaluation: material, true path distance to the den, den races, and the rat-elephant relation ───

import { JG_COLS, JG_ELEPHANT, JG_RAT } from '@shared/rules/jungle';
import {
  CELLS, DEN, DEN_GATES, JUMP_COUNT, JUMP_LAND, STEP, STEP_COUNT, TRAP_OWNER, WATER,
} from './jungle-board';
import type { Board } from './jungle-board';

/** Slots of the weight vector; `jungle-weights.ts` holds the tuned values. */
export const W = {
  /** Material of ranks 1-8, then advance per step of ranks 1-8 */
  MATERIAL: 0,
  ADVANCE: 8,
  /** Share of a piece's material left while it stands in a trap of the opponent (percent) */
  TRAPPED: 16,
  /** A free rat is worth more while the enemy elephant lives; an elephant less while the enemy rat does */
  RAT_HUNT: 17,
  ELEPHANT_FEAR: 18,
  ELEPHANT_NEAR: 19,
  /** Bonus for a runner that reaches an uncovered trap next to the den in 1-6 moves */
  RACE: 20,
  /** Per trap next to the own den that a defender covers in time */
  COVER: 26,
  /** Per legal move more than the opponent */
  MOBILITY: 27,
  /** Side to move */
  TEMPO: 28,
  /** Extra advance weight when pieces are scarce, per missing piece (percent) */
  ENDGAME: 29,
  /** Jitter that breaks exact ties between equal moves */
  NOISE: 30,
  /** Quiet plies after which the value starts to fade towards the draw */
  FADE_FROM: 31,
  COUNT: 32,
} as const;

/** Movement class of a rank: 0 walks on land, 1 swims, 2 also jumps the river. */
const CLASS_OF: readonly number[] = [0, 1, 0, 0, 0, 0, 2, 2, 0];

const UNREACHABLE = 40;

/** Moves a piece needs from every cell to `target`, or `UNREACHABLE`; no piece passes through a den. */
function distancesTo(target: number, cls: number): Uint8Array {
  const dist = new Uint8Array(CELLS).fill(UNREACHABLE);
  dist[target] = 0;
  const queue = [target];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    const next: number[] = [];
    for (let index = 0; index < STEP_COUNT[at]; index++) next.push(STEP[at * 4 + index]);
    if (cls === 2) for (let jump = 0; jump < JUMP_COUNT[at]; jump++) next.push(JUMP_LAND[at * 4 + jump]);
    // A jump is symmetrical, so the cells that land on `at` are the cells `at` lands on.
    for (const cell of next) {
      if (dist[cell] !== UNREACHABLE || cell === DEN[0] || cell === DEN[1]) continue;
      if (WATER[cell] === 1 && cls !== 1) continue;
      dist[cell] = dist[at] + 1;
      queue.push(cell);
    }
  }
  return dist;
}

/** [side][class][cell]: moves for a piece of `side` to reach the enemy den. */
const TO_ENEMY_DEN: readonly (readonly Uint8Array[])[] = [0, 1].map((side) => [0, 1, 2].map((cls) =>
  distancesTo(DEN[1 - side], cls)));

/**
 * Per gate of either den (index 0-2 for side 0's den, 3-5 for side 1's): moves for an attacker to step onto it,
 * and moves for a defender to stand next to it, where it captures whatever lands there.
 */
const GATES: readonly number[] = [...DEN_GATES[0], ...DEN_GATES[1]];
const TO_GATE: readonly (readonly Uint8Array[])[] = [0, 1, 2].map((cls) => GATES.map((gate) => distancesTo(gate, cls)));
const NEXT_TO_GATE: readonly (readonly Uint8Array[])[] = [0, 1, 2].map((cls) => GATES.map((gate) => {
  const result = new Uint8Array(CELLS).fill(UNREACHABLE);
  for (let index = 0; index < STEP_COUNT[gate]; index++) {
    const neighbour = STEP[gate * 4 + index];
    if (neighbour === DEN[0] || neighbour === DEN[1]) continue;
    const dist = distancesTo(neighbour, cls);
    for (let cell = 0; cell < CELLS; cell++) result[cell] = Math.min(result[cell], dist[cell]);
  }
  return result;
}));

const manhattan = (a: number, b: number): number =>
  Math.abs((a % JG_COLS) - (b % JG_COLS)) + Math.abs(Math.floor(a / JG_COLS) - Math.floor(b / JG_COLS));

/** Longest distance that still earns advance. */
const ADVANCE_RANGE = 16;

/**
 * Worth of `me`'s position by itself: material and advance, the rat-elephant relation, and how each trap next to
 * the enemy den fares in a race against the enemy's defenders. `toMove` says whose turn it is.
 */
function sideScore(board: Board, me: number, w: Float64Array, toMove: number, scarcity: number): number {
  const { loc } = board;
  const enemy = 1 - me;
  const myBase = me * 8;
  const enemyBase = enemy * 8;
  let total = 0;
  const enemyRat = loc[enemyBase + JG_RAT];
  const enemyElephant = loc[enemyBase + JG_ELEPHANT];
  const advanceScale = 1 + (w[W.ENDGAME] * scarcity) / 100;
  for (let rank = 1; rank <= 8; rank++) {
    const cell = loc[myBase + rank];
    if (cell < 0) continue;
    const trapped = TRAP_OWNER[cell] === enemy;
    let value = w[W.MATERIAL + rank - 1];
    if (rank === JG_RAT && enemyElephant >= 0 && !trapped) value += w[W.RAT_HUNT];
    if (rank === JG_ELEPHANT && enemyRat >= 0) {
      value -= w[W.ELEPHANT_FEAR];
      const gap = manhattan(cell, enemyRat);
      if (gap < 4) value -= w[W.ELEPHANT_NEAR] * (4 - gap);
    }
    if (trapped) value = (value * w[W.TRAPPED]) / 100;
    const steps = TO_ENEMY_DEN[me][CLASS_OF[rank]][cell];
    if (steps < ADVANCE_RANGE) value += w[W.ADVANCE + rank - 1] * (ADVANCE_RANGE - steps) * advanceScale;
    total += value;
  }

  // Den race: the first mover to a trap gate wins unless an enemy piece stands next to it by then.
  const attackerFirst = toMove === me ? 1 : 0;
  let bestRace = 0;
  let covered = 0;
  for (let index = 0; index < 3; index++) {
    // Gates of the enemy den come after the three of the own den.
    const gate = enemy * 3 + index;
    let attack = UNREACHABLE;
    let defend = UNREACHABLE;
    for (let rank = 1; rank <= 8; rank++) {
      const mine = loc[myBase + rank];
      if (mine >= 0) attack = Math.min(attack, TO_GATE[CLASS_OF[rank]][gate][mine]);
      const theirs = loc[enemyBase + rank];
      if (theirs >= 0) defend = Math.min(defend, NEXT_TO_GATE[CLASS_OF[rank]][gate][theirs]);
    }
    if (attack < UNREACHABLE && defend > attack - attackerFirst) {
      if (attack >= 1 && attack <= 6) bestRace = Math.max(bestRace, w[W.RACE + attack - 1]);
    }
    // The own den's gates: how well the enemy's attackers are met.
    const ownGate = me * 3 + index;
    let threat = UNREACHABLE;
    let guard = UNREACHABLE;
    for (let rank = 1; rank <= 8; rank++) {
      const theirs = loc[enemyBase + rank];
      if (theirs >= 0) threat = Math.min(threat, TO_GATE[CLASS_OF[rank]][ownGate][theirs]);
      const mine = loc[myBase + rank];
      if (mine >= 0) guard = Math.min(guard, NEXT_TO_GATE[CLASS_OF[rank]][ownGate][mine]);
    }
    if (guard <= threat - (toMove === enemy ? 1 : 0)) covered++;
  }
  return total + bestRace + covered * w[W.COVER];
}

/**
 * Evaluation for `side` to move: its position minus the other's, plus a tempo. `mobility` is the side's move count
 * minus the opponent's (0 when the weight is off), `hash` seeds the tie-breaking jitter.
 */
export function evaluate(board: Board, side: number, w: Float64Array, quiet: number, hash: number, mobility: number): number {
  let pieces = 0;
  for (let piece = 1; piece <= 16; piece++) if (board.loc[piece] >= 0) pieces++;
  const scarcity = 16 - pieces;
  let score = sideScore(board, side, w, side, scarcity) - sideScore(board, 1 - side, w, side, scarcity) + w[W.TEMPO];
  score += w[W.MOBILITY] * mobility;
  if (quiet > w[W.FADE_FROM]) score *= Math.max(0, (100 - quiet) / (100 - w[W.FADE_FROM]));
  const noise = w[W.NOISE];
  if (noise !== 0) score += ((hash & 15) - 7.5) * noise / 7.5;
  return score;
}
