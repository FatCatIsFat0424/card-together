import { DM_MAX_ROUNDS } from '@shared/rules/dominoes';
import { bitCount, PIP_MASK, TILE_HIGH, TILE_LOW, TILE_PIPS } from './dominoes-knowledge';

// A fast model of one Dominoes round with every hand known, for rollouts and the exact endgame solver.
// Moves are `tile * 4 + side` (0 left, 1 right, 2 the first tile of an empty line). Drawing and passing
// are forced, so they happen inside `play`: the state always rests on a seat that can play, or is over.

export const SIDE_LEFT = 0;
export const SIDE_RIGHT = 1;
export const SIDE_FIRST = 2;

export interface DominoesSim {
  /** Hand masks in seat order */
  readonly hands: Int32Array;
  readonly pips: Int16Array;
  readonly boneyard: Int8Array;
  boneTop: number;
  /** Open numbers; -1 on an empty line */
  left: number;
  right: number;
  turn: number;
  over: boolean;
  /** Seat that scores the round, or -1 for a blocked tie */
  winner: number;
  points: number;
}

/** Match context for the value of a finished round. */
export interface DominoesMatch {
  /** Totals before the round, in seat order */
  readonly scores: readonly number[];
  readonly target: number;
  readonly round: number;
}

/** Value of sharing the top total at the end of the match instead of holding it alone. */
const TIE_VALUE = 0.75;
/** Points a round typically scores; the win-chance estimate counts the distance to the target in rounds. */
const ROUND_POINTS = 24;
/** Softness of the estimate, in rounds of distance. */
const ROUND_SPREAD = 1.1;

export function copyDominoesSim(state: DominoesSim): DominoesSim {
  return { ...state, hands: state.hands.slice(), pips: state.pips.slice() };
}

export function fitMask(state: DominoesSim): number {
  return state.left < 0 ? -1 : PIP_MASK[state.left] | PIP_MASK[state.right];
}

function anyCanPlay(state: DominoesSim): boolean {
  const fit = fitMask(state);
  for (let seat = 0; seat < state.hands.length; seat++) if ((state.hands[seat] & fit) !== 0) return true;
  return false;
}

function settle(state: DominoesSim, out: number): void {
  state.over = true;
  let total = 0;
  for (let seat = 0; seat < state.pips.length; seat++) total += state.pips[seat];
  if (out >= 0) {
    state.winner = out;
    state.points = total;
    return;
  }
  let lowest = Infinity;
  let holders = 0;
  let holder = -1;
  for (let seat = 0; seat < state.pips.length; seat++) {
    if (state.pips[seat] < lowest) {
      lowest = state.pips[seat];
      holders = 1;
      holder = seat;
    } else if (state.pips[seat] === lowest) holders++;
  }
  state.winner = holders === 1 ? holder : -1;
  state.points = holders === 1 ? total - lowest : 0;
}

/** Draws and passes until a seat can play, or the round blocks. */
function resolveForced(state: DominoesSim): void {
  const seatCount = state.hands.length;
  const fit = fitMask(state);
  for (let passes = 0; passes <= seatCount; passes++) {
    const seat = state.turn;
    if ((state.hands[seat] & fit) !== 0) return;
    while (state.boneTop < state.boneyard.length) {
      const tile = state.boneyard[state.boneTop++];
      state.hands[seat] |= 1 << tile;
      state.pips[seat] += TILE_PIPS[tile];
      if ((state.hands[seat] & fit) !== 0) return;
      if (state.boneTop === state.boneyard.length && !anyCanPlay(state)) {
        settle(state, -1);
        return;
      }
    }
    state.turn = (seat + 1) % seatCount;
  }
  settle(state, -1);
}

/** Applies a legal move for the seat on turn, then any forced draws and passes. */
export function playDominoes(state: DominoesSim, move: number): void {
  const tile = move >> 2;
  const side = move & 3;
  const seat = state.turn;
  state.hands[seat] &= ~(1 << tile);
  state.pips[seat] -= TILE_PIPS[tile];
  const low = TILE_LOW[tile];
  const high = TILE_HIGH[tile];
  if (side === SIDE_FIRST) {
    state.left = low;
    state.right = high;
  } else if (side === SIDE_LEFT) state.left = state.left === low ? high : low;
  else state.right = state.right === low ? high : low;
  if (state.hands[seat] === 0) {
    settle(state, seat);
    return;
  }
  if (state.boneTop === state.boneyard.length && !anyCanPlay(state)) {
    settle(state, -1);
    return;
  }
  state.turn = (seat + 1) % state.hands.length;
  resolveForced(state);
}

/** Legal moves of the seat on turn; a tile fitting two equal ends is offered once, on the right. */
export function dominoesMoves(state: DominoesSim, out: number[] = []): number[] {
  out.length = 0;
  const hand = state.hands[state.turn];
  if (state.left < 0) {
    for (let rest = hand; rest !== 0; rest &= rest - 1) out.push((31 - Math.clz32(rest & -rest)) * 4 + SIDE_FIRST);
    return out;
  }
  const leftFit = PIP_MASK[state.left];
  const rightFit = PIP_MASK[state.right];
  for (let rest = hand & (leftFit | rightFit); rest !== 0; rest &= rest - 1) {
    const tile = 31 - Math.clz32(rest & -rest);
    const bit = 1 << tile;
    if ((rightFit & bit) !== 0) out.push(tile * 4 + SIDE_RIGHT);
    if ((leftFit & bit) !== 0 && state.left !== state.right) out.push(tile * 4 + SIDE_LEFT);
  }
  return out;
}

const scratch: number[] = [];

/**
 * Quick play for rollouts: shed pips and doubles, keep tiles that still fit the new ends, with a little noise
 * so rollouts differ.
 */
export function dominoesRolloutMove(state: DominoesSim, random: () => number): number {
  const moves = dominoesMoves(state, scratch);
  const hand = state.hands[state.turn];
  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const tile = move >> 2;
    const side = move & 3;
    const low = TILE_LOW[tile];
    const high = TILE_HIGH[tile];
    let left = state.left;
    let right = state.right;
    if (side === SIDE_FIRST) {
      left = low;
      right = high;
    } else if (side === SIDE_LEFT) left = left === low ? high : low;
    else right = right === low ? high : low;
    const rest = hand & ~(1 << tile);
    const score = TILE_PIPS[tile] + (low === high ? 3 : 0) + 1.5 * bitCount(rest & (PIP_MASK[left] | PIP_MASK[right]))
      + random() * 2;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

/** The round's totals once it is scored. */
function totalsAfter(state: DominoesSim, match: DominoesMatch): number[] {
  return match.scores.map((score, seat) => score + (seat === state.winner ? state.points : 0));
}

/**
 * Each seat's chance of winning the match after this round. A round that ends the match (a total reaches the
 * target, or the round cap) is scored exactly; otherwise the distance to the target in typical rounds goes
 * through a softmax. An unfinished round is scored as if the seat with the fewest pips took it.
 */
export function dominoesValues(state: DominoesSim, match: DominoesMatch): Float64Array {
  const seatCount = state.hands.length;
  let finished = state;
  if (!state.over) {
    finished = copyDominoesSim(state);
    settle(finished, -1);
  }
  const totals = totalsAfter(finished, match);
  const values = new Float64Array(seatCount);
  const best = Math.max(...totals);
  if (match.round >= DM_MAX_ROUNDS || best >= match.target) {
    const leaders = totals.filter((total) => total === best).length;
    totals.forEach((total, seat) => {
      values[seat] = total < best ? 0 : leaders === 1 ? 1 : TIE_VALUE;
    });
    return values;
  }
  let sum = 0;
  totals.forEach((total, seat) => {
    values[seat] = Math.exp(-(match.target - total) / (ROUND_POINTS * ROUND_SPREAD));
    sum += values[seat];
  });
  for (let seat = 0; seat < seatCount; seat++) values[seat] /= sum;
  return values;
}

/** Hands' tiles at most for the exact solver to be tried. */
export const EXACT_TILES = 14;

/**
 * Solves the rest of the round exactly (each seat maximizing its own value) once the boneyard is empty.
 * Returns the values per seat, or null when the position is outside the solver's reach or `maxNodes` ran out.
 */
export function solveDominoes(state: DominoesSim, match: DominoesMatch, maxNodes: number): Float64Array | null {
  if (state.over) return dominoesValues(state, match);
  if (state.boneTop < state.boneyard.length) return null;
  let tiles = 0;
  for (const hand of state.hands) tiles += bitCount(hand);
  if (tiles > EXACT_TILES) return null;
  const cache = new Map<string, Float64Array>();
  let nodes = 0;
  const search = (node: DominoesSim): Float64Array | null => {
    if (node.over) return dominoesValues(node, match);
    const key = `${node.hands.join(',')}|${node.left}|${node.right}|${node.turn}`;
    const cached = cache.get(key);
    if (cached) return cached;
    if (++nodes > maxNodes) return null;
    const mover = node.turn;
    let best: Float64Array | null = null;
    for (const move of dominoesMoves(node, [])) {
      const child = copyDominoesSim(node);
      playDominoes(child, move);
      const values = search(child);
      if (!values) return null;
      if (!best || values[mover] > best[mover]) best = values;
    }
    if (!best) return null;
    cache.set(key, best);
    return best;
  };
  return search(state);
}
