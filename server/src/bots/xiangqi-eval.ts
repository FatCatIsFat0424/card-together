// ─── Xiangqi evaluation: tapered terms over a tunable weight vector ───
//
// Like the chess evaluation, every term is a count times one (middlegame, endgame) weight pair, so the score is
// linear in the weights and `scripts/board-bot-tuning` fits them by logistic regression on self-play results. The
// same function fills a trace of the counts for the tuner.

import type { XqBoardState } from './xiangqi-engine';
import * as xiangqiEngine from './xiangqi-engine';
import { XIANGQI_TUNED_WEIGHTS } from './xiangqi-eval-weights';

// Imported bindings are read once into module constants: under the CommonJS loader every use of an imported
// binding is a getter call, which costs measurably in the search's inner loops.
const {
  ADVISOR_STEPS, ELEPHANT_STEPS, GENERAL_STEPS, HORSE_STEPS, RAY, RAY_LENGTH, SOLDIER_STEPS, XQ_ADVISOR, XQ_CANNON,
  XQ_CHARIOT, XQ_ELEPHANT, XQ_GENERAL, XQ_HORSE, XQ_SOLDIER,
} = xiangqiEngine;

// ─── Weight layout ───

let parameters = 0;
const block = (size: number): number => {
  const start = parameters;
  parameters += size;
  return start;
};

/** By kind − 1 (general to soldier); the general's stays 0. */
const P_MATERIAL = block(7);
/** By kind on 50 points: own row (0 = own back rank) × file folded onto the left half. */
const P_PST = block(7 * 50);
const P_MOBILITY_CHARIOT = block(18);
const P_MOBILITY_HORSE = block(9);
const P_MOBILITY_CANNON = block(18);
/** Missing defenders times enemy attackers: advisors × chariots, advisors × horses, elephants × cannons, elephants × chariots. */
const P_ADVISOR_GAP_CHARIOT = block(1);
const P_ADVISOR_GAP_HORSE = block(1);
const P_ELEPHANT_GAP_CANNON = block(1);
const P_ELEPHANT_GAP_CHARIOT = block(1);
/** Attack on the enemy palace by its weight (0–29). */
const P_PALACE_ATTACK = block(30);
/** Cannon facing the enemy general with nothing between (空頭炮), or with exactly one screen. */
const P_CANNON_EMPTY_HEAD = block(1);
const P_CANNON_SCREEN = block(1);
/** Chariot with no own piece ahead on its file. */
const P_CHARIOT_OPEN = block(1);
const P_FULL_DEFENCE = block(1);
const P_ELEPHANTS_LINKED = block(1);
const P_SOLDIERS_LINKED = block(1);
/** Piece (advisor to soldier, by kind − 2) attacked and undefended; owned by the attacker. */
const P_HANGING = block(6);
/** Piece attacked by a cheaper enemy piece, by kind − 2; owned by the attacker. */
const P_THREAT = block(6);
const P_TEMPO = block(1);

export const XQ_EVAL_PARAMETERS = parameters;
export const XQ_TRACE_PHASE = parameters;
export const XQ_TRACE_SCALE = parameters + 1;
export const XQ_TRACE_EXTRA = parameters + 2;
export const XQ_TRACE_SIZE = parameters + 3;
/** Phase with every chariot, horse, and cannon on the board. */
export const XQ_MAX_PHASE = 20;

// ─── Starting weights ───

const BASE = [0, 0, 200, 200, 400, 900, 450, 100];

/** The original hand-written positional score, `row` counted from the owner's far side (0 = enemy back rank). */
function legacyScore(kind: number, col: number, row: number): number {
  const central = 4 - Math.abs(col - 4);
  switch (kind) {
    case XQ_GENERAL: return row === 9 ? 0 : -12 * (9 - row);
    case XQ_ADVISOR: return 200 + (col === 4 && row === 8 ? 10 : 0);
    case XQ_ELEPHANT: return 200 + (col === 4 && row === 7 ? 10 : 0);
    case XQ_HORSE: {
      const advanced = row <= 4 ? (row === 0 ? 10 : 30) : row === 9 ? -20 : 0;
      return 400 + central * 6 + advanced + (col === 0 || col === 8 ? -20 : 0);
    }
    case XQ_CHARIOT: return 900 + (row <= 4 ? 20 : 0) + (row === 9 ? -10 : 0) + (col === 3 || col === 5 ? 8 : 0);
    case XQ_CANNON: return 450 + (col === 4 ? 20 : 0) + (row === 7 ? 5 : 0);
    case XQ_SOLDIER: {
      if (row >= 5) return 100 + (row === 5 ? 15 : 0) + (col === 4 ? 10 : 0);
      const near = col >= 3 && col <= 5 ? 3 : col === 2 || col === 6 ? 2 : col === 1 || col === 7 ? 1 : 0;
      return row === 0 ? 130 + near * 5 : 180 + (4 - row) * 15 + near * 10;
    }
    default: return 0;
  }
}

export function xiangqiDefaultWeights(): number[] {
  const weights = new Array<number>(XQ_EVAL_PARAMETERS * 2).fill(0);
  const set = (index: number, middle: number, end: number): void => {
    weights[index * 2] = middle;
    weights[index * 2 + 1] = end;
  };
  [[0, 0], [200, 220], [200, 220], [400, 440], [900, 950], [450, 420], [100, 140]]
    .forEach(([middle, end], index) => set(P_MATERIAL + index, middle, end));
  for (let kind = 1; kind <= 7; kind++) {
    for (let rank = 0; rank < 10; rank++) {
      for (let bucket = 0; bucket < 5; bucket++) {
        const value = legacyScore(kind, bucket, 9 - rank) - BASE[kind];
        set(P_PST + (kind - 1) * 50 + rank * 5 + bucket, value, kind === XQ_SOLDIER ? Math.round(value * 1.3) : value);
      }
    }
  }
  for (let count = 0; count < 18; count++) set(P_MOBILITY_CHARIOT + count, (count - 8) * 4, (count - 8) * 4);
  for (let count = 0; count < 9; count++) set(P_MOBILITY_HORSE + count, (count - 4) * 8, (count - 4) * 8);
  for (let count = 0; count < 18; count++) set(P_MOBILITY_CANNON + count, (count - 8) * 2, (count - 8) * 2);
  set(P_ADVISOR_GAP_CHARIOT, -20, -25);
  set(P_ADVISOR_GAP_HORSE, -15, -20);
  set(P_ELEPHANT_GAP_CANNON, -15, -20);
  set(P_ELEPHANT_GAP_CHARIOT, -10, -15);
  for (let units = 0; units < 30; units++) set(P_PALACE_ATTACK + units, Math.round(Math.min(units * units / 2, 400)), Math.round(Math.min(units * units / 3, 300)));
  set(P_CANNON_EMPTY_HEAD, 60, 30);
  set(P_CANNON_SCREEN, 15, 5);
  set(P_CHARIOT_OPEN, 15, 10);
  set(P_FULL_DEFENCE, 10, 30);
  set(P_ELEPHANTS_LINKED, 10, 15);
  set(P_SOLDIERS_LINKED, 10, 20);
  [[5, 5], [5, 5], [20, 20], [40, 40], [25, 25], [10, 10]].forEach(([middle, end], index) => set(P_HANGING + index, middle, end));
  [[20, 20], [20, 20], [40, 40], [60, 60], [40, 40], [10, 10]].forEach(([middle, end], index) => set(P_THREAT + index, middle, end));
  set(P_TEMPO, 20, 10);
  return weights;
}

// ─── Active weights ───

const MIDDLE = new Int32Array(XQ_EVAL_PARAMETERS);
const END = new Int32Array(XQ_EVAL_PARAMETERS);
/** Material plus point value per `(code + 7) * 90 + cell`, red positive. */
const PSQ_MIDDLE = new Int32Array(15 * 90);
const PSQ_END = new Int32Array(15 * 90);

const ownRow = (side: number, cell: number): number => (side === 0 ? 9 - Math.floor(cell / 9) : Math.floor(cell / 9));
function pointIndex(side: number, cell: number): number {
  const col = cell % 9;
  return ownRow(side, cell) * 5 + (col <= 4 ? col : 8 - col);
}

export function xiangqiSetWeights(weights: readonly number[]): void {
  if (weights.length !== XQ_EVAL_PARAMETERS * 2) throw new Error('Xiangqi weight vector has the wrong length');
  for (let index = 0; index < XQ_EVAL_PARAMETERS; index++) {
    MIDDLE[index] = Math.round(weights[index * 2]);
    END[index] = Math.round(weights[index * 2 + 1]);
  }
  for (let code = -7; code <= 7; code++) {
    if (code === 0) continue;
    const kind = code > 0 ? code : -code;
    const sign = code > 0 ? 1 : -1;
    for (let cell = 0; cell < 90; cell++) {
      const entry = P_PST + (kind - 1) * 50 + pointIndex(code > 0 ? 0 : 1, cell);
      PSQ_MIDDLE[(code + 7) * 90 + cell] = sign * (MIDDLE[P_MATERIAL + kind - 1] + MIDDLE[entry]);
      PSQ_END[(code + 7) * 90 + cell] = sign * (END[P_MATERIAL + kind - 1] + END[entry]);
    }
  }
}

export function xiangqiActiveWeights(): number[] {
  return XIANGQI_TUNED_WEIGHTS.length === XQ_EVAL_PARAMETERS * 2 ? [...XIANGQI_TUNED_WEIGHTS] : xiangqiDefaultWeights();
}

// ─── Evaluation ───

const PHASE_WEIGHT = [0, 0, 0, 0, 1, 3, 1, 0];
const ATTACK_WEIGHT = [0, 0, 0, 0, 2, 3, 2, 1];
/** Exchange value for "attacked by a cheaper piece". */
const VALUE = [0, 10_000, 200, 200, 400, 900, 450, 100];

const attackCount = new Uint8Array(180);
/** Cheapest attacker value per side × cell (0 when unattacked). */
const cheapest = new Uint16Array(180);
const palaceUnits = new Int32Array(2);
const palaceAttackers = new Int32Array(2);

let middle = 0;
let end = 0;
let traced: Float64Array | null = null;

function add(index: number, count: number): void {
  middle += MIDDLE[index] * count;
  end += END[index] * count;
  if (traced !== null) traced[index] += count;
}

function mark(side: number, cell: number, value: number): void {
  const slot = side * 90 + cell;
  attackCount[slot]++;
  if (cheapest[slot] === 0 || value < cheapest[slot]) cheapest[slot] = value;
}

/** 1 where `side × 90 + cell` lies in the other side's palace. */
const ENEMY_PALACE: Uint8Array = (() => {
  const table = new Uint8Array(180);
  for (let cell = 0; cell < 90; cell++) {
    const col = cell % 9;
    const row = Math.floor(cell / 9);
    if (col >= 3 && col <= 5 && row <= 2) table[cell] = 1;
    if (col >= 3 && col <= 5 && row >= 7) table[90 + cell] = 1;
  }
  return table;
})();

/** Score for red (positive) with an optional trace of parameter counts, phase, scale, and untuned extra. */
export function xiangqiEvaluateRed(state: XqBoardState, trace: Float64Array | null): number {
  const { cells, counts } = state;
  middle = 0;
  end = 0;
  traced = trace;
  if (trace) trace.fill(0);
  attackCount.fill(0);
  cheapest.fill(0);
  palaceUnits.fill(0);
  palaceAttackers.fill(0);
  let phase = 0;

  for (let cell = 0; cell < 90; cell++) {
    const piece = cells[cell];
    if (piece === 0) continue;
    const side = piece > 0 ? 0 : 1;
    const sign = side === 0 ? 1 : -1;
    const kind = piece > 0 ? piece : -piece;
    phase += PHASE_WEIGHT[kind];
    middle += PSQ_MIDDLE[(piece + 7) * 90 + cell];
    end += PSQ_END[(piece + 7) * 90 + cell];
    if (trace) {
      trace[P_MATERIAL + kind - 1] += sign;
      trace[P_PST + (kind - 1) * 50 + pointIndex(side, cell)] += sign;
    }
    const value = VALUE[kind];
    let mobility = 0;
    let hits = 0;
    if (kind === XQ_CHARIOT || kind === XQ_CANNON) {
      for (let direction = 0; direction < 4; direction++) {
        const base = (cell * 4 + direction) * 10;
        const length = RAY_LENGTH[cell * 4 + direction];
        let step = 0;
        for (; step < length; step++) {
          const to = RAY[base + step];
          const target = cells[to];
          if (kind === XQ_CHARIOT) {
            mark(side, to, value);
            hits += ENEMY_PALACE[side * 90 + to];
            if (target * sign <= 0) mobility++;
          } else if (target === 0) {
            mobility++;
          }
          if (target !== 0) break;
        }
        if (kind !== XQ_CANNON) continue;
        for (step++; step < length; step++) {
          const to = RAY[base + step];
          mark(side, to, value);
          hits += ENEMY_PALACE[side * 90 + to];
          if (cells[to] !== 0) {
            if (cells[to] * sign < 0) mobility++;
            break;
          }
        }
      }
      add((kind === XQ_CHARIOT ? P_MOBILITY_CHARIOT : P_MOBILITY_CANNON) + Math.min(mobility, 17), sign);
    } else {
      const table = kind === XQ_HORSE ? HORSE_STEPS : kind === XQ_SOLDIER ? SOLDIER_STEPS : kind === XQ_ELEPHANT
        ? ELEPHANT_STEPS : kind === XQ_ADVISOR ? ADVISOR_STEPS : GENERAL_STEPS;
      const slot = side * 90 + cell;
      for (let index = slot * 8, last = index + table.count[slot]; index < last; index++) {
        const blocker = table.block[index];
        if (blocker >= 0 && cells[blocker] !== 0) continue;
        const to = table.list[index];
        mark(side, to, value);
        if (cells[to] * sign <= 0) mobility++;
        hits += ENEMY_PALACE[side * 90 + to];
      }
      if (kind === XQ_HORSE) add(P_MOBILITY_HORSE + mobility, sign);
    }
    if (hits > 0 && ATTACK_WEIGHT[kind] > 0) {
      palaceAttackers[side]++;
      palaceUnits[side] += ATTACK_WEIGHT[kind] + hits;
    }
  }
  if (phase > XQ_MAX_PHASE) phase = XQ_MAX_PHASE;

  for (let side = 0; side < 2; side++) {
    const sign = side === 0 ? 1 : -1;
    const own = side === 0 ? 1 : -1;
    const enemy = -own;
    const advisorGap = 2 - counts[own * XQ_ADVISOR + 7];
    const elephantGap = 2 - counts[own * XQ_ELEPHANT + 7];
    if (advisorGap > 0) {
      add(P_ADVISOR_GAP_CHARIOT, sign * advisorGap * counts[enemy * XQ_CHARIOT + 7]);
      add(P_ADVISOR_GAP_HORSE, sign * advisorGap * counts[enemy * XQ_HORSE + 7]);
    }
    if (elephantGap > 0) {
      add(P_ELEPHANT_GAP_CANNON, sign * elephantGap * counts[enemy * XQ_CANNON + 7]);
      add(P_ELEPHANT_GAP_CHARIOT, sign * elephantGap * counts[enemy * XQ_CHARIOT + 7]);
    }
    if (advisorGap === 0 && elephantGap === 0) add(P_FULL_DEFENCE, sign);
    if (palaceAttackers[side] >= 2) add(P_PALACE_ATTACK + Math.min(palaceUnits[side], 29), sign);
  }

  // Cannons and chariots on files, linked elephants and soldiers, threats.
  for (let cell = 0; cell < 90; cell++) {
    const piece = cells[cell];
    if (piece === 0) continue;
    const side = piece > 0 ? 0 : 1;
    const sign = side === 0 ? 1 : -1;
    const kind = piece > 0 ? piece : -piece;
    const col = cell % 9;
    if (kind === XQ_CANNON) {
      const general = state.kings[1 - side];
      if (general % 9 === col) {
        let between = 0;
        const stepSize = general > cell ? 9 : -9;
        for (let at = cell + stepSize; at !== general; at += stepSize) if (cells[at] !== 0) between++;
        if (between === 0) add(P_CANNON_EMPTY_HEAD, sign);
        else if (between === 1) add(P_CANNON_SCREEN, sign);
      }
    } else if (kind === XQ_CHARIOT) {
      let open = true;
      for (let at = cell + (side === 0 ? -9 : 9); at >= 0 && at < 90; at += side === 0 ? -9 : 9) {
        if (cells[at] * sign > 0) {
          open = false;
          break;
        }
      }
      if (open) add(P_CHARIOT_OPEN, sign);
    } else if (kind === XQ_ELEPHANT) {
      const slot = side * 90 + cell;
      for (let index = slot * 8, last = index + ELEPHANT_STEPS.count[slot]; index < last; index++) {
        // Count each linked pair once, from its lower cell.
        const to = ELEPHANT_STEPS.list[index];
        if (to > cell && cells[to] === piece && cells[ELEPHANT_STEPS.block[index]] === 0) add(P_ELEPHANTS_LINKED, sign);
      }
    } else if (kind === XQ_SOLDIER && col < 8 && cells[cell + 1] === piece && ownRow(side, cell) >= 5) {
      add(P_SOLDIERS_LINKED, sign);
    }
    if (kind === XQ_GENERAL) continue;
    const enemySlot = (1 - side) * 90 + cell;
    if (attackCount[enemySlot] === 0) continue;
    // The attacking side owns these terms.
    if (attackCount[side * 90 + cell] === 0) add(P_HANGING + kind - 2, -sign);
    else if (cheapest[enemySlot] < VALUE[kind]) add(P_THREAT + kind - 2, -sign);
  }

  add(P_TEMPO, state.side === 0 ? 1 : -1);

  // A side without pieces that can cross the river (or soldiers still able to advance) cannot win.
  let scale = 128;
  const strong = end >= 0 ? 0 : 1;
  const sign = strong === 0 ? 1 : -1;
  let attackers = counts[sign * XQ_CHARIOT + 7] + counts[sign * XQ_HORSE + 7] + counts[sign * XQ_CANNON + 7];
  if (attackers === 0) {
    for (let cell = 0; cell < 90; cell++) {
      if (cells[cell] === sign * XQ_SOLDIER && ownRow(strong, cell) < 9) attackers++;
    }
    if (attackers === 0) scale = 8;
  }

  if (trace) {
    trace[XQ_TRACE_PHASE] = phase;
    trace[XQ_TRACE_SCALE] = scale;
    trace[XQ_TRACE_EXTRA] = 0;
  }
  traced = null;
  return Math.trunc((middle * phase + end * (XQ_MAX_PHASE - phase) * scale / 128) / XQ_MAX_PHASE);
}

/** Score for the side to move. */
export function xiangqiEvaluate(state: XqBoardState): number {
  const red = xiangqiEvaluateRed(state, null);
  return state.side === 0 ? red : -red;
}

xiangqiSetWeights(xiangqiActiveWeights());
