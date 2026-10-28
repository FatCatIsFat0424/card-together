import { describe, expect, it } from 'vitest';
import type { Card, GameSeat } from '@shared/types';
import type { CrazyEightsMatchResult } from '@shared/games/crazyeights/types';
import {
  CE_HANDS, ceCardPoints, ceDeckCount, ceDeckSize, ceEffect, ceHandPoints, ceHandSize, ceIsPlayable, ceLowestSeats,
  ceNeedsSuit, ceNextSeat, cePlayableCards, ceRank, ceTurnOptions,
} from '@shared/rules/crazyeights';
import { crazyEightsDefinition } from '@shared/games/crazyeights/definition';
import { isCrazyEightsOptions } from '@shared/crazyeights-options';
import { parseAction } from '@shared/games/crazyeights/actions';

const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

describe('Crazy Eights deal sizes', () => {
  it('deals seven cards heads-up and five otherwise, with two decks from five players', () => {
    expect([2, 3, 4, 5, 8].map(ceHandSize)).toEqual([7, 5, 5, 5, 5]);
    expect([2, 3, 4, 5, 6, 8].map(ceDeckCount)).toEqual([1, 1, 1, 2, 2, 2]);
    expect([4, 5].map(ceDeckSize)).toEqual([52, 104]);
  });
});

describe('Crazy Eights card points', () => {
  it('scores 8 as 50, face cards as 10, aces as 1, and the rest at face value', () => {
    expect([card('spades', 8), card('hearts', 13), card('clubs', 12), card('diamonds', 11), card('spades', 14),
      card('hearts', 10), card('clubs', 9), card('clubs', 2)].map(ceCardPoints)).toEqual([50, 10, 10, 10, 1, 10, 9, 2]);
    expect(ceHandPoints([card('spades', 8), card('hearts', 14), card('clubs', 5)])).toBe(56);
    expect(ceHandPoints([])).toBe(0);
  });
});

describe('Crazy Eights legality', () => {
  const top = card('hearts', 6);

  it('matches the active suit, the top rank, or an 8', () => {
    expect(ceIsPlayable(card('hearts', 13), top, 'hearts')).toBe(true);
    expect(ceIsPlayable(card('clubs', 6), top, 'hearts')).toBe(true);
    expect(ceIsPlayable(card('clubs', 8), top, 'hearts')).toBe(true);
    expect(ceIsPlayable(card('clubs', 7), top, 'hearts')).toBe(false);
  });

  it('follows the declared suit instead of the 8 that was played', () => {
    const wild = card('spades', 8);
    expect(ceIsPlayable(card('spades', 5), wild, 'diamonds')).toBe(false);
    expect(ceIsPlayable(card('diamonds', 5), wild, 'diamonds')).toBe(true);
    expect(ceIsPlayable(card('clubs', 8), wild, 'diamonds')).toBe(true);
  });

  it('lists the playable cards and the turn options', () => {
    const hand = [card('clubs', 3), card('hearts', 9), card('spades', 8)];
    expect(cePlayableCards(hand, top, 'hearts')).toEqual([card('hearts', 9), card('spades', 8)]);
    expect(ceTurnOptions(hand, top, 'hearts', false, 10)).toMatchObject({ canDraw: false, canPass: false });
    const stuck = [card('clubs', 3), card('clubs', 9)];
    expect(ceTurnOptions(stuck, top, 'hearts', false, 10)).toMatchObject({ playable: [], canDraw: true, canPass: false });
    expect(ceTurnOptions(stuck, top, 'hearts', false, 0)).toMatchObject({ canDraw: false, canPass: true });
    expect(ceTurnOptions(stuck, top, 'hearts', true, 10)).toMatchObject({ canDraw: false, canPass: true });
  });

  it('asks for a suit on an 8 unless it is the last card', () => {
    expect(ceNeedsSuit(card('clubs', 8), 3)).toBe(true);
    expect(ceNeedsSuit(card('clubs', 8), 1)).toBe(false);
    expect(ceNeedsSuit(card('clubs', 9), 3)).toBe(false);
  });
});

describe('Crazy Eights action cards', () => {
  it('maps 2, Q and A only when the option is on', () => {
    const cards = [card('hearts', 2), card('hearts', 12), card('hearts', 14), card('hearts', 8), card('hearts', 5)];
    expect(cards.map((entry) => ceEffect(entry, true))).toEqual(['draw', 'skip', 'reverse', null, null]);
    expect(cards.map((entry) => ceEffect(entry, false))).toEqual([null, null, null, null, null]);
  });
});

describe('Crazy Eights seat order', () => {
  const seats: GameSeat[] = ['N', 'S', 'P5'];

  it('steps through occupied seats in the current direction and wraps', () => {
    expect(ceNextSeat(seats, 'N', 'ccw')).toBe('P5');
    expect(ceNextSeat(seats, 'P5', 'ccw')).toBe('S');
    expect(ceNextSeat(seats, 'S', 'ccw')).toBe('N');
    expect(ceNextSeat(seats, 'N', 'cw')).toBe('S');
    expect(ceNextSeat(seats, 'P5', 'cw')).toBe('N');
  });

  it('returns to the same seat when it sits alone', () => {
    expect(ceNextSeat(['E'], 'E', 'cw')).toBe('E');
  });
});

describe('Crazy Eights standings', () => {
  const result: CrazyEightsMatchResult = {
    gameType: 'crazyeights', seats: ['N', 'E', 'S', 'W'], hands: CE_HANDS, handWinners: ['N', 'E', 'N'],
    scores: { N: 10, E: 10, S: 35, W: 60, P5: 0, P6: 0, P7: 0, P8: 0 }, winners: ['N', 'E'],
  };

  it('ranks the lowest totals first and lets ties share the win', () => {
    expect(ceLowestSeats(['N', 'E', 'S', 'W'], result.scores)).toEqual(['N', 'E']);
    expect(['N', 'E', 'S', 'W'].map((seat) => ceRank(result, seat as GameSeat))).toEqual([1, 1, 3, 4]);
    const standings = (['N', 'E', 'S', 'W'] as const).map((seat) =>
      crazyEightsDefinition.result.standing(result, seat, result.seats ?? []));
    expect(standings.map((entry) => [entry.rank, entry.tied, entry.won, entry.score]))
      .toEqual([[1, true, true, 10], [1, true, true, 10], [3, false, false, 35], [4, false, false, 60]]);
  });
});

describe('Crazy Eights options and actions', () => {
  it('accepts exactly the actionCards flag', () => {
    expect(isCrazyEightsOptions({ actionCards: true })).toBe(true);
    expect(isCrazyEightsOptions({ actionCards: 1 })).toBe(false);
    expect(isCrazyEightsOptions({ actionCards: false, extra: true })).toBe(false);
    expect(isCrazyEightsOptions(null)).toBe(false);
  });

  it('rebuilds actions from untrusted input', () => {
    expect(parseAction({ type: 'draw', junk: 1 })).toEqual({ type: 'draw' });
    expect(parseAction({ type: 'pass' })).toEqual({ type: 'pass' });
    expect(parseAction({ type: 'play', card: { suit: 'clubs', rank: 8, id: 3 }, suit: 'hearts' }))
      .toEqual({ type: 'play', card: card('clubs', 8), suit: 'hearts' });
    expect(parseAction({ type: 'play', card: card('clubs', 8) })).toEqual({ type: 'play', card: card('clubs', 8) });
    expect(typeof parseAction({ type: 'play', card: card('clubs', 8), suit: 'stars' })).toBe('string');
    expect(typeof parseAction({ type: 'play', card: { suit: 'clubs', rank: 1 } })).toBe('string');
    expect(typeof parseAction({ type: 'steal' })).toBe('string');
  });
});
