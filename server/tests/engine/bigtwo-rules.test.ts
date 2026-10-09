import { describe, it, expect } from 'vitest';
import type { Card, Rank, Seat, Suit } from '@shared/types';
import {
  beats,
  bigTwoPenalty,
  canPlay,
  compareBigTwoCards,
  findClubThreeHolder,
  identifyCombo,
  isBomb,
  isDragon,
  legalPlays,
  sortBigTwoHand,
  type BigTwoCombo,
} from '@shared/rules/bigtwo';
import { nextSeatClockwise, nextSeatCounterClockwise } from '@shared/rules/seats';

const SUITS: Record<string, Suit> = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };
const RANKS: Record<string, Rank> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

/** 'S2' = ♠2, 'H10' = ♥10 */
function card(code: string): Card {
  return { suit: SUITS[code[0]], rank: RANKS[code.slice(1)] };
}

function cards(codes: string): Card[] {
  return codes.split(' ').map(card);
}

function combo(codes: string): BigTwoCombo {
  const result = identifyCombo(cards(codes));
  if (!result) throw new Error(`illegal combo ${codes}`);
  return result;
}

function wins(next: string, previous: string): boolean {
  return beats(combo(next), combo(previous));
}

describe('bigtwo card order', () => {
  it('ranks 2 highest and 3 lowest', () => {
    expect(compareBigTwoCards(card('C2'), card('SA'))).toBeGreaterThan(0);
    expect(compareBigTwoCards(card('SA'), card('SK'))).toBeGreaterThan(0);
    expect(compareBigTwoCards(card('S3'), card('C4'))).toBeLessThan(0);
  });

  it('breaks rank ties by suit ♠ > ♥ > ♦ > ♣', () => {
    expect(compareBigTwoCards(card('S5'), card('H5'))).toBeGreaterThan(0);
    expect(compareBigTwoCards(card('H5'), card('D5'))).toBeGreaterThan(0);
    expect(compareBigTwoCards(card('D5'), card('C5'))).toBeGreaterThan(0);
  });

  it('sorts a full deck from ♣3 to ♠2', () => {
    const deck = Object.keys(SUITS).flatMap((s) => Object.keys(RANKS).map((r) => card(s + r)));
    const sorted = sortBigTwoHand(deck);
    expect(sorted[0]).toEqual(card('C3'));
    expect(sorted[51]).toEqual(card('S2'));
  });

  it('sorts by suit then rank', () => {
    expect(sortBigTwoHand(cards('S3 C2 H4 CA C3'), 'suit')).toEqual(cards('C3 CA C2 H4 S3'));
  });
});

describe('identifyCombo', () => {
  it('accepts singles, pairs and five-card hands', () => {
    expect(combo('H7').type).toBe('single');
    expect(combo('H7 S7').type).toBe('pair');
    expect(combo('C3 D4 H5 S6 C7').type).toBe('straight');
    expect(combo('C3 D3 H3 S6 C6').type).toBe('fullHouse');
    expect(combo('C9 D9 H9 S9 C4').type).toBe('fourOfAKind');
    expect(combo('H3 H4 H5 H6 H7').type).toBe('straightFlush');
  });

  it('accepts A2345 and 23456 as straights', () => {
    expect(combo('SA C2 D3 H4 S5').type).toBe('straight');
    expect(combo('S2 C3 D4 H5 S6').type).toBe('straight');
    expect(combo('C10 DJ HQ SK CA').type).toBe('straight');
  });

  it.each([
    ['triple alone', 'C3 D3 H3'],
    ['bare four', 'C3 D3 H3 S3'],
    ['flush', 'H3 H5 H7 H9 HJ'],
    ['JQKA2', 'CJ DQ HK SA C2'],
    ['QKA23', 'CQ DK HA S2 C3'],
    ['KA234', 'CK DA H2 S3 C4'],
    ['non-pair two cards', 'C3 D4'],
    ['two pair plus one', 'C3 D3 H4 S4 C5'],
    ['three cards', 'C3 D4 H5'],
    ['four cards straight', 'C3 D4 H5 S6'],
    ['six cards', 'C3 D4 H5 S6 C7 D8'],
    ['duplicate card', 'C3 C3'],
  ])('rejects %s', (_label, codes) => {
    expect(identifyCombo(cards(codes))).toBeNull();
  });

  it('rejects an empty play', () => {
    expect(identifyCombo([])).toBeNull();
  });

  it('marks only four-of-a-kind and straight flush as bombs', () => {
    expect(isBomb(combo('C9 D9 H9 S9 C4'))).toBe(true);
    expect(isBomb(combo('H3 H4 H5 H6 H7'))).toBe(true);
    expect(isBomb(combo('C3 D3 H3 S6 C6'))).toBe(false);
    expect(isBomb(combo('C3 D4 H5 S6 C7'))).toBe(false);
    expect(isBomb(combo('S2'))).toBe(false);
  });
});

describe('beats', () => {
  it('compares singles by rank then suit', () => {
    expect(wins('C2', 'SA')).toBe(true);
    expect(wins('S9', 'H9')).toBe(true);
    expect(wins('H9', 'S9')).toBe(false);
    expect(wins('S9', 'S9')).toBe(false);
  });

  it('compares pairs by the higher card', () => {
    expect(wins('C8 S8', 'D8 H8')).toBe(true);
    expect(wins('D8 H8', 'C8 S8')).toBe(false);
    expect(wins('C9 D9', 'H8 S8')).toBe(true);
  });

  it('requires the same type and size', () => {
    expect(wins('C9 D9', 'S8')).toBe(false);
    expect(wins('S2', 'C3 D3')).toBe(false);
    expect(wins('C3 D4 H5 S6 C7', 'S2')).toBe(false);
  });

  it('orders straights A2345 < 23456 < 34567 < 10JQKA', () => {
    const order = ['SA S2 S3 S4 D5', 'S2 S3 S4 S5 D6', 'S3 S4 S5 S6 D7', 'S10 SJ SQ SK DA'];
    for (let i = 1; i < order.length; i++) {
      expect(wins(order[i], order[i - 1])).toBe(true);
      expect(wins(order[i - 1], order[i])).toBe(false);
    }
  });

  it('compares equal straights by the last card suit (spec example)', () => {
    expect(wins('H2 S3 S4 S5 S6', 'S2 H3 H4 H5 H6')).toBe(true);
    expect(wins('S2 H3 H4 H5 H6', 'H2 S3 S4 S5 S6')).toBe(false);
    expect(wins('CA D2 D3 D4 S5', 'SA S2 S3 S4 H5')).toBe(true);
    expect(wins('C10 CJ CQ CK SA', 'S10 SJ SQ SK HA')).toBe(true);
  });

  it('never lets a straight and a full house beat each other', () => {
    expect(wins('C10 DJ HQ SK CA', 'C3 D3 H3 S4 C4')).toBe(false);
    expect(wins('C2 D2 H2 SA CA', 'CA D2 H3 S4 C5')).toBe(false);
  });

  it('compares full houses by the triple rank', () => {
    expect(wins('C4 D4 H4 S3 C3', 'C3 D3 H3 S2 C2')).toBe(true);
    expect(wins('C3 D3 H3 S2 C2', 'C4 D4 H4 S3 D3')).toBe(false);
  });

  it('lets four-of-a-kind beat single, pair, straight and full house', () => {
    const four = 'C3 D3 H3 S3 C4';
    expect(wins(four, 'S2')).toBe(true);
    expect(wins(four, 'H2 S2')).toBe(true);
    expect(wins(four, 'C10 DJ HQ SK CA')).toBe(true);
    expect(wins(four, 'C2 D2 H2 SA CA')).toBe(true);
  });

  it('lets a straight flush beat anything below it', () => {
    const flush = 'C3 C4 C5 C6 C7';
    expect(wins(flush, 'S2')).toBe(true);
    expect(wins(flush, 'H2 S2')).toBe(true);
    expect(wins(flush, 'C10 DJ HQ SK CA')).toBe(true);
    expect(wins(flush, 'C2 D2 H2 SA CA')).toBe(true);
    expect(wins(flush, 'C2 D2 H2 S2 C5')).toBe(true);
    expect(wins('C2 D2 H2 S2 C5', flush)).toBe(false);
  });

  it('compares four-of-a-kind by rank', () => {
    expect(wins('C5 D5 H5 S5 C3', 'C4 D4 H4 S4 S2')).toBe(true);
    expect(wins('C4 D4 H4 S4 S2', 'C5 D5 H5 S5 C3')).toBe(false);
  });

  it('compares straight flushes with straight rules', () => {
    expect(wins('D2 D3 D4 D5 D6', 'SA S2 S3 S4 S5')).toBe(true);
    expect(wins('S2 S3 S4 S5 S6', 'H2 H3 H4 H5 H6')).toBe(true);
    expect(wins('H10 HJ HQ HK HA', 'S10 SJ SQ SK SA')).toBe(false);
  });
});

describe('canPlay', () => {
  it('requires the first play to contain ♣3', () => {
    expect(canPlay(cards('D3'), null, true)).toBe(false);
    expect(canPlay(cards('C3'), null, true)).toBe(true);
    expect(canPlay(cards('C3 D3'), null, true)).toBe(true);
    expect(canPlay(cards('C3 D4 H5 S6 C7'), null, true)).toBe(true);
    expect(canPlay(cards('C3 D4 H5 S6 C7'), null, false)).toBe(true);
    expect(canPlay(cards('D4 H5 S6 C7 D8'), null, true)).toBe(false);
  });

  it('allows any legal combo on a free lead and rejects illegal sets', () => {
    expect(canPlay(cards('S2'), null, false)).toBe(true);
    expect(canPlay(cards('C3 D3 H3'), null, false)).toBe(false);
  });

  it('must beat the previous combo', () => {
    expect(canPlay(cards('S9'), combo('H9'), false)).toBe(true);
    expect(canPlay(cards('H9'), combo('S9'), false)).toBe(false);
    expect(canPlay(cards('C9 D9'), combo('S9'), false)).toBe(false);
  });
});

describe('isDragon', () => {
  it('detects one of each rank', () => {
    expect(isDragon(cards('C3 D4 H5 S6 C7 D8 H9 S10 CJ DQ HK SA C2'))).toBe(true);
  });

  it('rejects hands missing a rank', () => {
    expect(isDragon(cards('C3 D3 H5 S6 C7 D8 H9 S10 CJ DQ HK SA C2'))).toBe(false);
    expect(isDragon(cards('C3 D4 H5 S6 C7 D8 H9 S10 CJ DQ HK SA'))).toBe(false);
  });
});

describe('bigTwoPenalty', () => {
  it('multiplies cards left by 2 per two held', () => {
    expect(bigTwoPenalty(cards('C2 D2 H5 S6 C7'))).toBe(20);
    expect(bigTwoPenalty(cards('H5 S6 C7'))).toBe(3);
    expect(bigTwoPenalty(cards('C2 D2 H2 S2'))).toBe(64);
    expect(bigTwoPenalty([])).toBe(0);
  });
});

describe('seats', () => {
  it('moves counter-clockwise N → W → S → E → N', () => {
    const order: Seat[] = ['N'];
    for (let i = 0; i < 4; i++) order.push(nextSeatCounterClockwise(order[order.length - 1]));
    expect(order).toEqual(['N', 'W', 'S', 'E', 'N']);
  });

  it('moves clockwise N → E → S → W → N', () => {
    const order: Seat[] = ['N'];
    for (let i = 0; i < 4; i++) order.push(nextSeatClockwise(order[order.length - 1]));
    expect(order).toEqual(['N', 'E', 'S', 'W', 'N']);
  });

  it('finds the ♣3 holder', () => {
    const hands: Record<Seat, Card[]> = {
      N: cards('D3'), E: cards('H3'), S: cards('C3'), W: cards('S3'),
    };
    expect(findClubThreeHolder(hands)).toBe('S');
  });
});

describe('legalPlays', () => {
  const hand = cards('C3 D5 H5 S5 C5 D7 H7 S9 C10 DJ HQ SK S2');

  it('returns only higher pairs and bombs against a pair', () => {
    const plays = legalPlays(hand, combo('C6 D6'), false);
    expect(plays.length).toBeGreaterThan(0);
    for (const play of plays) {
      expect(play.type === 'pair' || isBomb(play)).toBe(true);
      expect(beats(play, combo('C6 D6'))).toBe(true);
    }
    expect(plays.filter((play) => play.type === 'pair')).toEqual([combo('D7 H7')]);
    expect(plays.filter(isBomb)).toHaveLength(9);
  });

  it('includes ♣3 in every first play', () => {
    const plays = legalPlays(hand, null, true);
    expect(plays.length).toBeGreaterThan(0);
    for (const play of plays) expect(play.cards).toContainEqual(card('C3'));
  });

  it('returns no duplicate sets', () => {
    const plays = legalPlays(hand, null, false);
    const keys = plays.map((play) => play.cards.map((c) => `${c.suit}${c.rank}`).join(','));
    expect(new Set(keys).size).toBe(keys.length);
    expect(plays.filter((play) => play.type === 'single')).toHaveLength(13);
  });
});
