import { describe, expect, it } from 'vitest';
import type { Card, GameSeat } from '@shared/types';
import type { GoFishMatchResult } from '@shared/games/gofish/types';
import {
  GF_BOOKS_PER_HAND, GF_HANDS, gfCompleteBooks, gfCount, gfHandSize, gfLeaders, gfNextSeat, gfRank, gfRanks, gfTargets,
} from '@shared/rules/gofish';
import { goFishDefinition } from '@shared/games/gofish/definition';
import { parseAction } from '@shared/games/gofish/actions';

const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const zero = { N: 0, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };

describe('Go Fish deal sizes', () => {
  it('deals seven cards to two or three players and five otherwise', () => {
    expect([2, 3, 4, 5, 6].map(gfHandSize)).toEqual([7, 7, 5, 5, 5]);
    expect(GF_BOOKS_PER_HAND).toBe(13);
    expect(GF_HANDS).toBe(3);
  });
});

describe('Go Fish hands', () => {
  const hand = [card('spades', 7), card('hearts', 7), card('clubs', 14), card('diamonds', 2)];

  it('counts a rank and lists the ranks held, highest first', () => {
    expect(gfCount(hand, 7)).toBe(2);
    expect(gfCount(hand, 9)).toBe(0);
    expect(gfRanks(hand)).toEqual([14, 7, 2]);
  });

  it('finds complete books only at four cards', () => {
    const books = [card('spades', 9), card('hearts', 9), card('clubs', 9), card('diamonds', 9), card('clubs', 3), card('hearts', 3)];
    expect(gfCompleteBooks(books)).toEqual([9]);
    expect(gfCompleteBooks(books.slice(1))).toEqual([]);
  });
});

describe('Go Fish seats', () => {
  const seats: GameSeat[] = ['N', 'S', 'P5'];

  it('asks only other seats that hold cards', () => {
    const counts = { ...zero, N: 3, S: 0, P5: 2 };
    expect(gfTargets(seats, counts, 'N')).toEqual(['P5']);
    expect(gfTargets(seats, { ...counts, S: 4 }, 'P5')).toEqual(['N', 'S']);
  });

  it('passes the turn to the next occupied seat, wrapping around', () => {
    expect(gfNextSeat(seats, 'N')).toBe('S');
    expect(gfNextSeat(seats, 'S')).toBe('P5');
    expect(gfNextSeat(seats, 'P5')).toBe('N');
  });
});

describe('Go Fish ranking', () => {
  const result: GoFishMatchResult = {
    gameType: 'gofish', seats: ['N', 'E', 'S', 'W'], hands: 3, scores: { ...zero, N: 12, E: 12, S: 3, W: 12 },
    winners: ['N', 'E', 'W'], handBooks: [],
  };

  it('picks the highest total, with equal totals sharing first', () => {
    expect(gfLeaders(['N', 'E', 'S', 'W'], result.scores)).toEqual(['N', 'E', 'W']);
    expect(gfLeaders(['N', 'S'], result.scores)).toEqual(['N']);
    expect(['N', 'E', 'S', 'W'].map((seat) => gfRank(result, seat as GameSeat))).toEqual([1, 1, 4, 1]);
  });

  it('records standings through the shared definition, ties for first counting as wins', () => {
    const seats = result.seats!;
    const standing = (seat: GameSeat) => goFishDefinition.result.standing(result, seat, seats);
    expect(standing('E')).toMatchObject({ rank: 1, tied: true, won: true, score: 12, players: 4 });
    expect(standing('S')).toMatchObject({ rank: 4, tied: false, won: false, score: 3 });
  });
});

describe('Go Fish actions', () => {
  it('accepts an ask with a seat and a rank', () => {
    expect(parseAction({ type: 'ask', target: 'E', rank: 7 })).toEqual({ type: 'ask', target: 'E', rank: 7 });
    expect(parseAction({ type: 'ask', target: 'P6', rank: 14, extra: true })).toEqual({ type: 'ask', target: 'P6', rank: 14 });
  });

  it.each([
    [{ type: 'draw' }, 'Invalid action.'],
    [null, 'Invalid action.'],
    [{ type: 'ask', target: 'X', rank: 7 }, 'Invalid player.'],
    [{ type: 'ask', rank: 7 }, 'Invalid player.'],
    [{ type: 'ask', target: 'E', rank: 1 }, 'Invalid rank.'],
    [{ type: 'ask', target: 'E', rank: 15 }, 'Invalid rank.'],
    [{ type: 'ask', target: 'E', rank: 7.5 }, 'Invalid rank.'],
    [{ type: 'ask', target: 'E', rank: '7' }, 'Invalid rank.'],
  ])('rejects malformed action %#', (action, error) => {
    expect(parseAction(action)).toBe(error);
  });
});
