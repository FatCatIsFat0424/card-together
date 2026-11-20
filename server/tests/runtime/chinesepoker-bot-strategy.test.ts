import { describe, expect, it } from 'vitest';
import type { Card, ChinesePokerArrangement, ChinesePokerVisibleState, Seat } from '@shared/types';
import { cpIsFoul, cpIsValidArrangement, cpMatchResult } from '@shared/rules/chinesepoker';
import { cpGreedyArrangement, cpRankArrangements } from '@shared/rules/chinesepoker-arrange';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import { getChinesePokerBotAction } from '../../src/bots/chinesepoker-strategy';
import {
  arrangeBySampling, chinesePokerSearch, chooseArrangement, estimateArrangements, matchTotals, rankedCandidates,
  staticBestScore,
} from '../../src/bots/chinesepoker-search';
import { gameBot } from '../../src/bots/bot-registry';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
import { seededRandom } from '../../src/bots/search/seeded-random';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];

function state(myHand: Card[], overrides: Partial<ChinesePokerVisibleState> = {}): ChinesePokerVisibleState {
  return {
    gameType: 'chinesepoker', phase: 'arranging', mySeat: 'E', myHand, myArrangement: null,
    submitted: { N: true, E: false, S: false, W: false }, arrangeDeadline: 0, autoArranged: [],
    log: [], result: null, ...overrides,
  };
}

function deal(seed: number): Card[][] {
  const deck = shuffleDeck(createDeck(), seededRandom(seed));
  return SEATS.map((_, seat) => deck.slice(seat * 13, seat * 13 + 13));
}

const never = (): boolean => false;
const always = (): boolean => true;

/** Expires this long after the call, so a search ends quickly. */
function clock(ms: number): () => boolean {
  const end = performance.now() + ms;
  return () => performance.now() >= end;
}

function context(random: () => number, expired: () => boolean = clock(60)): Parameters<typeof chinesePokerSearch>[1] {
  return { random, budget: { maxDepth: undefined, timeLeftMs: () => 1000, expired } };
}

describe('Chinese Poker sampled search', () => {
  it('scores arrangements exactly as the match does, shoots and home runs included', () => {
    let shoots = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const hands = deal(seed);
      const best = hands.map((hand) => rankedCandidates(hand, 1)[0]);
      const keys = new Int32Array(12);
      best.forEach((candidate, seat) => keys.set(candidate.keys, seat * 3));
      const totals = new Float64Array(4);
      matchTotals(keys, totals);
      const result = cpMatchResult({
        N: best[0].arrangement, E: best[1].arrangement, S: best[2].arrangement, W: best[3].arrangement,
      });
      SEATS.forEach((seat, index) => expect(totals[index]).toBe(result.scores[seat]));
      if (result.matchups.some((matchup) => matchup.shooter)) shoots++;
    }
    expect(shoots).toBeGreaterThan(0);
  }, 30_000);

  it('arranges opponents as fast as the shared ranking scores them', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const [hand] = deal(seed + 500);
      expect(staticBestScore(hand)).toBeCloseTo(cpRankArrangements(hand, 1)[0].score, 9);
    }
  });

  it('lists distinct non-foul candidates, best static score first', () => {
    const [hand] = deal(7);
    const candidates = rankedCandidates(hand, 25);
    expect(candidates).toHaveLength(25);
    expect(candidates.every((candidate) => cpIsValidArrangement(hand, candidate.arrangement)
      && !cpIsFoul(candidate.arrangement))).toBe(true);
    expect(candidates.map((candidate) => candidate.prior)).toEqual([...candidates.map((candidate) => candidate.prior)].sort((a, b) => b - a));
  });

  it('prefers the candidate that scores best against the sampled opponents', () => {
    const [hand] = deal(11);
    const [best, ...rest] = rankedCandidates(hand, 30);
    const worst = rest[rest.length - 1];
    // The static order is reversed, so only the sampled scores can put the strongest arrangement first.
    const candidates = [worst, best];
    const estimate = estimateArrangements(hand, candidates, seededRandom(3), { maxSamples: 200, expired: never });
    expect(estimate.samples).toBe(200);
    expect(estimate.score[1]).toBeGreaterThan(estimate.score[0]);
    expect(chooseArrangement(candidates, estimate)).toBe(best);
    // Too few samples to trust: the static order stands.
    const thin = estimateArrangements(hand, candidates, seededRandom(3), { maxSamples: 5, expired: never });
    expect(chooseArrangement(candidates, thin)).toBe(worst);
  });

  it('is repeatable for a seed and stops at the budget with at least one sample', () => {
    const [hand] = deal(13);
    const first = arrangeBySampling(hand, seededRandom(9), never, 80);
    expect(arrangeBySampling(hand, seededRandom(9), never, 80)).toEqual(first);
    const [top] = cpRankArrangements(hand, 1);
    expect(arrangeBySampling(hand, seededRandom(9), always)).toEqual(top.arrangement);
  });

  it('plays a valid non-foul arrangement from the search and the synchronous fallback, without changing the view', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const [hand] = deal(seed + 100);
      const visible = state(hand);
      const before = structuredClone(visible);
      const actions = [
        chinesePokerSearch(visible, context(seededRandom(seed))),
        getChinesePokerBotAction(visible, seededRandom(seed)),
      ];
      for (const action of actions) {
        if (action?.type !== 'chinesepoker-arrange') throw new Error('Expected an arrangement');
        expect(cpIsValidArrangement(hand, action.arrangement)).toBe(true);
        expect(cpIsFoul(action.arrangement)).toBe(false);
      }
      expect(visible).toEqual(before);
    }
  });

  it('answers within its limits: a short clock for the fallback and the budget for the search', () => {
    const [hand] = deal(21);
    const started = performance.now();
    getChinesePokerBotAction(state(hand), seededRandom(1));
    expect(performance.now() - started).toBeLessThan(500);
    const budgeted = performance.now();
    chinesePokerSearch(state(hand), context(seededRandom(1), clock(150)));
    expect(performance.now() - budgeted).toBeLessThan(900);
  });

  it('does nothing after submitting or once scoring starts', () => {
    const hand = createDeck().slice(0, 13);
    const submitted = { N: true, E: true, S: false, W: false };
    const arranged: ChinesePokerArrangement = cpGreedyArrangement(hand);
    expect(getChinesePokerBotAction(state(hand, { submitted, myArrangement: arranged }), () => 0)).toBeNull();
    expect(getChinesePokerBotAction(state(hand, { phase: 'scoring' }), () => 0)).toBeNull();
    expect(chinesePokerSearch(state(hand, { submitted, myArrangement: arranged }), context(() => 0))).toBeNull();
    expect(chinesePokerSearch(state(hand, { phase: 'scoring' }), context(() => 0))).toBeNull();
  });

  it('runs in the worker pool with the synchronous version as its fallback', async () => {
    const bot = gameBot('chinesepoker');
    expect(bot.decide).toBe(getChinesePokerBotAction);
    expect(bot.search?.strategy.exportName).toBe('chinesePokerSearch');
    const pool = createSearchPool({ workers: 1, memoryMb: 256, queueLimit: 2 });
    try {
      const [hand] = deal(31);
      const outcome = await pool.run({ strategy: bot.search!.strategy, visible: state(hand), budgetMs: 300, seed: 5 });
      if (outcome.status !== 'ok' || outcome.action?.type !== 'chinesepoker-arrange') throw new Error(`Search ended as ${outcome.status}`);
      expect(cpIsValidArrangement(hand, outcome.action.arrangement)).toBe(true);
      expect(cpIsFoul(outcome.action.arrangement)).toBe(false);
    } finally {
      await pool.close();
    }
  }, 20_000);
});
