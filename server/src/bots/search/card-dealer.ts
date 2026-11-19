// Deals the cards (or tiles) a seat has not seen to the other hands, for determinized search. Hand sizes and
// hard limits (a suit a seat showed out of, a card it cannot hold, cards it is known to hold) are always
// honored. Soft evidence (bids, signals, earlier choices) either picks the best-fitting of a few random deals
// or weights the deal by its likelihood. Generalizes the Bridge deal sampler in bridge-sampling.ts.

/** One hand to fill. */
export interface DealSeat<C> {
  /** Cards the hand must end with, known cards included. */
  readonly size: number;
  /** Cards the seat is known to hold (shown bottom cards, a revealed card); never part of `unseen`. */
  readonly known?: readonly C[];
  /** Hard limit: false for a card this seat cannot hold. Every card is allowed when omitted. */
  readonly accepts?: (card: C) => boolean;
}

export interface DealSpec<C> {
  /** Cards to deal: everything the viewer has not seen, minus every seat's known cards. */
  readonly unseen: readonly C[];
  /** Hands to fill; the free places across them must equal `unseen.length`. */
  readonly seats: readonly DealSeat<C>[];
  /**
   * Soft evidence as a distance: 0 when a complete deal fits, larger the further it strays. The best of
   * `attempts` deals is kept, stopping early at 0.
   */
  readonly misfit?: (hands: readonly (readonly C[])[]) => number;
  /** Soft evidence as a log-likelihood; the kept deal's `weight` is its exponential. */
  readonly logLikelihood?: (hands: readonly (readonly C[])[]) => number;
  /** Complete deals tried per call; defaults to 30 with `misfit`, otherwise 1. */
  readonly attempts?: number;
}

export interface Deal<C> {
  /** Hands in `seats` order, known cards first. */
  readonly hands: C[][];
  /** The kept deal's misfit; 0 without a misfit function. */
  readonly misfit: number;
  /** Importance weight from `logLikelihood`; 1 without one. */
  readonly weight: number;
}

const DEFAULT_MISFIT_ATTEMPTS = 30;
/** Dead-ended deals allowed per requested attempt before the call gives up. */
const RETRIES_PER_ATTEMPT = 4;

/** Which seats may take each card; computed once per call because `accepts` may be costly. */
function eligibility<C>(spec: DealSpec<C>): boolean[][] {
  return spec.unseen.map((card) => spec.seats.map((seat) => seat.accepts?.(card) ?? true));
}

function shuffle(items: number[], random: () => number): void {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
}

/**
 * One random deal honoring sizes and hard limits, or null when it dead-ended. Cards fewer seats can take go
 * first, each to a seat drawn in proportion to its free places (uniform when nothing is limited), and a seat
 * that needs every remaining card it can take receives them, so a tightly limited hand still fills.
 */
function dealOnce<C>(spec: DealSpec<C>, allowed: readonly (readonly boolean[])[], random: () => number): C[][] | null {
  const seatCount = spec.seats.length;
  const room = spec.seats.map((seat) => seat.size - (seat.known?.length ?? 0));
  const supply = new Array<number>(seatCount).fill(0);
  for (const row of allowed) for (let seat = 0; seat < seatCount; seat++) if (row[seat]) supply[seat]++;
  const order = spec.unseen.map((_, index) => index);
  shuffle(order, random);
  const reach = allowed.map((row) => row.filter(Boolean).length);
  // A stable sort keeps the shuffled order among cards equally many seats can take.
  order.sort((a, b) => reach[a] - reach[b]);
  const hands = spec.seats.map((seat) => [...(seat.known ?? [])]);
  for (const card of order) {
    const row = allowed[card];
    let chosen = -1;
    let total = 0;
    for (let seat = 0; seat < seatCount; seat++) {
      if (!row[seat] || room[seat] === 0) continue;
      if (supply[seat] === room[seat]) {
        chosen = seat;
        break;
      }
      total += room[seat];
    }
    if (chosen < 0) {
      if (total === 0) return null;
      let pick = random() * total;
      for (let seat = 0; seat < seatCount && pick >= 0; seat++) {
        if (!row[seat] || room[seat] === 0) continue;
        chosen = seat;
        pick -= room[seat];
      }
    }
    hands[chosen].push(spec.unseen[card]);
    room[chosen]--;
    for (let seat = 0; seat < seatCount; seat++) if (row[seat]) supply[seat]--;
  }
  return hands;
}

/**
 * Deals `spec.unseen` into `spec.seats`. Returns null when no attempt honored the hard limits; throws when the
 * sizes cannot add up. Reads `spec` only.
 */
export function dealUnseen<C>(spec: DealSpec<C>, random: () => number): Deal<C> | null {
  const free = spec.seats.reduce((sum, seat) => sum + seat.size - (seat.known?.length ?? 0), 0);
  if (free !== spec.unseen.length || spec.seats.some((seat) => seat.size < (seat.known?.length ?? 0))) {
    throw new RangeError(`Hand sizes leave ${free} free places for ${spec.unseen.length} unseen cards.`);
  }
  const allowed = eligibility(spec);
  const attempts = Math.max(1, spec.attempts ?? (spec.misfit ? DEFAULT_MISFIT_ATTEMPTS : 1));
  let best: C[][] | null = null;
  let bestMisfit = Infinity;
  let dealt = 0;
  for (let tries = 0; tries < attempts * RETRIES_PER_ATTEMPT && dealt < attempts && bestMisfit > 0; tries++) {
    const hands = dealOnce(spec, allowed, random);
    if (!hands) continue;
    dealt++;
    const misfit = spec.misfit ? spec.misfit(hands) : 0;
    if (misfit < bestMisfit) {
      best = hands;
      bestMisfit = misfit;
    }
  }
  if (!best) return null;
  return { hands: best, misfit: bestMisfit, weight: spec.logLikelihood ? Math.exp(spec.logLikelihood(best)) : 1 };
}
