// Generates double-dummy trick counts for random Bridge deals, one JSON line per deal, to calibrate the bots'
// trick estimator (see fit.ts). Usage: tsx scripts/bridge-trick-model/generate.ts <deals> <seed> > out.jsonl
import { createSolver, isSolverAborted, NO_TRUMP, solveTricks } from '../../server/src/bots/bridge-solver';

/** A deal whose solve takes longer than this is skipped; such outliers would only slow the batch. */
const SOLVE_LIMIT_MS = 20_000;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deal(random: () => number): Int32Array {
  const cards = Array.from({ length: 52 }, (_, index) => index);
  for (let index = 51; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
  const hands = new Int32Array(16);
  cards.forEach((card, index) => { hands[Math.floor(index / 13) * 4 + Math.floor(card / 13)] |= 1 << (card % 13); });
  return hands;
}

const bits = (mask: number): number => { let count = 0; for (let rest = mask; rest; rest &= rest - 1) count++; return count; };
const points = (hands: Int32Array, seat: number): number => [0, 1, 2, 3].reduce((sum, suit) => {
  const mask = hands[seat * 4 + suit];
  return sum + ((mask >> 12) & 1) * 4 + ((mask >> 11) & 1) * 3 + ((mask >> 10) & 1) * 2 + ((mask >> 9) & 1);
}, 0);

/** The side's natural declarer: more trumps, or more points at no-trump; ties go to the first seat. */
function declarer(hands: Int32Array, side: number, strain: number): number {
  const [first, second] = [side, side + 2];
  if (strain === NO_TRUMP) return points(hands, second) > points(hands, first) ? second : first;
  return bits(hands[second * 4 + strain]) > bits(hands[first * 4 + strain]) ? second : first;
}

const [count, seed] = process.argv.slice(2).map(Number);
if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(seed)) {
  console.error('Usage: generate.ts <deals> <seed>');
  process.exit(1);
}
const random = seededRandom(seed);
for (let index = 0; index < count; index++) {
  const hands = deal(random);
  // tricks[side][strain]: strains 0-3 are clubs to spades, 4 is no-trump.
  const tricks: number[][] = [[], []];
  try {
    for (const side of [0, 1]) {
      for (const strain of [0, 1, 2, 3, NO_TRUMP]) {
        const began = performance.now();
        const solver = createSolver(strain, side, () => performance.now() - began > SOLVE_LIMIT_MS);
        const leader = (declarer(hands, side, strain) + 1) % 4;
        tricks[side].push(solveTricks(solver, { hands, leader, trick: [] }));
      }
    }
  } catch (error) {
    if (!isSolverAborted(error)) throw error;
    continue;
  }
  process.stdout.write(`${JSON.stringify({ hands: [...hands], tricks })}\n`);
}
