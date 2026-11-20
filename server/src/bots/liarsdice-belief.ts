import type { DiceFace, GameSeat, LiarsDiceVisibleState } from '@shared/types';
import { LDI_FACES, LDI_WILD_FACE } from '@shared/rules/liarsdice';

// Belief over the dice in the other cups. A cup of `size` dice is one of a few hundred face-count vectors, so
// each seat's posterior is enumerated exactly instead of sampled with importance weights. Seats are independent
// a priori and a bid depends only on its bidder's own cup, so the posterior factorizes by seat.
// - Prior: every die is uniform.
// - Evidence: a bid names the face a seat is likely to hold. The chance of naming face `f` is a softmax over
//   the faces on how many dice the bidder holds that count as `f` at that point of the round; its sharpness is
//   estimated from the bids of the rounds already lifted this game (table-wide, never per player).

/** Face-count vector of one cup; index 0 is unused. */
export type FaceCounts = Int8Array;

/** One bid of the current round with the wild state it was made under. */
export interface RoundBid {
  readonly seat: GameSeat;
  readonly quantity: number;
  readonly face: DiceFace;
  /** Ones were still wild when the bid was made */
  readonly wild: boolean;
}

/** A finished round that ended in a challenge, with every cup revealed. */
export interface LiftedRound {
  readonly bids: readonly RoundBid[];
  readonly dice: Readonly<Partial<Record<GameSeat, readonly DiceFace[]>>>;
}

export interface DiceHistory {
  /** Bids of the round in progress, oldest first */
  readonly current: readonly RoundBid[];
  readonly lifted: readonly LiftedRound[];
}

/** Prior sharpness of a bidder's face choice, before this game shows anything. */
export const PRIOR_SHARPNESS = 1;
/** Candidate sharpness values the table's bids are fitted against. */
const SHARPNESS_GRID: readonly number[] = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
/** Standard deviation of the prior over sharpness; wide enough that a few lifted rounds move it. */
const PRIOR_SPREAD = 0.6;

/** Splits the visible log into the round in progress and the rounds a challenge lifted. */
export function diceHistory(visible: LiarsDiceVisibleState): DiceHistory {
  const lifted: LiftedRound[] = [];
  let current: RoundBid[] = [];
  let wild = true;
  for (const entry of visible.log) {
    if (entry.type === 'round') {
      current = [];
      wild = true;
    } else if (entry.type === 'bid') {
      current.push({ seat: entry.seat, quantity: entry.quantity, face: entry.face, wild });
      if (entry.face === LDI_WILD_FACE) wild = false;
    } else {
      lifted.push({ bids: current, dice: entry.dice });
      current = [];
    }
  }
  return { current, lifted };
}

const vectorCache = new Map<number, { readonly counts: readonly FaceCounts[]; readonly prior: readonly number[] }>();

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

/** Every face-count vector of a cup with `size` dice and its multinomial prior probability. */
function cupVectors(size: number): { readonly counts: readonly FaceCounts[]; readonly prior: readonly number[] } {
  const cached = vectorCache.get(size);
  if (cached) return cached;
  const counts: FaceCounts[] = [];
  const prior: number[] = [];
  const current = new Int8Array(LDI_FACES + 1);
  const fill = (face: number, left: number): void => {
    if (face === LDI_FACES) {
      current[face] = left;
      counts.push(current.slice());
      let ways = factorial(size);
      for (let f = 1; f <= LDI_FACES; f++) ways /= factorial(current[f]);
      prior.push(ways / LDI_FACES ** size);
      return;
    }
    for (let amount = 0; amount <= left; amount++) {
      current[face] = amount;
      fill(face + 1, left - amount);
    }
  };
  fill(1, size);
  const built = { counts, prior };
  vectorCache.set(size, built);
  return built;
}

/** Dice of a cup that count toward `face` while the wild state is `wild`. */
function matches(cup: FaceCounts, face: number, wild: boolean): number {
  return cup[face] + (wild && face !== LDI_WILD_FACE ? cup[LDI_WILD_FACE] : 0);
}

/** Log chance that a bidder with `cup` names `face` under the softmax of the given sharpness. */
function nameLogChance(cup: FaceCounts, face: number, wild: boolean, sharpness: number): number {
  let normalizer = 0;
  for (let f = 1; f <= LDI_FACES; f++) normalizer += Math.exp(sharpness * matches(cup, f, wild));
  return sharpness * matches(cup, face, wild) - Math.log(normalizer);
}

function faceCounts(dice: readonly DiceFace[]): FaceCounts {
  const counts = new Int8Array(LDI_FACES + 1);
  for (const die of dice) counts[die]++;
  return counts;
}

/**
 * Posterior mean of the bidding sharpness given the bids of every lifted round except `mySeat`'s own. The
 * prior keeps a table without history at `PRIOR_SHARPNESS`.
 */
export function estimateSharpness(history: DiceHistory, mySeat: GameSeat): number {
  const observed: { cup: FaceCounts; face: number; wild: boolean }[] = [];
  for (const round of history.lifted) {
    for (const bid of round.bids) {
      const dice = round.dice[bid.seat];
      if (bid.seat !== mySeat && dice && dice.length > 0) observed.push({ cup: faceCounts(dice), face: bid.face, wild: bid.wild });
    }
  }
  if (observed.length === 0) return PRIOR_SHARPNESS;
  let total = 0;
  let weighted = 0;
  const logPosterior = SHARPNESS_GRID.map((sharpness) => {
    let logChance = -((sharpness - PRIOR_SHARPNESS) ** 2) / (2 * PRIOR_SPREAD ** 2);
    for (const item of observed) logChance += nameLogChance(item.cup, item.face, item.wild, sharpness);
    return logChance;
  });
  const peak = Math.max(...logPosterior);
  SHARPNESS_GRID.forEach((sharpness, index) => {
    const mass = Math.exp(logPosterior[index] - peak);
    total += mass;
    weighted += mass * sharpness;
  });
  return weighted / total;
}

/** A seat's cup distribution: sampling picks a face-count vector. */
export interface CupPosterior {
  readonly size: number;
  readonly counts: readonly FaceCounts[];
  /** Cumulative probability of each vector, ending at 1 */
  readonly cumulative: readonly number[];
}

/** The seat's cup distribution given the bids it made this round. */
export function cupPosterior(size: number, bids: readonly RoundBid[], sharpness: number): CupPosterior {
  const { counts, prior } = cupVectors(size);
  const mass = counts.map((cup, index) => {
    let logChance = 0;
    for (const bid of bids) logChance += nameLogChance(cup, bid.face, bid.wild, sharpness);
    return prior[index] * Math.exp(logChance);
  });
  const total = mass.reduce((sum, value) => sum + value, 0);
  const cumulative: number[] = [];
  let running = 0;
  for (const value of mass) {
    running += value / total;
    cumulative.push(running);
  }
  return { size, counts, cumulative };
}

/** Draws one face-count vector from a cup's posterior. */
export function sampleCup(posterior: CupPosterior, random: () => number): FaceCounts {
  const ticket = random();
  const { cumulative } = posterior;
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cumulative[middle] < ticket) low = middle + 1;
    else high = middle;
  }
  return posterior.counts[low];
}
