import { describe, expect, it } from 'vitest';
import type { Card, GameSeat, HoldemLogEntry } from '@shared/types';
import { cpCompare } from '@shared/rules/chinesepoker';
import { heBestHand } from '@shared/rules/holdem';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import { compileRange, estimateContestedEquity, estimateEquity, knownIds } from '../../src/bots/holdem-equity';
import type { Effort } from '../../src/bots/holdem-equity';
import { cardId, evaluateIds, scoreCategory } from '../../src/bots/holdem-evaluator';
import { preflopOrder, readHand, seatRead } from '../../src/bots/holdem-history';
import { classIndexOfIds, preflopRankFraction } from '../../src/bots/holdem-preflop-table';
import { CALL_CHARTS, PUSH_CHARTS, PUSH_FOLD_ALPHABET } from '../../src/bots/holdem-push-fold-data';
import { callLimit, callLimitOfIds, MAX_CHART_BEHIND, pushLimit, pushLimitOfIds } from '../../src/bots/holdem-push-fold';
import { actionWeight, createBoardPercentile, topHandsWeight } from '../../src/bots/holdem-ranges';

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const runs = (count: number): Effort => ({ minRuns: count, maxRuns: count, exactTurn: false, expired: () => false });

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

  it('indexes the 169 classes the same way for either card order', () => {
    const seen = new Set<number>();
    for (let first = 0; first < 52; first++) {
      for (let second = 0; second < 52; second++) {
        if (first === second) continue;
        expect(classIndexOfIds(first, second)).toBe(classIndexOfIds(second, first));
        seen.add(classIndexOfIds(first, second));
      }
    }
    expect(seen.size).toBe(169);
  });
});

describe("Hold'em bot push/fold charts", () => {
  /** Share of all 1,326 starting hands that play at `depth` big blinds according to `limit`. */
  function share(limit: (first: number, second: number) => number, depth: number): number {
    let playing = 0;
    let total = 0;
    for (let first = 0; first < 52; first++) {
      for (let second = first + 1; second < 52; second++) {
        total += 1;
        if (limit(first, second) >= depth) playing += 1;
      }
    }
    return playing / total;
  }

  it('stores one encoded threshold per class for every charted spot', () => {
    expect(PUSH_CHARTS).toHaveLength(MAX_CHART_BEHIND);
    CALL_CHARTS.forEach((charts, index) => expect(charts).toHaveLength(index + 1));
    for (const chart of [...PUSH_CHARTS, ...CALL_CHARTS.flat()]) {
      expect(chart).toHaveLength(169);
      expect([...chart].every((code) => PUSH_FOLD_ALPHABET.includes(code))).toBe(true);
    }
  });

  it('always plays aces and pushes or calls trash only when very shallow', () => {
    const aces = [card(14), card(14, 'hearts')];
    const trash = [card(7), card(2, 'hearts')];
    for (let behind = 1; behind <= MAX_CHART_BEHIND; behind++) {
      expect(pushLimit(behind, aces)).toBe(Number.POSITIVE_INFINITY);
      for (let place = 1; place <= behind; place++) expect(callLimit(behind, place, aces)).toBe(Number.POSITIVE_INFINITY);
      expect(pushLimit(behind, trash)).toBeLessThan(behind === 1 ? 4 : 3);
      expect(callLimit(behind, behind, trash)).toBeLessThan(4);
    }
  });

  it('pushes fewer hands with more seats behind and at deeper stacks', () => {
    for (const depth of [5, 10, 15]) {
      const shares = [1, 2, 3, 5, 7].map((behind) => share((a, b) => pushLimitOfIds(behind, a, b), depth));
      for (let index = 1; index < shares.length; index++) expect(shares[index]).toBeLessThan(shares[index - 1]);
    }
    const headsUp = [4, 8, 12, 20].map((depth) => share((a, b) => pushLimitOfIds(1, a, b), depth));
    for (let index = 1; index < headsUp.length; index++) expect(headsUp[index]).toBeLessThan(headsUp[index - 1]);
    // The small blind against the big blind pushes about half its hands at ten big blinds.
    expect(share((a, b) => pushLimitOfIds(1, a, b), 10)).toBeGreaterThan(0.4);
    expect(share((a, b) => pushLimitOfIds(1, a, b), 10)).toBeLessThan(0.75);
  });

  it('calls tighter than it pushes, and widest from the big blind', () => {
    for (const depth of [6, 10, 15]) {
      expect(share((a, b) => callLimitOfIds(1, 1, a, b), depth)).toBeLessThan(share((a, b) => pushLimitOfIds(1, a, b), depth));
      expect(share((a, b) => callLimitOfIds(3, 1, a, b), depth)).toBeLessThan(share((a, b) => callLimitOfIds(3, 3, a, b), depth));
    }
  });
});

describe("Hold'em bot hand reading", () => {
  const blinds = { N: 10, E: 20, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
  const stacks = { N: 1000, E: 1000, S: 400, W: 1000, P5: 0, P6: 0, P7: 0, P8: 0 };
  const dealt: GameSeat[] = ['N', 'E', 'S', 'W'];
  const hand = (number: number): HoldemLogEntry => ({ type: 'hand', hand: number, button: 'W', smallBlind: 10, bigBlind: 20, blinds, timestamp: 0 });
  const act = (seat: GameSeat, kind: 'fold' | 'check' | 'call' | 'bet' | 'raise', to: number, allIn = false): HoldemLogEntry =>
    ({ type: 'action', seat, action: kind, to, allIn, timestamp: 0 });
  const street = (name: 'flop' | 'turn' | 'river', cards: Card[]): HoldemLogEntry => ({ type: 'street', street: name, cards, timestamp: 0 });

  it('orders preflop action from the seat after the big blind', () => {
    // With W on the button, N and E post the blinds.
    expect(preflopOrder(dealt, 'W')).toEqual(['S', 'W', 'N', 'E']);
    expect(preflopOrder(['N', 'S'], 'N')).toEqual(['N', 'S']);
  });

  it('reads only the current hand, with positions and stack depths', () => {
    const log = [
      hand(1), act('S', 'raise', 400, true), act('W', 'fold', 0), act('N', 'fold', 10), act('E', 'fold', 20),
      hand(2), act('S', 'raise', 400, true), act('W', 'call', 400), act('N', 'fold', 10),
    ];
    const read = readHand(log, 'E', { dealt, button: 'W', bigBlind: 20, stacks });
    expect(read.preflopRaises).toBe(1);
    expect(read.preflopAggressor).toBe('S');
    expect(seatRead(read, 'S').preflop).toMatchObject({ kind: 'shove', behind: 3, stackBlinds: 20, raisesBefore: 0 });
    expect(seatRead(read, 'W').preflop).toMatchObject({ kind: 'callShove', behind: 3, place: 1, stackBlinds: 20 });
    expect(seatRead(read, 'N').preflop.kind).toBe('none');
  });

  it('records postflop bet sizes as shares of the pot', () => {
    const log = [
      hand(1), act('S', 'call', 20), act('W', 'call', 20), act('N', 'call', 20), act('E', 'check', 20),
      street('flop', [card(2), card(3), card(4)]), act('N', 'check', 0), act('E', 'bet', 40), act('S', 'fold', 0), act('W', 'raise', 160),
    ];
    const read = readHand(log, 'N', { dealt, button: 'W', bigBlind: 20, stacks });
    expect(read.limpers).toBe(3);
    expect(read.checkedThisStreet).toBe(true);
    expect(read.streetRaises).toBe(2);
    expect(seatRead(read, 'E').postflop).toEqual([{ street: 'flop', kind: 'bet', fraction: 0.5 }]);
    // A raise from 40 to 160 adds 120 to a pot of 160 once the 40 is called.
    expect(seatRead(read, 'W').postflop).toEqual([{ street: 'flop', kind: 'raise', fraction: 0.75 }]);
  });
});

describe("Hold'em bot ranges", () => {
  it('weighs bets by size: larger bets hold more value and fewer bluffs', () => {
    const bet = (fraction: number, percentile: number): number => actionWeight({ street: 'flop', kind: 'bet', fraction }, percentile, false);
    expect(bet(0.33, 0.5)).toBe(1);
    expect(bet(1.5, 0.5)).toBeLessThan(1);
    expect(bet(1.5, 0.9)).toBe(1);
    expect(bet(0.33, 0.05)).toBeGreaterThan(0);
    expect(actionWeight({ street: 'river', kind: 'bet', fraction: 1 }, 0.05, true)).toBeLessThan(bet(1, 0.05));
  });

  it('ranks holdings on a board by percentile', () => {
    const board = [card(14), card(9, 'hearts'), card(4, 'clubs')];
    const percentile = createBoardPercentile(board, [card(2), card(3)]);
    expect(percentile(cardId(card(14, 'hearts')), cardId(card(14, 'diamonds')))).toBeGreaterThan(0.99);
    expect(percentile(cardId(card(7, 'hearts')), cardId(card(6, 'diamonds')))).toBeLessThan(0.5);
  });
});

describe("Hold'em bot equity", () => {
  const nutsBoard = [card(12), card(11), card(10), card(2, 'hearts'), card(3, 'clubs')];
  const anyHand = (hole: Card[], board: Card[]) => compileRange(null, knownIds(hole, board));

  it('enumerates the river exactly against one opponent', () => {
    const random = (): number => { throw new Error('exact equity must not draw random numbers'); };
    const nutsHole = [card(14), card(13)];
    expect(estimateEquity({ hole: nutsHole, board: nutsBoard, opponents: [{ range: anyHand(nutsHole, nutsBoard), stays: 1 }], random })).toBe(1);
    const air = [card(4, 'hearts'), card(5, 'diamonds')];
    expect(estimateEquity({ hole: air, board: nutsBoard, opponents: [{ range: anyHand(air, nutsBoard), stays: 1 }], random })).toBeLessThan(0.35);
  });

  it('enumerates the turn exactly when the effort allows', () => {
    const hole = [card(9, 'hearts'), card(9, 'diamonds')];
    const board = nutsBoard.slice(0, 4);
    const random = (): number => { throw new Error('exact equity must not draw random numbers'); };
    const exact = estimateEquity({
      hole, board, random, opponents: [{ range: anyHand(hole, board), stays: 1 }], effort: { ...runs(1), exactTurn: true },
    });
    const sampled = estimateEquity({ hole, board, random: seeded(4), opponents: [{ range: anyHand(hole, board), stays: 1 }], effort: runs(4000) });
    expect(Math.abs(exact - sampled)).toBeLessThan(0.03);
  });

  it('is lower against a narrowed range and stops early away from every threshold', () => {
    const hole = [card(10, 'hearts'), card(10, 'diamonds')];
    const random = seeded(3);
    const wide = estimateEquity({ hole, board: [], opponents: [{ range: anyHand(hole, []), stays: 1 }], random, effort: runs(600) });
    const narrow = estimateEquity({
      hole, board: [], opponents: [{ range: compileRange(topHandsWeight(0.1), knownIds(hole, [])), stays: 1 }], random, effort: runs(600),
    });
    expect(narrow).toBeLessThan(wide - 0.1);
    let draws = 0;
    const counting = (): number => { draws += 1; return random(); };
    const aces = [card(14), card(14, 'hearts')];
    const effort: Effort = { minRuns: 48, maxRuns: 2000, exactTurn: false, expired: () => false };
    estimateEquity({ hole: aces, board: [], opponents: [{ range: anyHand(aces, []), stays: 1 }], random: counting, thresholds: [0.3], effort });
    const early = draws;
    draws = 0;
    estimateEquity({ hole: aces, board: [], opponents: [{ range: anyHand(aces, []), stays: 1 }], random: counting, thresholds: [0.85], effort });
    expect(early).toBeLessThan(draws);
  });

  it('counts seats that may fold as absent from some showdowns', () => {
    const hole = [card(7, 'hearts'), card(2, 'diamonds')];
    const range = anyHand(hole, []);
    const random = seeded(8);
    const present = estimateEquity({ hole, board: [], opponents: [{ range, stays: 1 }, { range, stays: 1 }], random, effort: runs(500) });
    const folding = estimateEquity({ hole, board: [], opponents: [{ range, stays: 1 }, { range, stays: 0.1 }], random, effort: runs(500) });
    expect(folding).toBeGreaterThan(present);
    const contested = estimateContestedEquity({ hole, board: [], opponents: [{ range, stays: 0.2 }, { range, stays: 0.2 }], random, effort: runs(500) });
    expect(contested.present).toBeGreaterThanOrEqual(1);
    expect(contested.equity).toBeLessThan(0.45);
  });

  it('stays bounded with a constant generator', () => {
    const hole = [card(7, 'hearts'), card(2, 'diamonds')];
    const range = anyHand(hole, []);
    const equity = estimateEquity({ hole, board: [], opponents: [{ range, stays: 1 }, { range, stays: 1 }], random: () => 0.99, effort: runs(50) });
    expect(equity).toBeGreaterThanOrEqual(0);
    expect(equity).toBeLessThanOrEqual(1);
  });
});
