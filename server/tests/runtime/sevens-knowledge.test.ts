import { describe, expect, it } from 'vitest';
import type { Card, Seat, SevensLogEntry, SevensVisibleState } from '@shared/types';
import { svApply, svEmptyTable } from '@shared/rules/sevens';
import { buildSevensKnowledge, sevensLiveProbability, sevensLiveProbabilityAt } from '../../src/bots/sevens-knowledge';

const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const play = (seat: Seat, suit: Card['suit'], rank: Card['rank']): SevensLogEntry => ({
  type: 'play', seat, card: card(suit, rank), timestamp: 0,
});
const cover = (seat: Seat): SevensLogEntry => ({ type: 'cover', seat, timestamp: 0 });

function state(overrides: Partial<SevensVisibleState> = {}): SevensVisibleState {
  const table = (overrides.log ?? []).reduce((current, entry) => entry.type === 'play'
    ? svApply(current, entry.card, overrides.options?.closeOnEnd) : current, svEmptyTable());
  return {
    gameType: 'sevens', phase: 'playing', mySeat: 'N', myHand: [], myCovered: [], table,
    validCards: [], currentTurnSeat: 'N', handCounts: { N: 0, E: 6, S: 3, W: 1 },
    coveredCounts: { N: 0, E: 2, S: 2, W: 1 }, log: [], result: null, ...overrides,
  };
}

describe('Sevens public-history knowledge', () => {
  it('uses remaining hand counts and hidden covers as the unknown-card prior', () => {
    const knowledge = buildSevensKnowledge(state());
    const unknown = card('diamonds', 13);
    expect(sevensLiveProbability(knowledge, unknown)).toBeCloseTo(10 / 15);
    expect(sevensLiveProbabilityAt(knowledge, unknown, 'E')).toBeCloseTo(6 / 15);
    expect(sevensLiveProbabilityAt(knowledge, unknown, 'S')).toBeCloseTo(3 / 15);
    expect(sevensLiveProbabilityAt(knowledge, unknown, 'W')).toBeCloseTo(1 / 15);
    expect(sevensLiveProbabilityAt(knowledge, unknown, 'N')).toBe(0);
  });

  it('excludes all then-playable frontier cards from a seat that covered', () => {
    const knowledge = buildSevensKnowledge(state({ log: [play('N', 'spades', 7), cover('E')] }));
    for (const frontier of [card('spades', 6), card('spades', 8), card('hearts', 7), card('clubs', 7), card('diamonds', 7)]) {
      expect(sevensLiveProbabilityAt(knowledge, frontier, 'E')).toBe(0);
      expect(sevensLiveProbabilityAt(knowledge, frontier, 'S')).toBeCloseTo(3 / 9);
      expect(sevensLiveProbability(knowledge, frontier)).toBeCloseTo(4 / 9);
    }
    expect(sevensLiveProbabilityAt(knowledge, card('spades', 5), 'E')).toBeCloseTo(6 / 15);
  });

  it('keeps cover exclusions after the frontier moves and applies them only from that time', () => {
    const knowledge = buildSevensKnowledge(state({
      log: [play('N', 'spades', 7), cover('E'), play('S', 'hearts', 7), cover('W')],
    }));
    expect(sevensLiveProbabilityAt(knowledge, card('spades', 6), 'E')).toBe(0);
    expect(sevensLiveProbabilityAt(knowledge, card('hearts', 6), 'E')).toBeGreaterThan(0);
    expect(sevensLiveProbabilityAt(knowledge, card('hearts', 6), 'W')).toBe(0);
    expect(sevensLiveProbabilityAt(knowledge, card('hearts', 5), 'W')).toBeGreaterThan(0);
  });

  it('does not infer absence from choosing another legal play', () => {
    const knowledge = buildSevensKnowledge(state({ log: [play('N', 'spades', 7), play('E', 'hearts', 7)] }));
    expect(sevensLiveProbabilityAt(knowledge, card('spades', 6), 'E')).toBeCloseTo(6 / 15);
    expect(sevensLiveProbabilityAt(knowledge, card('spades', 8), 'E')).toBeCloseTo(6 / 15);
  });

  it('assigns zero live probability when every possible opponent was excluded', () => {
    const knowledge = buildSevensKnowledge(state({
      log: [play('N', 'spades', 7), cover('E'), cover('S'), cover('W')],
      coveredCounts: { N: 0, E: 0, S: 0, W: 0 },
    }));
    expect(sevensLiveProbability(knowledge, card('spades', 6))).toBe(0);
    expect(sevensLiveProbability(knowledge, card('spades', 5))).toBeCloseTo(1);
  });

  it('does not exclude cards in a closed suit when the opponent covers', () => {
    const log = [7, 6, 5, 4, 3, 2, 14].map((rank) => play('N', 'spades', rank as Card['rank']));
    log.push(cover('E'));
    const closed = buildSevensKnowledge(state({ log, options: { closeOnEnd: true } }));
    const standard = buildSevensKnowledge(state({ log, options: { closeOnEnd: false } }));
    expect(sevensLiveProbabilityAt(closed, card('spades', 8), 'E')).toBeCloseTo(6 / 15);
    expect(sevensLiveProbabilityAt(standard, card('spades', 8), 'E')).toBe(0);
  });

  it('preserves earlier absence when a later endpoint play closes the suit', () => {
    const log = [play('N', 'spades', 7), cover('E'),
      ...[6, 5, 4, 3, 2, 14].map((rank) => play('S', 'spades', rank as Card['rank']))];
    const knowledge = buildSevensKnowledge(state({ log, options: { closeOnEnd: true } }));
    expect(sevensLiveProbabilityAt(knowledge, card('spades', 8), 'E')).toBe(0);
    expect(sevensLiveProbabilityAt(knowledge, card('spades', 9), 'E')).toBeGreaterThan(0);
  });

  it('knows own live cards exactly and excludes own covers and public cards', () => {
    const own = card('hearts', 13);
    const knowledge = buildSevensKnowledge(state({
      mySeat: 'W', myHand: [own], myCovered: [card('clubs', 14)], log: [play('N', 'spades', 7)],
      table: { ...svEmptyTable(), spades: { low: 6, high: 8 } },
    }));
    expect(sevensLiveProbability(knowledge, own)).toBe(1);
    expect(sevensLiveProbabilityAt(knowledge, own, 'W')).toBe(1);
    expect(sevensLiveProbabilityAt(knowledge, own, 'E')).toBe(0);
    for (const unavailable of [card('clubs', 14), card('spades', 6), card('spades', 7), card('spades', 8)]) {
      expect(sevensLiveProbability(knowledge, unavailable)).toBe(0);
    }
  });

  it('returns zero when no opponent has any remaining cards', () => {
    const knowledge = buildSevensKnowledge(state({ handCounts: { N: 0, E: 0, S: 0, W: 0 } }));
    expect(sevensLiveProbability(knowledge, card('diamonds', 13))).toBe(0);
  });

  it('never reads spectator hands, spectator covers, or settlement results', () => {
    const visible = state({ log: [play('N', 'spades', 7), cover('E')] });
    const expected = buildSevensKnowledge(visible);
    for (const property of ['observedHands', 'observedCovered', 'result']) {
      Object.defineProperty(visible, property, { get: () => { throw new Error(`Private property read: ${property}`); } });
    }
    expect(buildSevensKnowledge(visible)).toEqual(expected);
  });

  it('preserves the input and snapshots count weights independently', () => {
    const visible = state({ myHand: [card('clubs', 13)], log: [play('N', 'spades', 7), cover('E')] });
    const original = structuredClone(visible);
    const knowledge = buildSevensKnowledge(visible);
    expect(visible).toEqual(original);
    const probability = sevensLiveProbabilityAt(knowledge, card('diamonds', 13), 'E');
    visible.handCounts.E = 0;
    visible.coveredCounts.E = 100;
    expect(sevensLiveProbabilityAt(knowledge, card('diamonds', 13), 'E')).toBe(probability);
  });
});
