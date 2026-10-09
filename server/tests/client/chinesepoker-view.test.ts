import { describe, expect, it } from 'vitest';
import { cpMatchResult } from '@shared/rules/chinesepoker';
import { cpBestArrangement } from '@shared/rules/chinesepoker-arrange';
import type { Card, ChinesePokerArrangement, ChinesePokerCategory, Seat } from '@shared/types';
import {
  EMPTY_ROWS, buildArrangement, canPlace, categoryLabelKey, isFoulArrangement, placeCards, placedCount,
  returnCard, rowHints, rowLabelKey, rowNet, rowsFromArrangement, sanitizeRows, signedPoints, sortCpHand,
  unplacedCards,
} from '../../../client/src/games/chinesepoker/chinesepoker-view';
import type { CpRowCards } from '../../../client/src/games/chinesepoker/chinesepoker-view';
import { chinesePokerTranslations } from '../../../client/src/chinesepoker-i18n';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

const HAND: Card[] = [
  c(14, 'spades'), c(14, 'hearts'), c(13, 'clubs'), c(12, 'diamonds'), c(11, 'spades'),
  c(10, 'hearts'), c(9, 'clubs'), c(8, 'diamonds'), c(7, 'spades'), c(6, 'hearts'),
  c(5, 'clubs'), c(4, 'diamonds'), c(2, 'spades'),
];

/** Clean: back straight, middle pair of aces, front high card */
const CLEAN: ChinesePokerArrangement = {
  front: [c(5, 'clubs'), c(4, 'diamonds'), c(2, 'spades')],
  middle: [c(14, 'spades'), c(14, 'hearts'), c(8, 'diamonds'), c(7, 'spades'), c(6, 'hearts')],
  back: [c(13, 'clubs'), c(12, 'diamonds'), c(11, 'spades'), c(10, 'hearts'), c(9, 'clubs')],
};

describe('label keys', () => {
  it('maps every category to its Taiwanese name', () => {
    const expected: Record<ChinesePokerCategory, string> = {
      highCard: '烏龍', pair: '一對', twoPair: '兩對', threeOfAKind: '三條', straight: '順子',
      flush: '同花', fullHouse: '葫蘆', fourOfAKind: '鐵支', straightFlush: '同花順',
    };
    for (const [category, label] of Object.entries(expected)) {
      expect(chinesePokerTranslations['zh-TW'][categoryLabelKey(category as ChinesePokerCategory)]).toBe(label);
    }
    expect(chinesePokerTranslations['zh-TW'][rowLabelKey('back')]).toBe('尾墩');
    expect(chinesePokerTranslations['zh-TW']['chinesepoker.foul']).toBe('倒水');
    expect(chinesePokerTranslations['zh-TW']['chinesepoker.shoot']).toBe('打槍');
    expect(chinesePokerTranslations['zh-TW']['chinesepoker.homeRun']).toBe('全壘打');
  });

  it('signs positive scores only', () => {
    expect(signedPoints(3)).toBe('+3');
    expect(signedPoints(0)).toBe('0');
    expect(signedPoints(-4)).toBe('-4');
  });
});

describe('sortCpHand', () => {
  it('sorts by rank high to low or groups by suit', () => {
    const cards = [c(2, 'hearts'), c(14, 'clubs'), c(9, 'hearts'), c(14, 'spades')];
    expect(sortCpHand(cards, 'rank')).toEqual([c(14, 'spades'), c(14, 'clubs'), c(9, 'hearts'), c(2, 'hearts')]);
    expect(sortCpHand(cards, 'suit')).toEqual([c(14, 'spades'), c(9, 'hearts'), c(2, 'hearts'), c(14, 'clubs')]);
    expect(cards[0]).toEqual(c(2, 'hearts'));
  });
});

describe('row placement', () => {
  it('places cards that fit and leaves the rows unchanged otherwise', () => {
    const three = HAND.slice(0, 3);
    const placed = placeCards(EMPTY_ROWS, 'front', three);
    expect(placed.front).toEqual(three);
    expect(placedCount(placed)).toBe(3);
    expect(unplacedCards(HAND, placed)).toEqual(HAND.slice(3));

    expect(canPlace(placed, 'front', [HAND[3]])).toBe(false);
    expect(placeCards(placed, 'front', [HAND[3]])).toBe(placed);
    expect(canPlace(EMPTY_ROWS, 'middle', HAND.slice(0, 6))).toBe(false);
    expect(canPlace(EMPTY_ROWS, 'middle', [])).toBe(false);
  });

  it('moves a card out of its previous row', () => {
    const rows = placeCards(EMPTY_ROWS, 'front', [HAND[0], HAND[1]]);
    const moved = placeCards(rows, 'back', [HAND[1]]);
    expect(moved.front).toEqual([HAND[0]]);
    expect(moved.back).toEqual([HAND[1]]);
    // Cards already in the target row do not count against its space.
    expect(canPlace(moved, 'back', [HAND[1]])).toBe(false);
  });

  it('returns a card to the hand without mutating the input', () => {
    const rows = placeCards(EMPTY_ROWS, 'middle', HAND.slice(0, 2));
    const back = returnCard(rows, { ...HAND[0] });
    expect(back.middle).toEqual([HAND[1]]);
    expect(rows.middle).toEqual(HAND.slice(0, 2));
    expect(unplacedCards(HAND, back)).toContainEqual(HAND[0]);
  });

  it('drops unknown, duplicate, and overflowing cards', () => {
    const dirty: CpRowCards = {
      front: [HAND[0], c(3, 'hearts'), HAND[1], HAND[2], HAND[3]],
      middle: [HAND[0], HAND[4]],
      back: [],
    };
    expect(sanitizeRows(dirty, HAND)).toEqual({ front: HAND.slice(0, 3), middle: [HAND[4]], back: [] });
  });
});

describe('arrangement', () => {
  it('builds only from full rows', () => {
    expect(buildArrangement(placeCards(EMPTY_ROWS, 'front', HAND.slice(0, 3)))).toBeNull();
    const rows = rowsFromArrangement(CLEAN);
    expect(buildArrangement(rows)).toEqual(CLEAN);
    expect(isFoulArrangement(rows)).toBe(false);
    expect(isFoulArrangement(EMPTY_ROWS)).toBe(false);
  });

  it('accepts the best automatic arrangement as clean', () => {
    const rows = rowsFromArrangement(cpBestArrangement(HAND));
    expect(placedCount(rows)).toBe(13);
    expect(isFoulArrangement(rows)).toBe(false);
  });

  it('flags a foul and the row that beats the row below', () => {
    const foul = rowsFromArrangement({ front: CLEAN.front, middle: CLEAN.back, back: CLEAN.middle });
    expect(isFoulArrangement(foul)).toBe(true);
    const hints = rowHints(foul);
    expect(hints.middle).toEqual({ category: 'straight', value: 1, beats: 'back' });
    expect(hints.back).toEqual({ category: 'pair', value: 1, beats: null });
    expect(hints.front.beats).toBeNull();
  });

  it('compares the front with the back while the middle is open', () => {
    const rows: CpRowCards = { front: [c(9, 'clubs'), c(9, 'hearts'), c(2, 'spades')], middle: [], back: CLEAN.middle };
    expect(rowHints(rows).front.beats).toBeNull();
    const weakBack: CpRowCards = {
      front: [c(14, 'spades'), c(14, 'hearts'), c(2, 'spades')], middle: [],
      back: [c(13, 'clubs'), c(12, 'diamonds'), c(10, 'hearts'), c(8, 'diamonds'), c(6, 'hearts')],
    };
    expect(rowHints(weakBack).front).toEqual({ category: 'pair', value: 1, beats: 'back' });
    expect(rowHints(weakBack).middle).toEqual({ category: null, value: 1, beats: null });
  });

  it('reports bonus row values', () => {
    const rows: CpRowCards = { front: [c(9, 'clubs'), c(9, 'hearts'), c(9, 'spades')], middle: [], back: [] };
    expect(rowHints(rows).front.value).toBe(3);
  });
});

describe('rowNet', () => {
  it('sums each seat against all opponents and nets to zero', () => {
    const arrangements: Record<Seat, ChinesePokerArrangement> = {
      N: CLEAN,
      E: { front: CLEAN.front, middle: CLEAN.back, back: CLEAN.middle },
      S: CLEAN,
      W: CLEAN,
    };
    const result = cpMatchResult(arrangements);
    const net = rowNet(result.matchups, 'back');
    // E fouled, so each clean seat wins E's back row once.
    expect(net).toEqual({ N: 1, E: -3, S: 1, W: 1 });
    expect(Object.values(rowNet(result.matchups, 'front')).reduce((sum, value) => sum + value, 0)).toBe(0);
  });
});
