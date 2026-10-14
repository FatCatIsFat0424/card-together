import { describe, expect, it } from 'vitest';
import type { Card, HoldemLogEntry } from '@shared/types';
import { cpCompare } from '@shared/rules/chinesepoker';
import { heBestHand } from '@shared/rules/holdem';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import { estimateEquity } from '../../src/bots/holdem-equity';
import { cardId, evaluateIds, scoreCategory } from '../../src/bots/holdem-evaluator';
import { blendRate, readHistory } from '../../src/bots/holdem-history';
import { preflopRankFraction } from '../../src/bots/holdem-preflop-table';
import { createBoardRanker, topHandsFilter } from '../../src/bots/holdem-ranges';

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("Hold'em bot evaluator", () => {
  it('orders random hands exactly like the shared evaluator', () => {
    const random = seeded(7);
    for (let run = 0; run < 3000; run++) {
      const size = 5 + (run % 3);
      const deck = shuffleDeck(createDeck(), random);
      const first = deck.slice(0, size);
      const second = [...deck.slice(size, size + 2), ...first.slice(2)];
      const expected = cpCompare(heBestHand(first), heBestHand(second));
      expect(Math.sign(evaluateIds(first.map(cardId), size) - evaluateIds(second.map(cardId), size))).toBe(expected);
    }
  });

  it('orders rare hands from a reduced deck, including the wheel and straight flushes', () => {
    const random = seeded(21);
    const reduced = createDeck().filter((value) => value.rank <= 6 || value.rank === 14);
    for (let run = 0; run < 3000; run++) {
      const deck = shuffleDeck(reduced, random);
      const first = deck.slice(0, 7);
      const second = deck.slice(7, 14);
      const expected = cpCompare(heBestHand(first), heBestHand(second));
      expect(Math.sign(evaluateIds(first.map(cardId), 7) - evaluateIds(second.map(cardId), 7))).toBe(expected);
    }
  });

  it('reports hand categories', () => {
    const score = (cards: readonly Card[]): number => scoreCategory(evaluateIds(cards.map(cardId), cards.length));
    expect(score([card(14), card(2, 'hearts'), card(3), card(4, 'clubs'), card(5, 'diamonds')])).toBe(4);
    expect(score([card(14), card(13), card(12), card(11), card(10)])).toBe(8);
    expect(score([card(14), card(14, 'hearts'), card(14, 'clubs'), card(14, 'diamonds'), card(3)])).toBe(7);
  });
});

describe("Hold'em bot preflop table", () => {
  it('ranks starting hands by strength', () => {
    const aces = [card(14), card(14, 'hearts')];
    const trash = [card(7), card(2, 'hearts')];
    expect(preflopRankFraction(aces)).toBeLessThan(0.01);
    expect(preflopRankFraction(trash)).toBeGreaterThan(0.9);
    expect(preflopRankFraction([card(10), card(9)])).toBeLessThan(preflopRankFraction([card(10, 'hearts'), card(9, 'spades')]));
  });
});

describe("Hold'em bot history", () => {
  const blinds = { N: 0, E: 10, S: 20, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
  const hand = (number: number): HoldemLogEntry => ({ type: 'hand', hand: number, button: 'W', smallBlind: 10, bigBlind: 20, blinds, timestamp: 0 });
  const act = (seat: 'N' | 'E' | 'S' | 'W', kind: 'fold' | 'check' | 'call' | 'bet' | 'raise', to: number, allIn = false): HoldemLogEntry =>
    ({ type: 'action', seat, action: kind, to, allIn, timestamp: 0 });

  it('counts opens, shoves, and folds to opens per seat across hands', () => {
    const log = [
      hand(1), act('W', 'raise', 60), act('N', 'fold', 0), act('E', 'fold', 10), act('S', 'call', 60),
      hand(2), act('W', 'fold', 0), act('N', 'raise', 1000, true), act('E', 'fold', 10),
    ];
    const history = readHistory(log, 'S');
    expect(history.stats.get('W')?.open).toEqual({ hits: 1, trials: 2 });
    expect(history.stats.get('N')?.shove).toEqual({ hits: 1, trials: 2 });
    expect(history.stats.get('N')?.foldToOpen).toEqual({ hits: 1, trials: 1 });
    expect(history.stats.get('E')?.foldToOpen).toEqual({ hits: 2, trials: 2 });
    expect(history.hand.preflopRaises).toBe(1);
    expect(history.hand.seats.get('N')?.raiseKind).toBe('shove');
  });

  it('tracks postflop aggression and whether the viewer already checked', () => {
    const log = [
      hand(1), act('W', 'call', 20), act('S', 'check', 20),
      { type: 'street', street: 'flop', cards: [card(2), card(3), card(4)], timestamp: 0 } as HoldemLogEntry,
      act('S', 'check', 0), act('W', 'bet', 40), act('S', 'raise', 120),
    ];
    const history = readHistory(log, 'S');
    expect(history.hand.checkedThisStreet).toBe(true);
    expect(history.hand.seats.get('W')?.aggression.flop).toBe('bet');
    expect(history.hand.seats.get('S')?.aggression.flop).toBe('raise');
    expect(history.stats.get('W')?.bet).toEqual({ hits: 1, trials: 1 });
    expect(history.stats.get('S')?.raise).toEqual({ hits: 1, trials: 1 });
  });

  it('lets a prior dominate the first observations', () => {
    expect(blendRate({ hits: 0, trials: 0 }, 0.2, 4)).toBeCloseTo(0.2);
    expect(blendRate({ hits: 1, trials: 1 }, 0.2, 4)).toBeCloseTo(0.36);
    expect(blendRate({ hits: 20, trials: 20 }, 0.2, 4)).toBeGreaterThan(0.85);
  });
});

describe("Hold'em bot equity", () => {
  const nutsBoard = [card(12), card(11), card(10), card(2, 'hearts'), card(3, 'clubs')];

  it('enumerates the river exactly against one opponent', () => {
    const random = (): number => { throw new Error('exact equity must not draw random numbers'); };
    const nuts = estimateEquity({ hole: [card(14), card(13)], board: nutsBoard, opponents: [{ filter: null, stays: 1 }], random });
    expect(nuts).toBe(1);
    const air = estimateEquity({ hole: [card(4, 'hearts'), card(5, 'diamonds')], board: nutsBoard, opponents: [{ filter: null, stays: 1 }], random });
    expect(air).toBeLessThan(0.35);
  });

  it('is lower against a narrowed range and stops early away from every threshold', () => {
    const hole = [card(10, 'hearts'), card(10, 'diamonds')];
    const random = seeded(3);
    const wide = estimateEquity({ hole, board: [], opponents: [{ filter: null, stays: 1 }], random, minRuns: 600, maxRuns: 600 });
    const narrow = estimateEquity({ hole, board: [], opponents: [{ filter: topHandsFilter(0.1), stays: 1 }], random, minRuns: 600, maxRuns: 600 });
    expect(narrow).toBeLessThan(wide - 0.1);
    let draws = 0;
    const counting = (): number => { draws += 1; return random(); };
    estimateEquity({ hole: [card(14), card(14, 'hearts')], board: [], opponents: [{ filter: null, stays: 1 }], random: counting, thresholds: [0.3] });
    const early = draws;
    draws = 0;
    estimateEquity({ hole: [card(14), card(14, 'hearts')], board: [], opponents: [{ filter: null, stays: 1 }], random: counting, thresholds: [0.85] });
    expect(early).toBeLessThan(draws);
  });

  it('counts seats that may fold as absent from some showdowns', () => {
    const hole = [card(7, 'hearts'), card(2, 'diamonds')];
    const random = seeded(8);
    const present = estimateEquity({ hole, board: [], opponents: [{ filter: null, stays: 1 }, { filter: null, stays: 1 }], random, minRuns: 500, maxRuns: 500 });
    const folding = estimateEquity({ hole, board: [], opponents: [{ filter: null, stays: 1 }, { filter: null, stays: 0.1 }], random, minRuns: 500, maxRuns: 500 });
    expect(folding).toBeGreaterThan(present);
  });

  it('keeps only the strongest holdings on a board', () => {
    const board = [card(14), card(9, 'hearts'), card(4, 'clubs')];
    const keep = createBoardRanker(board, [card(2), card(3)])(0.1);
    expect(keep(cardId(card(14, 'hearts')), cardId(card(14, 'diamonds')))).toBe(true);
    expect(keep(cardId(card(7, 'hearts')), cardId(card(6, 'diamonds')))).toBe(false);
  });
});
