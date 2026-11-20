import type { DealEnd } from './doudizhu-world';

// What a deal is worth in match terms. A match is six deals and only the highest total wins (ties win), so
// the bot values a deal's points by the chance they leave it on top at the end. The deals still to come are
// simulated from a simple model (a random landlord who wins somewhat less than half the time, at a typical
// stake), shared by every outcome scored in one decision so their values compare directly.

/** Simulated futures per decision. */
const FUTURES = 1500;
/** How often a landlord wins a deal. */
const LANDLORD_WINS = 0.45;
/** Typical stakes (base times doublings) of a deal and their frequencies. */
const STAKES: readonly (readonly [number, number])[] = [[1, 0.2], [2, 0.3], [3, 0.2], [4, 0.15], [6, 0.08], [8, 0.04], [12, 0.03]];
/** Value of a point beyond its effect on winning, so a settled match still plays for points. */
export const POINT_WEIGHT = 0.002;

function stake(random: () => number): number {
  let ticket = random();
  for (const [value, share] of STAKES) {
    ticket -= share;
    if (ticket < 0) return value;
  }
  return STAKES[STAKES.length - 1][0];
}

/** Score changes per seat over the `remaining` deals of one simulated future. */
function future(seats: number, remaining: number, random: () => number): number[] {
  const scores = new Array<number>(seats).fill(0);
  for (let deal = 0; deal < remaining; deal++) {
    const landlord = Math.floor(random() * seats);
    const sign = random() < LANDLORD_WINS ? 1 : -1;
    const amount = stake(random);
    for (let seat = 0; seat < seats; seat++) scores[seat] += (seat === landlord ? 2 : -1) * sign * amount;
  }
  return scores;
}

/** Values a deal's score changes (per seat) for seat `me`. */
export type MatchValue = (scores: readonly number[]) => number;

/**
 * The chance that seat `me` ends the match on top after a deal that changes the totals by `scores`, plus
 * POINT_WEIGHT per point. `remaining` deals follow this one.
 */
export function matchValue(totals: readonly number[], me: number, remaining: number, random: () => number): MatchValue {
  const futures = remaining === 0 ? [totals.map(() => 0)]
    : Array.from({ length: FUTURES }, () => future(totals.length, remaining, random));
  const cache = new Map<string, number>();
  return (scores) => {
    const key = scores.join();
    const known = cache.get(key);
    if (known !== undefined) return known;
    let wins = 0;
    for (const extra of futures) {
      const mine = totals[me] + scores[me] + extra[me];
      let top = true;
      for (let seat = 0; seat < totals.length && top; seat++) {
        if (seat !== me && totals[seat] + scores[seat] + extra[seat] > mine) top = false;
      }
      if (top) wins += 1;
    }
    const value = wins / futures.length + POINT_WEIGHT * scores[me];
    cache.set(key, value);
    return value;
  };
}

/** Scores a finished deal through `value`, for a landlord at `landlord`, a bid `base`, and `grabs`. */
export function dealValue(value: MatchValue, seats: number, landlord: number, base: number, grabs: number): (end: DealEnd) => number {
  const cache = new Map<number, number>();
  return (end) => {
    const key = end.doublings * 2 + Number(end.landlordWins);
    const known = cache.get(key);
    if (known !== undefined) return known;
    const amount = Math.max(1, base) * 2 ** (grabs + end.doublings);
    const scores = Array.from({ length: seats }, (_, seat) => (seat === landlord ? 2 : -1) * (end.landlordWins ? 1 : -1) * amount);
    const result = value(scores);
    cache.set(key, result);
    return result;
  };
}
