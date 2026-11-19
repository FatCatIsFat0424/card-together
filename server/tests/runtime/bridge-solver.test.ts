import { describe, expect, it } from 'vitest';
import { createSolver, isSolverAborted, NO_TRUMP, solveTricks } from '../../src/bots/bridge-solver';
import type { TrickCard } from '../../src/bots/bridge-solver';
import { seededRandom } from '../../src/bots/search/seeded-random';

/** Deals `size` cards to each seat as `hands[seat * 4 + suit]` rank masks. */
function deal(size: number, random: () => number): Int32Array {
  const cards = Array.from({ length: 52 }, (_, index) => index);
  for (let index = 51; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
  const hands = new Int32Array(16);
  for (let seat = 0; seat < 4; seat++) {
    for (const card of cards.slice(seat * size, (seat + 1) * size)) hands[seat * 4 + Math.floor(card / 13)] |= 1 << (card % 13);
  }
  return hands;
}

/** Exhaustive minimax: the most tricks N-S can take from here. */
function bruteForce(hands: Int32Array, trump: number, leader: number, trick: readonly TrickCard[]): number {
  if (trick.length === 4) {
    let best = 0;
    for (let index = 1; index < 4; index++) {
      const card = trick[index];
      const top = trick[best];
      if (card.suit === top.suit ? card.rank > top.rank : card.suit === trump) best = index;
    }
    const winner = trick[best].seat;
    return (winner % 2 === 0 ? 1 : 0) + bruteForce(hands, trump, winner, []);
  }
  if (trick.length === 0 && hands.every((mask) => mask === 0)) return 0;
  const seat = (leader + trick.length) % 4;
  const led = trick[0]?.suit;
  const follows = led !== undefined && hands[seat * 4 + led] !== 0;
  let best = seat % 2 === 0 ? -1 : Infinity;
  for (let suit = 0; suit < 4; suit++) {
    if (follows && suit !== led) continue;
    for (let rank = 0; rank < 13; rank++) {
      if ((hands[seat * 4 + suit] & (1 << rank)) === 0) continue;
      hands[seat * 4 + suit] &= ~(1 << rank);
      const value = bruteForce(hands, trump, leader, [...trick, { seat, suit, rank }]);
      hands[seat * 4 + suit] |= 1 << rank;
      best = seat % 2 === 0 ? Math.max(best, value) : Math.min(best, value);
    }
  }
  return best;
}

describe('bridge double-dummy solver', () => {
  it('matches exhaustive search for both sides, with and without trumps', () => {
    const random = seededRandom(7);
    for (let index = 0; index < 120; index++) {
      const size = 2 + (index % 2);
      const hands = deal(size, random);
      const trump = index % 5 === 4 ? NO_TRUMP : index % 4;
      const leader = index % 4;
      const northSouth = bruteForce(hands, trump, leader, []);
      expect(solveTricks(createSolver(trump, 0), { hands, leader, trick: [] }), `deal ${index}`).toBe(northSouth);
      expect(solveTricks(createSolver(trump, 1), { hands, leader, trick: [] }), `deal ${index}`).toBe(size - northSouth);
    }
  });

  it('continues a trick already in progress', () => {
    const random = seededRandom(11);
    for (let index = 0; index < 60; index++) {
      const hands = deal(3, random);
      const trump = index % 3 === 2 ? NO_TRUMP : index % 4;
      const leader = index % 4;
      // Play the leader's lowest card, then the next seat follows with its lowest legal card.
      const trick: TrickCard[] = [];
      for (let step = 0; step < 1 + (index % 3); step++) {
        const seat = (leader + step) % 4;
        const led = trick[0]?.suit;
        const suit = led !== undefined && hands[seat * 4 + led] !== 0 ? led : [0, 1, 2, 3].find((other) => hands[seat * 4 + other] !== 0)!;
        const rank = 31 - Math.clz32(hands[seat * 4 + suit] & -hands[seat * 4 + suit]);
        hands[seat * 4 + suit] &= ~(1 << rank);
        trick.push({ seat, suit, rank });
      }
      const northSouth = bruteForce(hands, trump, leader, trick);
      const solver = createSolver(trump, 0);
      expect(solveTricks(solver, { hands, leader, trick }), `deal ${index}`).toBe(northSouth);
      expect(solver.canReach({ hands, leader, trick }, northSouth + 1)).toBe(false);
    }
  });

  it('leaves the caller position unchanged and stops when its deadline passes', () => {
    const hands = deal(13, seededRandom(3));
    const before = new Int32Array(hands);
    expect(solveTricks(createSolver(3, 0), { hands: deal(4, seededRandom(5)), leader: 0, trick: [] })).toBeGreaterThanOrEqual(0);
    let thrown: unknown;
    try {
      createSolver(NO_TRUMP, 0, () => true).canReach({ hands, leader: 1, trick: [] }, 7);
    } catch (error) {
      thrown = error;
    }
    expect(isSolverAborted(thrown)).toBe(true);
    expect(hands).toEqual(before);
  });
});
