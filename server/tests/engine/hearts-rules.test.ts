import { describe, expect, it } from 'vitest';
import type { Card, Seat } from '@shared/types';
import type { HeartsTrickRecord } from '@shared/games/hearts/types';
import { HEARTS_SEATS, heartsPassDirection, heartsPassTarget, heartsPassError, heartsValidCards,
  heartsTrickWinner, heartsPenalty, scoreHeartsHand, heartsWinners } from '@shared/rules/hearts';
import { parseAction } from '@shared/games/hearts/actions';
import { matchStanding } from '@shared/rules/match-standing';
const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const C2 = c('clubs', 2), CA = c('clubs', 14), H2 = c('hearts', 2), SQ = c('spades', 12), D2 = c('diamonds', 2);

describe('Hearts pure rules', () => {
  it('cycles left, right, across, hold and routes every compass seat', () => {
    expect(Array.from({ length: 8 }, (_, index) => heartsPassDirection(index + 1)))
      .toEqual(['left', 'right', 'across', 'hold', 'left', 'right', 'across', 'hold']);
    for (const seat of HEARTS_SEATS) {
      expect(heartsPassTarget(heartsPassTarget(seat, 'left'), 'right')).toBe(seat);
      expect(heartsPassTarget(heartsPassTarget(seat, 'across'), 'across')).toBe(seat);
      expect(heartsPassTarget(seat, 'hold')).toBe(seat);
    }
    expect(HEARTS_SEATS.map((seat) => heartsPassTarget(seat, 'left'))).toEqual(['E', 'S', 'W', 'N']);
  });
  it('requires exactly three unique held cards and sanitizes wire actions', () => {
    const hand = [C2, H2, SQ, D2];
    expect(heartsPassError(hand, [C2, H2, SQ])).toBeNull();
    for (const cards of [[C2], [C2, C2, H2], [C2, H2, CA]]) expect(heartsPassError(hand, cards)).not.toBeNull();
    expect(parseAction({ type: 'pass', cards: [C2, H2, SQ], extra: 'ignored' })).toEqual({ type: 'pass', cards: [C2, H2, SQ] });
    for (const value of [{ type: 'pass', cards: [C2, C2, SQ] }, { type: 'play', card: { ...C2, hidden: 1 } },
      { type: 'play', card: { joker: 'big' } }, { type: 'play', card: { suit: 'clubs', rank: 1 } }, null]) {
      expect(typeof parseAction(value)).toBe('string');
    }
  });
  it('opens with C2, follows suit and excludes first-trick penalty discards when possible', () => {
    const hand = Object.freeze([C2, CA, H2, SQ, D2]);
    const empty = { leadSeat: 'N' as const, plays: [] };
    const led = { leadSeat: 'E' as const, plays: [{ seat: 'E' as const, card: CA }] };
    expect(heartsValidCards(hand, empty, true, false)).toEqual([C2]);
    expect(heartsValidCards(hand, led, true, false)).toEqual([C2, CA]);
    expect(heartsValidCards([H2, SQ, D2], led, true, false)).toEqual([D2]);
    expect(heartsValidCards([H2, SQ], led, true, false)).toEqual([H2, SQ]);
    expect(heartsValidCards([H2, SQ, D2], led, false, false)).toEqual([H2, SQ, D2]);
    expect(hand).toEqual([C2, CA, H2, SQ, D2]);
  });
  it('holds hearts back until broken, except an all-heart hand', () => {
    const trick = { leadSeat: 'N' as const, plays: [] };
    expect(heartsValidCards([H2, SQ, D2], trick, false, false)).toEqual([SQ, D2]);
    expect(heartsValidCards([H2, SQ], trick, false, true)).toEqual([H2, SQ]);
    expect(heartsValidCards([H2], trick, false, false)).toEqual([H2]);
  });
  it('awards the highest led-suit card; other suits never trump', () => {
    expect(heartsTrickWinner({ leadSeat: 'N', plays: [
      { seat: 'N', card: C2 }, { seat: 'E', card: H2 }, { seat: 'S', card: CA }, { seat: 'W', card: SQ },
    ] })).toBe('S');
    expect(() => heartsTrickWinner({ leadSeat: 'N', plays: [] })).toThrow();
    expect([C2, H2, SQ].map(heartsPenalty)).toEqual([0, 1, 13]);
  });
  it('shoots the moon and supports tied lowest match winners', () => {
    const penaltyCards: Card[] = Array.from({ length: 13 }, (_, index) => c('hearts', (index + 2) as Card['rank']));
    const record: HeartsTrickRecord = { leadSeat: 'N', winner: 'N', plays: [...penaltyCards, SQ].map((card) => ({ seat: 'N', card })) };
    expect(scoreHeartsHand([record])).toEqual({ penalties: { N: 26, E: 0, S: 0, W: 0 },
      added: { N: 0, E: 26, S: 26, W: 26 }, moon: 'N' });
    const scores: Record<Seat, number> = { N: 10, E: 100, S: 10, W: 25 };
    expect(heartsWinners(scores)).toEqual(['N', 'S']);
    const result = { gameType: 'hearts' as const, scores, winners: heartsWinners(scores), hands: [] };
    expect(matchStanding(result, 'N')).toMatchObject({ won: true, tied: true, rank: 1, score: 10 });
    expect(matchStanding(result, 'W')).toMatchObject({ won: false, tied: false, rank: 3, score: 25 });
    expect(matchStanding(result, 'E')?.rank).toBe(4);
  });
});
