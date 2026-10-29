import { describe, expect, it } from 'vitest';
import {
  DDZ_DEALS, DDZ_HAND_SIZE, ddzAuction, ddzBeats, ddzCanPlay, ddzCombos, ddzDeal, ddzIdentify, ddzMoves, ddzNextSeat,
  ddzPower, ddzResolve, ddzSettle, ddzSmallestMove, ddzWinners, createDdzDeck, sortDdzHand,
} from '@shared/rules/doudizhu';
import type { DdzBidEntry, DdzCombo } from '@shared/rules/doudizhu';
import { ddzReplay, ddzStake } from '@shared/rules/doudizhu-table';
import { cardKey, joker } from '@shared/rules/cards';
import type { CardOrJoker, GameSeat } from '@shared/types';
import type { DouDizhuLogEntry } from '@shared/types';

const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'] as const;

/** `3 3 4` style shorthand: ranks as written, suits cycling so equal ranks stay distinct. */
function hand(text: string): CardOrJoker[] {
  const used = new Map<string, number>();
  return text.split(/\s+/).filter(Boolean).map((token): CardOrJoker => {
    if (token === 'SJ') return joker('small');
    if (token === 'BJ') return joker('big');
    const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[token] ?? Number(token);
    const seen = used.get(token) ?? 0;
    used.set(token, seen + 1);
    return { suit: SUITS[seen], rank: rank as 2 };
  });
}

const identify = (text: string): DdzCombo | null => ddzIdentify(hand(text));
const kinds = (text: string): string[] => ddzCombos(hand(text)).map((combo) => `${combo.type}:${combo.power}:${combo.length}`);

describe('Dou Dizhu card order', () => {
  it('ranks 3 lowest, 2 above ace, then the small and big jokers', () => {
    const powers = ['3', 'K', 'A', '2', 'SJ', 'BJ'].map((token) => ddzPower(hand(token)[0]));
    expect(powers).toEqual([3, 13, 14, 15, 16, 17]);
    expect(sortDdzHand(hand('3 BJ 2 A SJ 3')).map(ddzPower)).toEqual([17, 16, 15, 14, 3, 3]);
  });

  it('uses 54 distinct cards', () => {
    const deck = createDdzDeck();
    expect(deck).toHaveLength(54);
    expect(new Set(deck.map(cardKey)).size).toBe(54);
  });
});

describe('Dou Dizhu combination detection', () => {
  it('reads the basic shapes', () => {
    expect(identify('5')).toMatchObject({ type: 'single', power: 5 });
    expect(identify('5 5')).toMatchObject({ type: 'pair', power: 5 });
    expect(identify('9 9 9')).toMatchObject({ type: 'triple', power: 9 });
    expect(identify('9 9 9 4')).toMatchObject({ type: 'tripleSingle', power: 9 });
    expect(identify('9 9 9 4 4')).toMatchObject({ type: 'triplePair', power: 9 });
    expect(identify('7 7 7 7')).toMatchObject({ type: 'bomb', power: 7 });
    expect(identify('SJ BJ')).toMatchObject({ type: 'rocket' });
  });

  it('rejects mismatched pairs, jokers as a pair, and duplicate cards', () => {
    expect(identify('5 6')).toBeNull();
    expect(identify('SJ SJ')).toBeNull();
    expect(identify('5 5 5 4 5')).toBeNull();
    expect(identify('3 3 3 4 5')).toBeNull();
    expect(ddzCombos([hand('5')[0], hand('5')[0]])).toEqual([]);
    expect(identify('')).toBeNull();
  });

  it('reads straights of five or more from 3 to ace, never through 2 or the jokers', () => {
    expect(identify('3 4 5 6 7')).toMatchObject({ type: 'straight', power: 3, length: 5 });
    expect(identify('10 J Q K A')).toMatchObject({ type: 'straight', power: 10, length: 5 });
    expect(identify('3 4 5 6')).toBeNull();
    expect(identify('J Q K A 2')).toBeNull();
    expect(identify('10 J Q K A 2')).toBeNull();
    expect(identify('3 4 5 6 8')).toBeNull();
    expect(identify('9 10 J Q K SJ')).toBeNull();
  });

  it('reads consecutive pairs of three or more', () => {
    expect(identify('3 3 4 4 5 5')).toMatchObject({ type: 'pairStraight', power: 3, length: 3 });
    expect(identify('Q Q K K A A')).toMatchObject({ type: 'pairStraight', power: 12, length: 3 });
    expect(identify('3 3 4 4')).toBeNull();
    expect(identify('K K A A 2 2')).toBeNull();
    expect(identify('3 3 4 4 6 6')).toBeNull();
  });

  it('reads airplanes with and without wings', () => {
    expect(identify('3 3 3 4 4 4')).toMatchObject({ type: 'airplane', power: 3, length: 2 });
    expect(identify('3 3 3 4 4 4 9 J')).toMatchObject({ type: 'airplaneSingle', power: 3, length: 2 });
    expect(identify('3 3 3 4 4 4 9 9 J J')).toMatchObject({ type: 'airplanePair', power: 3, length: 2 });
    expect(identify('3 3 3 4 4 4 5 5 5 7 8 9')).toMatchObject({ type: 'airplaneSingle', length: 3 });
    expect(identify('K K K A A A')).toMatchObject({ type: 'airplane', power: 13 });
    expect(identify('A A A 2 2 2')).toBeNull();
    expect(identify('3 3 3 5 5 5')).toBeNull();
    expect(identify('3 3 3 4 4 4 9 9 J')).toBeNull();
  });

  it('lets an airplane read several ways and picks the one that beats the previous play', () => {
    expect(kinds('4 4 4 5 5 5 6 6 6 3 3 3').sort()).toEqual(
      ['airplane:3:4', 'airplaneSingle:3:3', 'airplaneSingle:4:3'].sort());
    const previous: DdzCombo = { type: 'airplaneSingle', power: 3, length: 3, size: 12 };
    expect(ddzResolve(hand('4 4 4 5 5 5 6 6 6 3 3 3'), previous)).toMatchObject({ type: 'airplaneSingle', power: 4 });
  });

  it('keeps the rocket out of wings and kickers', () => {
    expect(identify('3 3 3 4 4 4 SJ BJ')).toBeNull();
    expect(identify('3 3 3 3 SJ BJ')).toBeNull();
    expect(identify('3 3 3 3 SJ 5')).toMatchObject({ type: 'fourSingles', power: 3 });
  });

  it('reads four with two singles or two pairs', () => {
    expect(identify('8 8 8 8 3 4')).toMatchObject({ type: 'fourSingles', power: 8 });
    expect(identify('8 8 8 8 3 3')).toMatchObject({ type: 'fourSingles', power: 8 });
    expect(identify('8 8 8 8 3 3 5 5')).toMatchObject({ type: 'fourPairs', power: 8 });
    expect(identify('8 8 8 8 3 3 5 6')).toBeNull();
    expect(identify('8 8 8 8 3')).toBeNull();
  });
});

describe('Dou Dizhu comparison', () => {
  const combo = (text: string): DdzCombo => identify(text)!;

  it('needs the same shape and a higher rank', () => {
    expect(ddzBeats(combo('6'), combo('5'))).toBe(true);
    expect(ddzBeats(combo('2'), combo('A'))).toBe(true);
    expect(ddzBeats(combo('SJ'), combo('2'))).toBe(true);
    expect(ddzBeats(combo('BJ'), combo('SJ'))).toBe(true);
    expect(ddzBeats(combo('5'), combo('5'))).toBe(false);
    expect(ddzBeats(combo('6 6'), combo('5'))).toBe(false);
    expect(ddzBeats(combo('3 4 5 6 7 8'), combo('4 5 6 7 8'))).toBe(false);
    expect(ddzBeats(combo('4 5 6 7 8'), combo('3 4 5 6 7'))).toBe(true);
    expect(ddzBeats(combo('4 4 4 9'), combo('3 3 3 7'))).toBe(true);
    expect(ddzBeats(combo('4 4 4 9 9'), combo('3 3 3 7'))).toBe(false);
  });

  it('lets a bomb beat anything but a bigger bomb, and the rocket beat everything', () => {
    expect(ddzBeats(combo('3 3 3 3'), combo('2'))).toBe(true);
    expect(ddzBeats(combo('3 3 3 3'), combo('A A A 9 9'))).toBe(true);
    expect(ddzBeats(combo('3 3 3 3'), combo('4 4 4 4'))).toBe(false);
    expect(ddzBeats(combo('5 5 5 5'), combo('4 4 4 4'))).toBe(true);
    expect(ddzBeats(combo('SJ BJ'), combo('2 2 2 2'))).toBe(true);
    expect(ddzBeats(combo('2 2 2 2'), combo('SJ BJ'))).toBe(false);
  });

  it('checks the cards are held and legal', () => {
    const own = hand('3 3 4 5 6 7 8 K');
    expect(ddzCanPlay(own, hand('3 3'), null)).toBe(true);
    expect(ddzCanPlay(own, hand('9'), null)).toBe(false);
    expect(ddzCanPlay(own, hand('3 4 5 6 7'), null)).toBe(true);
    expect(ddzCanPlay(own, hand('3 4 5 6 7'), combo('5 6 7 8 9'))).toBe(false);
    expect(ddzCanPlay(own, [], null)).toBe(false);
  });
});

describe('Dou Dizhu move enumeration', () => {
  it('lists leads for every shape the hand holds', () => {
    const own = hand('3 3 3 4 5 6 7 8 8 8 8 K K SJ BJ');
    const types = new Set(ddzMoves(own, null).map((move) => move.combo.type));
    for (const type of ['single', 'pair', 'triple', 'tripleSingle', 'triplePair', 'straight', 'bomb', 'rocket', 'fourSingles', 'fourPairs']) {
      expect(types.has(type as DdzCombo['type']), type).toBe(true);
    }
    for (const move of ddzMoves(own, null)) expect(ddzCombos(move.cards).some((c) => c.type === move.combo.type
      && c.power === move.combo.power && c.length === move.combo.length), JSON.stringify(move.combo)).toBe(true);
  });

  it('lists only plays that beat the previous one', () => {
    const own = hand('3 4 5 6 7 8 9 9 9 9 SJ BJ');
    const previous = identify('4 5 6 7 8')!;
    const moves = ddzMoves(own, previous);
    expect(moves.every((move) => ddzBeats(move.combo, previous))).toBe(true);
    expect(moves.some((move) => move.combo.type === 'straight' && move.combo.power === 5)).toBe(true);
    expect(moves.some((move) => move.combo.type === 'rocket')).toBe(true);
    expect(ddzMoves(hand('3 4'), identify('2 2')!)).toEqual([]);
  });

  it('builds airplanes with the cheapest wings that keep other groups', () => {
    const own = hand('3 3 3 4 4 4 5 5 7 9 9 9 9 K');
    const wings = ddzMoves(own, null).find((move) => move.combo.type === 'airplaneSingle')!;
    expect(wings.cards).toHaveLength(8);
    expect(wings.cards.filter((card) => ddzPower(card) === 5)).toHaveLength(0);
  });

  it('picks the smallest legal play, saving bombs and the rocket for last', () => {
    expect(ddzSmallestMove(hand('5 5 9 K'), null)).toMatchObject({ combo: { type: 'pair', power: 5 } });
    expect(ddzSmallestMove(hand('5 9 K'), identify('8')!)).toMatchObject({ combo: { type: 'single', power: 9 } });
    expect(ddzSmallestMove(hand('3 3 3 3 5'), identify('A')!)).toMatchObject({ combo: { type: 'bomb' } });
    expect(ddzSmallestMove(hand('3 4 SJ BJ'), identify('2')!)).toMatchObject({ combo: { type: 'single', power: 16 } });
    expect(ddzSmallestMove(hand('3 4'), identify('2')!)).toBeNull();
  });
});

describe('Dou Dizhu score auction', () => {
  const seats: GameSeat[] = ['N', 'E', 'S'];
  const bid = (seat: GameSeat, score: 0 | 1 | 2 | 3): DdzBidEntry => ({ kind: 'score', seat, score });

  it('goes round from the first caller and requires a higher bid', () => {
    expect(ddzAuction('score', seats, 'E', [])).toMatchObject({ done: false, turn: 'E', minScore: 1 });
    expect(ddzAuction('score', seats, 'E', [bid('E', 1)])).toMatchObject({ done: false, turn: 'S', minScore: 2 });
    expect(ddzAuction('score', seats, 'E', [bid('E', 2), bid('S', 0)])).toMatchObject({ turn: 'N', minScore: 3 });
  });

  it('ends at once on a 3 and gives the highest bidder the landlord after three turns', () => {
    expect(ddzAuction('score', seats, 'N', [bid('N', 1), bid('E', 3)])).toEqual({ done: true, landlord: 'E', base: 3, grabs: 0 });
    expect(ddzAuction('score', seats, 'N', [bid('N', 1), bid('E', 0), bid('S', 2)]))
      .toEqual({ done: true, landlord: 'S', base: 2, grabs: 0 });
    expect(ddzAuction('score', seats, 'N', [bid('N', 2), bid('E', 0), bid('S', 0)]))
      .toEqual({ done: true, landlord: 'N', base: 2, grabs: 0 });
  });

  it('voids the deal when nobody bids', () => {
    expect(ddzAuction('score', seats, 'S', [bid('S', 0), bid('N', 0), bid('E', 0)]))
      .toEqual({ done: true, landlord: null, base: 0, grabs: 0 });
  });
});

describe('Dou Dizhu grab auction', () => {
  const seats: GameSeat[] = ['N', 'E', 'S'];
  const claim = (seat: GameSeat, take: boolean): DdzBidEntry => ({ kind: 'claim', seat, take });

  it('lets the first caller keep the deal when nobody grabs', () => {
    expect(ddzAuction('grab', seats, 'N', [claim('N', false), claim('E', true)])).toMatchObject({ done: false, turn: 'S', mode: 'grab' });
    expect(ddzAuction('grab', seats, 'N', [claim('N', false), claim('E', true), claim('S', false), claim('N', false)]))
      .toEqual({ done: true, landlord: 'E', base: 1, grabs: 0 });
  });

  it('gives the caller one answer after a grab and doubles for each grab', () => {
    const grabbed = [claim('N', true), claim('E', true), claim('S', false)];
    expect(ddzAuction('grab', seats, 'N', grabbed)).toMatchObject({ done: false, turn: 'N', mode: 'grab' });
    expect(ddzAuction('grab', seats, 'N', [...grabbed, claim('N', true)])).toEqual({ done: true, landlord: 'N', base: 1, grabs: 2 });
    expect(ddzAuction('grab', seats, 'N', [...grabbed, claim('N', false)])).toEqual({ done: true, landlord: 'E', base: 1, grabs: 1 });
  });

  it('asks the seats after the caller in order and skips the answer when nobody grabbed', () => {
    expect(ddzAuction('grab', seats, 'N', [claim('N', false), claim('E', false), claim('S', true)])).toMatchObject({ turn: 'N', mode: 'grab' });
    expect(ddzAuction('grab', seats, 'N', [claim('N', true), claim('E', false), claim('S', false)]))
      .toEqual({ done: true, landlord: 'N', base: 1, grabs: 0 });
  });

  it('voids the deal when nobody calls', () => {
    expect(ddzAuction('grab', seats, 'E', [claim('E', false), claim('S', false), claim('N', false)]))
      .toEqual({ done: true, landlord: null, base: 0, grabs: 0 });
  });
});

describe('Dou Dizhu scoring', () => {
  const seats: GameSeat[] = ['N', 'E', 'S'];
  const settle = (winner: GameSeat, plays: Partial<Record<GameSeat, number>>, base = 2, doublings = 0) =>
    ddzSettle({ seats, landlord: 'N', winner, base, doublings, plays });

  it('pays the landlord twice what each farmer pays', () => {
    expect(settle('N', { N: 5, E: 3, S: 2 }).scores).toEqual({ N: 4, E: -2, S: -2 });
    expect(settle('E', { N: 5, E: 3, S: 4 }).scores).toEqual({ N: -4, E: 2, S: 2 });
  });

  it('doubles for each bomb, rocket, or grab', () => {
    expect(settle('N', { N: 5, E: 3, S: 2 }, 3, 2).multiplier).toBe(12);
  });

  it('doubles a spring when both farmers never played', () => {
    const spring = settle('N', { N: 6, E: 0, S: 0 });
    expect(spring).toMatchObject({ spring: true, multiplier: 4 });
    expect(spring.scores).toEqual({ N: 8, E: -4, S: -4 });
    expect(settle('N', { N: 6, E: 1, S: 0 }).spring).toBe(false);
  });

  it('doubles an anti-spring when the landlord played only once', () => {
    const anti = settle('S', { N: 1, E: 3, S: 4 });
    expect(anti).toMatchObject({ antiSpring: true, spring: false, multiplier: 4 });
    expect(anti.scores).toEqual({ N: -8, E: 4, S: 4 });
    expect(settle('S', { N: 2, E: 3, S: 4 }).antiSpring).toBe(false);
  });

  it('names the highest total as winner, ties included', () => {
    const totals = { N: 5, E: 5, S: -10 } as Record<GameSeat, number>;
    expect(ddzWinners(seats, totals)).toEqual(['N', 'E']);
    expect(DDZ_DEALS).toBe(6);
  });
});

describe('Dou Dizhu deal', () => {
  it('gives each seat 17 cards and leaves three for the bottom, using every card once', () => {
    const seats: GameSeat[] = ['N', 'E', 'S'];
    const dealt = ddzDeal(seats, createDdzDeck());
    expect(seats.map((seat) => dealt.hands[seat].length)).toEqual([DDZ_HAND_SIZE, DDZ_HAND_SIZE, DDZ_HAND_SIZE]);
    expect(dealt.bottom).toHaveLength(3);
    const all = [...seats.flatMap((seat) => dealt.hands[seat]), ...dealt.bottom];
    expect(new Set(all.map(cardKey)).size).toBe(54);
    expect(ddzNextSeat(seats, 'S')).toBe('N');
  });
});

describe('Dou Dizhu replay', () => {
  const seats: GameSeat[] = ['N', 'E', 'S'];
  const single = (seat: GameSeat, text: string): DouDizhuLogEntry => ({ type: 'play', seat,
    cards: hand(text), combo: identify(text)!, timestamp: 0 });
  const log: DouDizhuLogEntry[] = [
    { type: 'deal', deal: 1, redeal: 0, firstCaller: 'N', timestamp: 0 },
    { type: 'bid', seat: 'N', score: 1, timestamp: 0 },
    { type: 'bid', seat: 'E', score: 3, timestamp: 0 },
    { type: 'landlord', seat: 'E', base: 3, grabs: 0, forced: false, bottom: hand('3 4 5'), timestamp: 0 },
    single('E', '7'),
    { type: 'pass', seat: 'S', timestamp: 0 },
    { type: 'pass', seat: 'N', timestamp: 0 },
    { type: 'round_end', leaderSeat: 'E', timestamp: 0 },
    single('E', '4 4 4 4'),
  ];

  it('follows the auction, the landlord reveal, and the play', () => {
    const calling = ddzReplay('score', seats, log, 2);
    expect(calling).toMatchObject({ phase: 'calling', turn: 'E', landlord: null });
    expect(calling.counts).toMatchObject({ N: 17, E: 17, S: 17 });
    const playing = ddzReplay('score', seats, log, 4);
    expect(playing).toMatchObject({ phase: 'playing', landlord: 'E', turn: 'E', base: 3 });
    expect(playing.counts.E).toBe(20);
    const after = ddzReplay('score', seats, log);
    expect(after.counts.E).toBe(15);
    expect(after).toMatchObject({ bombs: 1, turn: 'S', passes: 0 });
    expect(ddzStake(after)).toBe(6);
  });

  it('clears the round when its leader takes the lead again', () => {
    const round = ddzReplay('score', seats, log, 8);
    expect(round).toMatchObject({ lastPlay: null, turn: 'E', passes: 0 });
    expect(ddzReplay('score', seats, log, 6)).toMatchObject({ passes: 1, turn: 'N' });
  });
});
