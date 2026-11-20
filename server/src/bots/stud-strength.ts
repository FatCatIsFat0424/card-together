import { evaluateIds } from './holdem-evaluator';
import { seededRandom } from './search/seeded-random';

// Hand strength for the stud model: the chance that a hand of `count` known cards, completed at random to five,
// beats a random five-card hand. It stands for what a player sees in its own cards when it chooses a bet, so it
// ignores the cards on the table and never reads a card that is still to come.

const TABLE_SIZE = 40_000;
const CACHE_LIMIT = 250_000;
/** Random completions sampled per hand size; four cards are completed exactly. */
const COMPLETIONS: Readonly<Record<number, number>> = { 2: 80, 3: 30 };

let finals: Float64Array | null = null;
const cache = new Map<number, number>();

/** Scores of random five-card hands, sorted; built once with a fixed seed. */
function finalScores(): Float64Array {
  if (finals) return finals;
  const random = seededRandom(0x57ad);
  const deck = Int8Array.from({ length: 52 }, (_, id) => id);
  const hand = new Int8Array(5);
  const scores = new Float64Array(TABLE_SIZE);
  for (let run = 0; run < TABLE_SIZE; run++) {
    for (let index = 0; index < 5; index++) {
      const pick = index + Math.floor(random() * (52 - index));
      const held = deck[index];
      deck[index] = deck[pick];
      deck[pick] = held;
      hand[index] = deck[index];
    }
    scores[run] = evaluateIds(hand, 5);
  }
  scores.sort();
  finals = scores;
  return scores;
}

/** Share of random five-card hands that a final hand beats, counting ties as half. */
export function finalStrength(score: number): number {
  const table = finalScores();
  let low = 0;
  let high = table.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (table[middle] < score) low = middle + 1;
    else high = middle;
  }
  const below = low;
  high = table.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (table[middle] <= score) low = middle + 1;
    else high = middle;
  }
  return (below + low) / 2 / table.length;
}

/**
 * Strength of a hand from its first `count` card ids (2 to 5), the same for every ordering. Hands short of
 * five cards average over completions drawn from a generator seeded by the hand itself, so the value is
 * repeatable and can be cached.
 */
export function studStrength(ids: ArrayLike<number>, count: number): number {
  const hand = new Int8Array(5);
  let key = 0;
  for (let index = 0; index < count; index++) {
    hand[index] = ids[index];
    key += 2 ** ids[index];
  }
  if (count >= 5) return finalStrength(evaluateIds(hand, 5));
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const held = new Uint8Array(52);
  for (let index = 0; index < count; index++) held[hand[index]] = 1;
  let total = 0;
  if (count === 4) {
    let runs = 0;
    for (let id = 0; id < 52; id++) {
      if (held[id]) continue;
      hand[4] = id;
      total += finalStrength(evaluateIds(hand, 5));
      runs += 1;
    }
    total /= runs;
  } else {
    const random = seededRandom(key % 4_294_967_291);
    const free = Int8Array.from({ length: 52 - count }, () => 0);
    let length = 0;
    for (let id = 0; id < 52; id++) if (!held[id]) free[length++] = id;
    const runs = COMPLETIONS[count] ?? 30;
    for (let run = 0; run < runs; run++) {
      for (let slot = count; slot < 5; slot++) {
        const pick = slot - count + Math.floor(random() * (length - (slot - count)));
        const swap = free[slot - count];
        free[slot - count] = free[pick];
        free[pick] = swap;
        hand[slot] = free[slot - count];
      }
      total += finalStrength(evaluateIds(hand, 5));
    }
    total /= runs;
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, total);
  return total;
}
