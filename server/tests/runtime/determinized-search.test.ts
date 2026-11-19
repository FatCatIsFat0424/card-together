import { describe, expect, it } from 'vitest';
import type { GameSeat } from '@shared/types';
import { dealUnseen } from '../../src/bots/search/card-dealer';
import type { DealSpec } from '../../src/bots/search/card-dealer';
import { determinizedSearch } from '../../src/bots/search/determinized';
import type { Candidate, DeterminizedGame } from '../../src/bots/search/determinized';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';

// A toy two-seat trick game: one card per trick each, the higher card takes both and scores their face
// values, and the trick winner leads next. Utility is the seat's points minus the opponent's.

const SEATS: readonly GameSeat[] = ['N', 'S'];

interface ToyState {
  readonly hands: number[][];
  trick: number[];
  leader: number;
  turn: number;
  readonly points: number[];
}

/** What N sees: its own hand, the open trick, and the cards nobody has shown. */
interface ToyView {
  readonly hand: readonly number[];
  readonly trick: readonly number[];
  readonly leader: number;
  readonly unseen: readonly number[];
  readonly opponentSize: number;
}

function play(state: ToyState, card: number): void {
  const hand = state.hands[state.turn];
  hand.splice(hand.indexOf(card), 1);
  state.trick.push(card);
  if (state.trick.length < 2) {
    state.turn = 1 - state.turn;
    return;
  }
  const [lead, follow] = state.trick;
  const winner = follow > lead ? 1 - state.leader : state.leader;
  state.points[winner] += lead + follow;
  state.trick = [];
  state.leader = winner;
  state.turn = winner;
}

/** Leaders play high; followers win as cheaply as possible or throw their lowest card. */
function greedyMove(state: ToyState): number {
  const hand = [...state.hands[state.turn]].sort((a, b) => a - b);
  if (state.trick.length === 0) return hand[hand.length - 1];
  return hand.find((card) => card > state.trick[0]) ?? hand[0];
}

function toyGame(view: ToyView, overrides: Partial<DeterminizedGame<ToyState, number>> = {}): DeterminizedGame<ToyState, number> {
  return {
    seat: 'N',
    sample: (random) => {
      // Cards beyond the opponent's hand stay out of play, like a stock nobody will draw from.
      const deal = dealUnseen({
        unseen: view.unseen, seats: [{ size: view.opponentSize }, { size: view.unseen.length - view.opponentSize }],
      }, random);
      if (!deal) return null;
      const turn = view.trick.length === 0 ? view.leader : 1 - view.leader;
      return { state: { hands: [[...view.hand], deal.hands[0]], trick: [...view.trick], leader: view.leader, turn, points: [0, 0] } };
    },
    copy: (state) => ({ ...state, hands: state.hands.map((hand) => [...hand]), trick: [...state.trick], points: [...state.points] }),
    legalMoves: (state) => state.hands[state.turn],
    play,
    rolloutMove: greedyMove,
    isTerminal: (state) => state.hands.every((hand) => hand.length === 0) && state.trick.length === 0,
    utility: (state, seat) => {
      const me = SEATS.indexOf(seat);
      return state.points[me] - state.points[1 - me];
    },
    ...overrides,
  };
}

function context(seed: number, budgetMs = Infinity, maxDepth?: number): SearchContext {
  const began = performance.now();
  const timeLeftMs = (): number => Math.max(0, budgetMs - (performance.now() - began));
  return { random: seededRandom(seed), budget: { maxDepth, timeLeftMs, expired: () => timeLeftMs() === 0 } };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// S led a 7 and holds one hidden card from 2–6. Taking with the 8 scores 15 and concedes at most 1 + 6;
// ducking with the 1 concedes 8 and wins back at most 8 + 6, so the 8 is better on every deal.
const FOLLOW: ToyView = { hand: [8, 1], trick: [7], leader: 1, unseen: [2, 3, 4, 5, 6], opponentSize: 1 };
const DUCK_FIRST: readonly Candidate<number>[] = [{ move: 1, prior: 10 }, { move: 8, prior: 0 }];

describe('determinized search', () => {
  it('overrules the heuristic when every world favours another move', () => {
    const choice = determinizedSearch(toyGame(FOLLOW), DUCK_FIRST, context(1), { maxSamples: 40 });
    expect(choice).toMatchObject({ move: 8, reason: 'searched', samples: 40 });
    const [duck, take] = choice.stats;
    expect(take.mean).toBeGreaterThan(duck.mean);
  });

  it('keeps the heuristic choice until enough worlds are examined', () => {
    const choice = determinizedSearch(toyGame(FOLLOW), DUCK_FIRST, context(1), { maxSamples: 3, minSamples: 6 });
    expect(choice).toMatchObject({ move: 1, reason: 'prior', samples: 3 });
    expect(determinizedSearch(toyGame(FOLLOW), DUCK_FIRST, context(1, 0))).toMatchObject({ move: 1, reason: 'prior', samples: 0 });
  });

  it('breaks ties within noise by the prior', () => {
    const flat = toyGame(FOLLOW, { utility: () => 0 });
    const candidates: Candidate<number>[] = [{ move: 8, prior: 1 }, { move: 1, prior: 2 }];
    expect(determinizedSearch(flat, candidates, context(2), { maxSamples: 20 })).toMatchObject({ move: 1, reason: 'searched' });
    // A clear difference larger than the tolerance still wins.
    expect(determinizedSearch(toyGame(FOLLOW), DUCK_FIRST, context(2), { maxSamples: 20, tolerance: 1 }).move).toBe(8);
    expect(determinizedSearch(toyGame(FOLLOW), DUCK_FIRST, context(2), { maxSamples: 20, tolerance: 50 }).move).toBe(1);
  });

  it('is deterministic for a seed when the clock does not run out', () => {
    // Random rollouts make the values depend on the seed rather than on the deal alone.
    const game = toyGame({ hand: [9, 5, 2], trick: [], leader: 0, unseen: [1, 3, 4, 6, 7, 8], opponentSize: 3 },
      { rolloutMove: undefined });
    const candidates: Candidate<number>[] = [{ move: 9, prior: 0 }, { move: 5, prior: 1 }, { move: 2, prior: 2 }];
    const first = determinizedSearch(game, candidates, context(7, Infinity, 4), { maxSamples: 30, rolloutsPerSample: 2 });
    const second = determinizedSearch(game, candidates, context(7, Infinity, 4), { maxSamples: 30, rolloutsPerSample: 2 });
    expect(second).toEqual(first);
    expect(determinizedSearch(game, candidates, context(8), { maxSamples: 30, rolloutsPerSample: 2 }).stats)
      .not.toEqual(first.stats);
  });

  it('stops within its budget', () => {
    const slow = toyGame(FOLLOW, {
      sample: (random) => {
        const until = performance.now() + 5;
        while (performance.now() < until) { /* stands in for an expensive deal */ }
        return toyGame(FOLLOW).sample(random);
      },
    });
    const began = performance.now();
    const choice = determinizedSearch(slow, DUCK_FIRST, context(3, 60), { maxSamples: 1_000 });
    const elapsed = performance.now() - began;
    expect(elapsed).toBeLessThan(60 + 40);
    expect(choice.samples).toBeGreaterThan(0);
    expect(choice.samples).toBeLessThan(20);
  });

  it('uses an exact evaluator and drops a world it could not finish', () => {
    let calls = 0;
    const exact = toyGame(FOLLOW, {
      evaluate: (state, seat) => {
        calls++;
        if (calls === 9) return null;
        const game = toyGame(FOLLOW);
        while (!game.isTerminal(state)) game.play(state, greedyMove(state));
        return game.utility(state, seat);
      },
    });
    const choice = determinizedSearch(exact, DUCK_FIRST, context(4), { maxSamples: 10, minSamples: 3 });
    // Calls 1–8 finish four worlds; the fifth world fails on its first candidate and ends the search.
    expect(choice).toMatchObject({ move: 8, samples: 4 });
  });

  it('weights worlds and skips impossible ones', () => {
    let draws = 0;
    const weighted = toyGame(FOLLOW, {
      sample: (random) => {
        draws++;
        const world = toyGame(FOLLOW).sample(random);
        return draws % 3 === 0 ? null : world && { state: world.state, weight: draws % 3 === 1 ? 2 : 0.5 };
      },
    });
    expect(determinizedSearch(weighted, DUCK_FIRST, context(5), { maxSamples: 12 })).toMatchObject({ move: 8, samples: 12 });
    const impossible = toyGame(FOLLOW, { sample: () => null });
    expect(determinizedSearch(impossible, DUCK_FIRST, context(5), { maxSamples: 12 })).toMatchObject({ move: 1, samples: 0 });
  });

  it('does not mutate the view or the candidates', () => {
    const view = deepFreeze<ToyView>({ hand: [9, 5, 2], trick: [], leader: 0, unseen: [1, 3, 4, 6, 7, 8], opponentSize: 3 });
    const candidates = deepFreeze<Candidate<number>[]>([{ move: 9, prior: 0 }, { move: 5, prior: 1 }, { move: 2, prior: 2 }]);
    expect(() => determinizedSearch(toyGame(view), candidates, context(6), { maxSamples: 20 })).not.toThrow();
  });
});

describe('dealUnseen', () => {
  const unseen = Array.from({ length: 12 }, (_, index) => index);
  const suit = (card: number): number => card % 3;

  it('honors sizes, known cards, and hard limits', () => {
    const spec = deepFreeze<DealSpec<number>>({
      unseen,
      seats: [
        { size: 5, known: [20], accepts: (card) => suit(card) !== 0 },
        { size: 4, accepts: (card) => card !== 1 && card !== 4 },
        { size: 5, known: [21] },
      ],
    });
    const random = seededRandom(11);
    for (let round = 0; round < 200; round++) {
      const deal = dealUnseen(spec, random)!;
      expect(deal.hands.map((hand) => hand.length)).toEqual([5, 4, 5]);
      expect(deal.hands[0][0]).toBe(20);
      expect(deal.hands[2][0]).toBe(21);
      expect(deal.hands[0].slice(1).every((card) => suit(card) !== 0)).toBe(true);
      expect(deal.hands[1].some((card) => card === 1 || card === 4)).toBe(false);
      expect([...deal.hands[0].slice(1), ...deal.hands[1], ...deal.hands[2].slice(1)].sort((a, b) => a - b)).toEqual(unseen);
      expect(deal).toMatchObject({ misfit: 0, weight: 1 });
    }
  });

  it('fills a hand that can take only a few of the cards', () => {
    // Seat 0 may hold only the four cards of suit 0, and needs all of them.
    const spec: DealSpec<number> = { unseen, seats: [{ size: 4, accepts: (card) => suit(card) === 0 }, { size: 8 }] };
    const random = seededRandom(12);
    for (let round = 0; round < 50; round++) expect(dealUnseen(spec, random)!.hands[0].sort((a, b) => a - b)).toEqual([0, 3, 6, 9]);
  });

  it('keeps the best fit to soft evidence and weights by likelihood', () => {
    const highCards = (hand: readonly number[]): number => hand.filter((card) => card >= 9).length;
    const spec: DealSpec<number> = {
      unseen, seats: [{ size: 6 }, { size: 6 }],
      misfit: (hands) => highCards(hands[0]),
      logLikelihood: (hands) => -highCards(hands[0]),
      // About one deal in eleven has no high card in the first hand.
      attempts: 200,
    };
    const random = seededRandom(13);
    for (let round = 0; round < 50; round++) {
      const deal = dealUnseen(spec, random)!;
      expect(deal.misfit).toBe(highCards(deal.hands[0]));
      expect(deal.misfit).toBe(0);
      expect(deal.weight).toBe(1);
    }
    const single = dealUnseen({ ...spec, attempts: 1 }, seededRandom(14))!;
    expect(single.weight).toBeCloseTo(Math.exp(-highCards(single.hands[0])));
  });

  it('reports impossible deals', () => {
    expect(dealUnseen({ unseen, seats: [{ size: 4, accepts: () => false }, { size: 8 }] }, seededRandom(15))).toBeNull();
    expect(() => dealUnseen({ unseen, seats: [{ size: 4 }] }, seededRandom(15))).toThrow(RangeError);
  });
});
