import { describe, expect, it } from 'vitest';
import type { Card, Seat } from '@shared/types';
import { parseAction } from '@shared/games/spades/actions';
import { applySpadesMove, newSpadesHand, scoreSpadesHand, spadesLegalCards, spadesTrickWinner, spadesWinners } from '@shared/rules/spades';

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const bids = { N: 3, E: 3, S: 3, W: 3 };

describe('Spades pure rules', () => {
  it('starts at dealer left, accepts one integer bid each, and preserves inputs', () => {
    let p = newSpadesHand('N');
    const original = structuredClone(p);
    expect(applySpadesMove(p, 'N', [], { type: 'bid', bid: 3 })).toBeNull();
    for (const bad of [-1, 14, 1.5, NaN, Infinity]) expect(applySpadesMove(p, 'E', [], { type: 'bid', bid: bad })).toBeNull();
    const first = applySpadesMove(p, 'E', [], { type: 'bid', bid: 0 });
    expect(p).toEqual(original);
    expect(first?.bids.E).toBe(0);
    for (const seat of ['E', 'S', 'W', 'N'] as Seat[]) p = applySpadesMove(p, seat, [], { type: 'bid', bid: 13 })!;
    expect(p.phase).toBe('playing');
    expect(p.currentTurnSeat).toBe('E');
    expect(applySpadesMove(p, 'E', [], { type: 'bid', bid: 1 })).toBeNull();
  });
  it('follows suit, allows first-trick trump when void, and restricts unbroken leads', () => {
    const hand = [c('clubs', 2), c('spades', 14), c('hearts', 10)];
    const before = structuredClone(hand);
    expect(spadesLegalCards(hand, [], false)).toEqual([hand[0], hand[2]]);
    expect(spadesLegalCards([hand[1]], [], false)).toEqual([hand[1]]);
    expect(spadesLegalCards(hand, [], true)).toEqual(hand);
    expect(spadesLegalCards(hand, [{ seat: 'N', card: c('clubs', 14) }], false)).toEqual([hand[0]]);
    expect(spadesLegalCards(hand, [{ seat: 'N', card: c('diamonds', 14) }], false)).toEqual(hand);
    expect(hand).toEqual(before);
    expect(spadesTrickWinner([{ seat: 'N', card: c('clubs', 14) }, { seat: 'E', card: c('hearts', 14) }])).toBe('N');
    expect(spadesTrickWinner([{ seat: 'N', card: c('clubs', 14) }, { seat: 'E', card: c('spades', 2) },
      { seat: 'S', card: c('spades', 3) }])).toBe('S');
  });
  it('breaks spades, awards a trick, and lets its winner lead', () => {
    let p = newSpadesHand('W');
    for (const seat of ['N', 'E', 'S', 'W'] as Seat[]) p = applySpadesMove(p, seat, [], { type: 'bid', bid: 3 })!;
    const plays = [c('clubs', 14), c('spades', 2), c('clubs', 3), c('clubs', 4)];
    for (const [index, seat] of (['N', 'E', 'S', 'W'] as Seat[]).entries()) {
      p = applySpadesMove(p, seat, [plays[index]], { type: 'play', card: plays[index] })!;
    }
    expect(p).toMatchObject({ broken: true, currentTurnSeat: 'E', taken: { E: 1 }, trick: [] });
    expect(p.tricks[0].winner).toBe('E');
  });
  it('scores contracts, overtricks, carry bags and repeated ten-bag penalties', () => {
    const result = scoreSpadesHand(bids, { N: 4, S: 4, E: 3, W: 2 }, { NS: 9, EW: 0 });
    expect(result.teams.NS).toMatchObject({ contract: 6, tricks: 8, contractPoints: 60, bagsAdded: 2, bagPenalty: 100, bags: 1, points: -38 });
    expect(result.teams.EW).toMatchObject({ contractPoints: -60, bagsAdded: 0, points: -60 });
    const nil = scoreSpadesHand({ N: 0, S: 0, E: 1, W: 1 }, { N: 6, S: 7, E: 0, W: 0 }, { NS: 9, EW: 0 });
    expect(nil.teams.NS).toMatchObject({ contract: 0, contractPoints: 0, nilPoints: -200,
      bagsAdded: 13, bagPenalty: 200, bags: 2, points: -387 });
  });
  it('evaluates nil individually and never credits failed nil tricks to the partner contract', () => {
    const result = scoreSpadesHand({ N: 0, S: 4, E: 3, W: 3 }, { N: 2, S: 3, E: 4, W: 4 }, { NS: 0, EW: 0 });
    expect(result.teams.NS).toMatchObject({ contract: 4, tricks: 3, nilPoints: -100, contractPoints: -40, bagsAdded: 2, points: -138 });
    const made = scoreSpadesHand({ N: 0, S: 4, E: 0, W: 3 }, { N: 0, S: 6, E: 1, W: 6 }, { NS: 0, EW: 0 });
    expect(made.teams.NS).toMatchObject({ nilPoints: 100, contractPoints: 40, bagsAdded: 2, points: 142 });
    expect(made.teams.EW).toMatchObject({ nilPoints: -100, contractPoints: 30, bagsAdded: 4, points: -66 });
    const bothNil = scoreSpadesHand({ N: 0, S: 0, E: 4, W: 4 }, { N: 0, S: 0, E: 6, W: 7 }, { NS: 0, EW: 0 });
    expect(bothNil.teams.NS).toMatchObject({ contract: 0, points: 200, bagsAdded: 0 });
  });
  it('requires 500 at a completed hand, compares both qualifying scores and continues exact ties', () => {
    expect(spadesWinners({ NS: 499, EW: -1000 })).toEqual([]);
    expect(spadesWinners({ NS: 500, EW: 499 })).toEqual(['N', 'S']);
    expect(spadesWinners({ NS: 520, EW: 530 })).toEqual(['E', 'W']);
    expect(spadesWinners({ NS: 530, EW: 530 })).toEqual([]);
    expect(spadesWinners({ NS: -200, EW: 0 })).toEqual([]);
  });
  it('parses only complete bounded actions and rebuilds sanitized values', () => {
    for (const bid of [0, 13]) expect(parseAction({ type: 'bid', bid, secret: true })).toEqual({ type: 'bid', bid });
    for (const bid of [-1, 14, 0.1, '3', null]) expect(typeof parseAction({ type: 'bid', bid })).toBe('string');
    expect(parseAction({ type: 'play', card: { suit: 'spades', rank: 14, secret: true } })).toEqual({ type: 'play', card: c('spades', 14) });
    expect(typeof parseAction({ type: 'play', card: c('clubs', 1 as Card['rank']) })).toBe('string');
  });
});
