import { describe, expect, it } from 'vitest';
import type { Card, Rank } from '@shared/types';
import { GONGZHU_FIRST_CARD, gongZhuCardPoints, gongZhuLegalCards, gongZhuScore, gongZhuScoringCard,
  gongZhuTrickWinner, gongZhuWinners } from '@shared/rules/gongzhu';
import { parseAction } from '@shared/games/gongzhu/actions';

const card = (suit: Card['suit'], rank: Rank): Card => ({ suit, rank });
const hearts = Array.from({ length: 13 }, (_, index) => card('hearts', (index + 2) as Rank));
const pig = card('spades', 12);
const sheep = card('diamonds', 11);
const transformer = card('clubs', 10);
const heartValues = [0, 0, 0, -10, -10, -10, -10, -10, -10, -20, -30, -40, -50];

describe('Gong Zhu scoring', () => {
  it('assigns every rank boundary and every scoring-card identity', () => {
    expect(hearts.map(gongZhuCardPoints)).toEqual(heartValues);
    expect(hearts.every(gongZhuScoringCard)).toBe(true);
    expect(gongZhuCardPoints(pig)).toBe(-100);
    expect(gongZhuCardPoints(sheep)).toBe(100);
    expect(gongZhuCardPoints(transformer)).toBe(0);
    for (const suit of ['clubs', 'diamonds', 'spades'] as const) {
      for (let rank = 2; rank <= 14; rank++) {
        const held = card(suit, rank as Rank);
        expect(gongZhuScoringCard(held)).toBe(suit === 'clubs' && rank === 10
          || suit === 'diamonds' && rank === 11 || suit === 'spades' && rank === 12);
      }
    }
  });

  it('evaluates every subset of all 16 scoring cards, including zero hearts and cancellation', () => {
    for (let mask = 0; mask < 8192; mask++) {
      const taken = hearts.filter((_card, index) => (mask & (1 << index)) !== 0);
      const subtotal = mask === 8191 ? 200 : heartValues.reduce((sum, value, index) => sum + ((mask & (1 << index)) ? value : 0), 0);
      for (let specials = 0; specials < 8; specials++) {
        const p = (specials & 1) !== 0;
        const s = (specials & 2) !== 0;
        const t = (specials & 4) !== 0;
        const cards = [...taken, ...(p ? [pig] : []), ...(s ? [sheep] : []), ...(t ? [transformer] : [])];
        const base = subtotal + (p ? -100 : 0) + (s ? 100 : 0);
        const otherValued = p || s || (mask & ~7) !== 0;
        const expected = mask === 8191 && specials === 7 ? 1000 : t ? otherValued ? base * 2 : 50 : base;
        expect(gongZhuScore(cards), `${mask}/${specials}`).toBe(expected);
      }
    }
  });

  it('ignores ordinary captured cards and never mutates inputs', () => {
    const captured = Object.freeze([transformer, ...hearts.slice(0, 3), card('clubs', 14), card('diamonds', 2)]);
    expect(gongZhuScore(captured)).toBe(50);
    expect(gongZhuScore([pig, sheep, transformer])).toBe(0);
    expect(gongZhuScore([...hearts, transformer, pig])).toBe(200);
    expect(gongZhuScore([...hearts, transformer, sheep])).toBe(600);
    expect(captured).toHaveLength(6);
  });
});

describe('Gong Zhu tricks and actions', () => {
  it('forces only the opening C2 lead and follows suit without penalty restrictions', () => {
    const hand = Object.freeze([GONGZHU_FIRST_CARD, pig, card('hearts', 14), card('clubs', 14)]);
    expect(gongZhuLegalCards(hand, [], true)).toEqual([GONGZHU_FIRST_CARD]);
    expect(gongZhuLegalCards(hand, [], false)).toEqual(hand);
    expect(gongZhuLegalCards(hand, [{ seat: 'E', card: card('clubs', 3) }], true)).toEqual([GONGZHU_FIRST_CARD, card('clubs', 14)]);
    expect(gongZhuLegalCards(hand, [{ seat: 'E', card: card('diamonds', 2) }], true)).toEqual(hand);
    expect(gongZhuLegalCards(hand, [{ seat: 'E', card: card('spades', 2) }], false)).toEqual([pig]);
  });

  it('awards the highest card of the led suit and treats aces high', () => {
    expect(gongZhuTrickWinner([{ seat: 'W', card: card('clubs', 2) }, { seat: 'N', card: card('spades', 14) },
      { seat: 'E', card: card('clubs', 13) }, { seat: 'S', card: card('hearts', 14) }])).toBe('E');
    expect(gongZhuTrickWinner([{ seat: 'N', card: card('hearts', 13) }, { seat: 'E', card: card('hearts', 14) }])).toBe('E');
    expect(() => gongZhuTrickWinner([])).toThrow();
    expect(gongZhuWinners({ N: -10, E: -10, S: -20, W: -50 })).toEqual(['N', 'E']);
  });

  it('sanitizes actions and rejects malformed cards', () => {
    expect(parseAction({ type: 'play', card: { ...pig, secret: true }, ignored: true })).toEqual({ type: 'play', card: pig });
    for (const value of [null, [], { type: 'pass' }, { type: 'play', card: { suit: 'hearts', rank: 15 } },
      { type: 'play', card: { suit: 'hearts', rank: 2.1 } }, { type: 'play', card: { joker: 'big' } }]) {
      expect(parseAction(value)).toBeTypeOf('string');
    }
  });
});
