import { describe, expect, it } from 'vitest';
import type { Card, ChinesePokerArrangement, Rank, Suit } from '@shared/types';
import {
  CP_MIN_ARRANGE_SECONDS,
  cpArrangeSeconds,
  cpCompare,
  cpEvaluate,
  cpIsFoul,
  cpIsValidArrangement,
  cpMatchResult,
  cpRowValue,
} from '@shared/rules/chinesepoker';

const SUITS: Record<string, Suit> = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };
const RANKS: Record<string, Rank> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
};

/** 'AH' → A♥, 'TS' → 10♠ */
function c(code: string): Card {
  return { rank: RANKS[code[0]], suit: SUITS[code[1]] };
}

const cards = (codes: string): Card[] => codes.split(' ').map(c);
const evaluate = (codes: string): ReturnType<typeof cpEvaluate> => cpEvaluate(cards(codes));
const arrangement = (front: string, middle: string, back: string): ChinesePokerArrangement =>
  ({ front: cards(front), middle: cards(middle), back: cards(back) });

function compare(a: string, b: string): number {
  return cpCompare(evaluate(a), evaluate(b));
}

// Rows: high card front, pair middle, two-pair back; identical ranks across these seats always tie.
const WEAK_E = arrangement('QS JH 9D', '8S 8H 6D 5C 4C', 'TS TH 7S 7H 3D');
const WEAK_S = arrangement('QH JD 9C', '8C 8D 6S 5D 4D', 'TC TD 7C 7D 3S');
const WEAK_W = arrangement('QC JC 9S', '8S 8D 6H 5S 4S', 'TS TC 7H 7C 3H');
const STRONG = arrangement('AS AH KD', 'QS QH QC 4D 3D', '2C 5C 7C 9C JC');

describe('Chinese Poker hand evaluation', () => {
  it('should recognize every five-card category', () => {
    expect(evaluate('9H TH JH QH KH')).toEqual({ category: 'straightFlush', ranks: [13] });
    expect(evaluate('9H 9S 9C 9D 2H')).toEqual({ category: 'fourOfAKind', ranks: [9, 2] });
    expect(evaluate('3H 3S AC AD AH')).toEqual({ category: 'fullHouse', ranks: [14, 3] });
    expect(evaluate('2S 7S 9S JS 4S')).toEqual({ category: 'flush', ranks: [11, 9, 7, 4, 2] });
    expect(evaluate('6H 7S 8C 9D TH')).toEqual({ category: 'straight', ranks: [10] });
    expect(evaluate('5H 5S 5C KD 2H')).toEqual({ category: 'threeOfAKind', ranks: [5, 13, 2] });
    expect(evaluate('5H 5S KC KD 2H')).toEqual({ category: 'twoPair', ranks: [13, 5, 2] });
    expect(evaluate('5H 5S KC QD 2H')).toEqual({ category: 'pair', ranks: [5, 13, 12, 2] });
    expect(evaluate('5H 7S KC QD 2H')).toEqual({ category: 'highCard', ranks: [13, 12, 7, 5, 2] });
  });

  it('should order categories from high card to straight flush', () => {
    const ladder = [
      '5H 7S KC QD 2H', '5H 5S KC QD 2H', '5H 5S KC KD 2H', '5H 5S 5C KD 2H', '6H 7S 8C 9D TH',
      '2S 7S 9S JS 4S', '3H 3S AC AD AH', '9H 9S 9C 9D 2H', 'AH 2H 3H 4H 5H',
    ];
    for (let i = 1; i < ladder.length; i++) expect(compare(ladder[i], ladder[i - 1])).toBe(1);
  });

  it('should rank A2345 lowest, 10JQKA highest and never wrap past the ace', () => {
    expect(evaluate('AH 2S 3C 4D 5H')).toEqual({ category: 'straight', ranks: [5] });
    expect(compare('AH 2S 3C 4D 5H', '2H 3S 4C 5D 6H')).toBe(-1);
    expect(compare('TH JS QC KD AH', '9H TS JC QD KH')).toBe(1);
    expect(evaluate('JH QS KC AD 2H')).toEqual({ category: 'highCard', ranks: [14, 13, 12, 11, 2] });
    expect(evaluate('AH 2H 3H 4H 5H')).toEqual({ category: 'straightFlush', ranks: [5] });
  });

  it('should compare within a category by rank vector and ignore suits', () => {
    expect(compare('KH KS 2C 2D 3H', 'QH QS JC JD AH')).toBe(1);
    expect(compare('KH KS 2C 2D AH', 'KC KD 2H 2S QH')).toBe(1);
    expect(compare('KH KS 2C 2D AH', 'KC KD 2H 2S AS')).toBe(0);
    expect(compare('KH KS KC 2D 2H', 'QH QS QC AD AH')).toBe(1);
    expect(compare('3H 3S 3C AD AH', '3H 3S 3D KD KH')).toBe(1);
    expect(compare('AS 9S 7S 4S 3S', 'AH 9H 7H 4H 2H')).toBe(1);
    expect(compare('6H 7S 8C 9D TH', '6S 7C 8D 9H TC')).toBe(0);
  });

  it('should only recognize trips, pairs and high cards in the front', () => {
    expect(evaluate('2H 3H 4H')).toEqual({ category: 'highCard', ranks: [4, 3, 2] });
    expect(evaluate('QH QS 2C')).toEqual({ category: 'pair', ranks: [12, 2] });
    expect(evaluate('7H 7S 7C')).toEqual({ category: 'threeOfAKind', ranks: [7] });
    expect(() => cpEvaluate(cards('2H 3H 4H 5H'))).toThrow(RangeError);
  });
});

describe('Chinese Poker fouls and row values', () => {
  it('should accept equal-strength rows and reject strictly stronger lower rows', () => {
    expect(cpIsFoul(STRONG)).toBe(false);
    // Front trips against middle trips of the same rank, and a front that prefixes the middle, are equal.
    expect(compare('5H 5S 5C', '5H 5S 5D 9D 3H')).toBe(0);
    expect(cpIsFoul(arrangement('5H 5S 5C', '5H 5S 5D 9D 3H', 'KH KS KC 2D 2H'))).toBe(false);
    expect(cpIsFoul(arrangement('AS AH KD', 'AC AD KS 5C 3D', 'QH QS QC 2D 2H'))).toBe(false);
    expect(cpIsFoul(arrangement('AS AH KD', 'AC AD QS 5C 3D', 'QH QD QC 2D 2H'))).toBe(true);
    expect(cpIsFoul(arrangement('AS KH QD', 'AC KD QS 5C 3D', 'TH TS 7C 7D 2H'))).toBe(false);
    expect(cpIsFoul(arrangement('AS KH QD', 'AC KD JS 5C 3D', 'TH TS 7C 7D 2H'))).toBe(true);
    // Middle equal to back is fine; stronger is a foul.
    expect(cpIsFoul(arrangement('2S 3H 4D', '6H 7S 8C 9D TH', '6S 7C 8D 9H TC'))).toBe(false);
    expect(cpIsFoul(arrangement('2S 3H 4D', '6H 7S 8C 9D TH', '5S 6C 7D 8H 9C'))).toBe(true);
  });

  it('should value rows by the winning hand', () => {
    expect(cpRowValue('front', evaluate('7H 7S 7C'))).toBe(3);
    expect(cpRowValue('front', evaluate('AH AS 7C'))).toBe(1);
    expect(cpRowValue('middle', evaluate('3H 3S AC AD AH'))).toBe(2);
    expect(cpRowValue('middle', evaluate('9H 9S 9C 9D 2H'))).toBe(8);
    expect(cpRowValue('middle', evaluate('9H TH JH QH KH'))).toBe(10);
    expect(cpRowValue('middle', evaluate('2S 7S 9S JS 4S'))).toBe(1);
    expect(cpRowValue('back', evaluate('3H 3S AC AD AH'))).toBe(1);
    expect(cpRowValue('back', evaluate('9H 9S 9C 9D 2H'))).toBe(4);
    expect(cpRowValue('back', evaluate('9H TH JH QH KH'))).toBe(5);
  });
});

describe('Chinese Poker scoring', () => {
  it('should double a shoot and double again for a home run', () => {
    const result = cpMatchResult({ N: STRONG, E: WEAK_E, S: WEAK_S, W: WEAK_W });
    expect(result.fouls).toEqual([]);
    expect(result.homeRun).toBe('N');
    expect(result.matchups.map(({ seats, rows, shooter, points }) => [seats, rows, shooter, points])).toEqual([
      [['N', 'E'], [1, 1, 1], 'N', 12], [['N', 'S'], [1, 1, 1], 'N', 12], [['N', 'W'], [1, 1, 1], 'N', 12],
      [['E', 'S'], [0, 0, 0], null, 0], [['E', 'W'], [0, 0, 0], null, 0], [['S', 'W'], [0, 0, 0], null, 0],
    ]);
    expect(result.scores).toEqual({ N: 36, E: -12, S: -12, W: -12 });
    expect(result.winners).toEqual(['N']);
  });

  it('should double each shoot without a home run and list tied winners in seat order', () => {
    const result = cpMatchResult({ N: STRONG, E: WEAK_E, S: STRONG, W: STRONG });
    expect(result.homeRun).toBeNull();
    expect(result.matchups.map(({ shooter, points }) => [shooter, points])).toEqual([
      ['N', 6], [null, 0], [null, 0], ['S', -6], ['W', -6], [null, 0],
    ]);
    expect(result.scores).toEqual({ N: 6, E: -18, S: 6, W: 6 });
    expect(result.winners).toEqual(['N', 'S', 'W']);
  });

  it('should score fouls against clean hands with bonuses and two fouls as zero', () => {
    const fouledN = arrangement('AS AH KD', 'QS JH 9D 7C 5C', 'TS TH 7S 7H 3D');
    const bonusE = arrangement('KD QD 4S', 'KS KH KC 2D 2C', 'AS AC AD AH 3C');
    const fouledS = arrangement('2C 3C 4H', '2H 5H 7H 9H JH', '8C 8D 6C 4C 3S');
    const cleanW = arrangement('AC AD 3H', '8S 8H 6S 6H 2C', '9S 9H 9C 4C 2D');
    const result = cpMatchResult({ N: fouledN, E: bonusE, S: fouledS, W: cleanW });
    expect(result.fouls).toEqual(['N', 'S']);
    expect(result.matchups.map(({ seats, rows, shooter, points }) => [seats, rows, shooter, points])).toEqual([
      [['N', 'E'], [-1, -2, -4], 'E', -14],
      [['N', 'S'], [0, 0, 0], null, 0],
      [['N', 'W'], [-1, -1, -1], 'W', -6],
      [['E', 'S'], [1, 2, 4], 'E', 14],
      [['E', 'W'], [-1, 2, 4], null, 5],
      [['S', 'W'], [-1, -1, -1], 'W', -6],
    ]);
    expect(result.homeRun).toBeNull();
    expect(result.scores).toEqual({ N: -20, E: 33, S: -20, W: 7 });
    expect(Object.values(result.scores).reduce((sum, score) => sum + score, 0)).toBe(0);
    expect(result.winners).toEqual(['E']);
  });

  it('should give a home run against fouled opponents and zero among them', () => {
    const fouled = arrangement('AS AH KD', 'QS JH 9D 7C 5C', 'TS TH 7S 7H 3D');
    const result = cpMatchResult({ N: fouled, E: STRONG, S: fouled, W: fouled });
    expect(result.homeRun).toBe('E');
    expect(result.scores).toEqual({ N: -12, E: 36, S: -12, W: -12 });
    expect(result.matchups.find(({ seats }) => seats[0] === 'N' && seats[1] === 'S')).toEqual(
      { seats: ['N', 'S'], rows: [0, 0, 0], shooter: null, points: 0 });
  });

  it('should not mutate inputs and should copy arrangements into the result', () => {
    const input = { N: STRONG, E: WEAK_E, S: WEAK_S, W: WEAK_W };
    const before = structuredClone(input);
    const result = cpMatchResult(input);
    expect(input).toEqual(before);
    expect(result.arrangements).toEqual(before);
    expect(result.arrangements.N).not.toBe(STRONG);
    expect(result.arrangements.N.front[0]).not.toBe(STRONG.front[0]);
  });
});

describe('Chinese Poker arrangement validation', () => {
  const hand = cards('AS AH KD QS QH QC 4D 3D 2C 5C 7C 9C JC');

  it('should accept exactly the dealt 13 cards in 3/5/5 rows', () => {
    expect(cpIsValidArrangement(hand, STRONG)).toBe(true);
    expect(cpIsValidArrangement(hand, arrangement('AS AH KD QS QH', 'QC 4D 3D', '2C 5C 7C 9C JC'))).toBe(false);
    expect(cpIsValidArrangement(hand, arrangement('AS AH KD', 'QS QH QC 4D 3D', '2C 5C 7C 9C JD'))).toBe(false);
    expect(cpIsValidArrangement(hand, arrangement('AS AH KD', 'QS QH QC 4D 4D', '2C 5C 7C 9C JC'))).toBe(false);
    expect(cpIsValidArrangement(hand, arrangement('AS AH KD', 'QS QH QC 4D', '2C 5C 7C 9C JC 3D'))).toBe(false);
    expect(cpIsValidArrangement(hand.slice(1), STRONG)).toBe(false);
  });

  it('should reject malformed cards and rows', () => {
    const malformed = { ...STRONG, front: [c('AS'), c('AH'), { suit: 'stars', rank: 13 }] } as unknown as ChinesePokerArrangement;
    const badRank = { ...STRONG, front: [c('AS'), c('AH'), { suit: 'diamonds', rank: 15 }] } as unknown as ChinesePokerArrangement;
    const notArray = { ...STRONG, back: 'cards' } as unknown as ChinesePokerArrangement;
    const nullCard = { ...STRONG, front: [c('AS'), c('AH'), null] } as unknown as ChinesePokerArrangement;
    const missing = null as unknown as ChinesePokerArrangement;
    for (const bad of [malformed, badRank, notArray, nullCard, missing]) expect(cpIsValidArrangement(hand, bad)).toBe(false);
  });

  it('should keep the arrangement window at least the minimum', () => {
    expect(cpArrangeSeconds(15, 30)).toBe(CP_MIN_ARRANGE_SECONDS);
    expect(cpArrangeSeconds(30, 60)).toBe(90);
  });
});
