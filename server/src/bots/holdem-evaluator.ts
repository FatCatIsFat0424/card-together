import type { Card } from '@shared/types';

// Integer-coded hand evaluation for Monte Carlo loops. Scores compare exactly like `heBestHand` results
// (category first, then ranks), but avoid allocating card objects and five-card subsets.

const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'] as const;
const CATEGORY_SCALE = 15 ** 5;

/** Card id in 0..51: `(rank - 2) * 4 + suit`. */
export function cardId(card: Card): number {
  return (card.rank - 2) * 4 + SUITS.indexOf(card.suit);
}

export const rankOfId = (id: number): number => (id >> 2) + 2;
export const suitOfId = (id: number): number => id & 3;

/** Highest card of a straight in a 15-bit rank mask (bit n = rank n), or 0. Ace also plays low. */
function straightHigh(mask: number): number {
  const withLowAce = (mask & (1 << 14)) === 0 ? mask : mask | 2;
  for (let high = 14; high >= 5; high--) {
    if (((withLowAce >> (high - 4)) & 31) === 31) return high;
  }
  return 0;
}

function pack(category: number, ranks: readonly number[]): number {
  let value = 0;
  for (let i = 0; i < 5; i++) value = value * 15 + (ranks[i] ?? 0);
  return category * CATEGORY_SCALE + value;
}

/** Category 0 (high card) to 8 (straight flush) of a score from `evaluateIds`. */
export const scoreCategory = (score: number): number => Math.floor(score / CATEGORY_SCALE);

/** Best five-card score among 5 to 7 card ids; higher is better and equal scores tie. */
export function evaluateIds(ids: ArrayLike<number>, count: number): number {
  const rankCount = new Array<number>(15).fill(0);
  const suitCount = [0, 0, 0, 0];
  const suitMask = [0, 0, 0, 0];
  let rankMask = 0;
  for (let i = 0; i < count; i++) {
    const rank = rankOfId(ids[i]);
    const suit = suitOfId(ids[i]);
    rankCount[rank] += 1;
    suitCount[suit] += 1;
    suitMask[suit] |= 1 << rank;
    rankMask |= 1 << rank;
  }
  const flushSuit = suitCount.findIndex((total) => total >= 5);
  if (flushSuit >= 0) {
    const high = straightHigh(suitMask[flushSuit]);
    if (high > 0) return pack(8, [high]);
  }
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let rank = 14; rank >= 2; rank--) {
    const total = rankCount[rank];
    if (total === 4) quads.push(rank);
    else if (total === 3) trips.push(rank);
    else if (total === 2) pairs.push(rank);
    else if (total === 1) singles.push(rank);
  }
  const rest = (excluded: readonly number[], take: number): number[] => {
    const kickers: number[] = [];
    for (let rank = 14; rank >= 2 && kickers.length < take; rank--) {
      if (rankCount[rank] > 0 && !excluded.includes(rank)) kickers.push(rank);
    }
    return kickers;
  };
  if (quads.length > 0) return pack(7, [quads[0], ...rest([quads[0]], 1)]);
  if (trips.length > 0 && (trips.length > 1 || pairs.length > 0)) {
    return pack(6, [trips[0], trips.length > 1 ? trips[1] : pairs[0]]);
  }
  if (flushSuit >= 0) {
    const top: number[] = [];
    for (let rank = 14; rank >= 2 && top.length < 5; rank--) if ((suitMask[flushSuit] >> rank) & 1) top.push(rank);
    return pack(5, top);
  }
  const straight = straightHigh(rankMask);
  if (straight > 0) return pack(4, [straight]);
  if (trips.length > 0) return pack(3, [trips[0], ...rest([trips[0]], 2)]);
  if (pairs.length >= 2) return pack(2, [pairs[0], pairs[1], ...rest([pairs[0], pairs[1]], 1)]);
  if (pairs.length === 1) return pack(1, [pairs[0], ...rest([pairs[0]], 3)]);
  return pack(0, singles.slice(0, 5));
}
