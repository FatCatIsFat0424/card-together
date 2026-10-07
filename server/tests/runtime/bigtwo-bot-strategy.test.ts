import { describe, expect, it } from 'vitest';
import type { BigTwoVisibleState, Card } from '@shared/types';
import { canPlay, identifyCombo } from '@shared/rules/bigtwo';
import { getBigTwoBotAction } from '../../src/bots/bigtwo-strategy';
import { selectNearBest } from '../../src/bots/selection';

const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
function state(myHand: Card[], overrides: Partial<BigTwoVisibleState> = {}): BigTwoVisibleState {
  return { gameType: 'bigtwo', phase: 'playing', mySeat: 'N', myHand,
    handCounts: { N: myHand.length, E: 5, S: 5, W: 5 }, currentTurnSeat: 'N',
    lastPlay: null, lockedSeats: [], firstPlay: false, log: [], result: null, revealedHands: null,
    ...overrides };
}

describe('bounded random bot choices', () => {
  it('varies close alternatives while excluding clearly weaker choices', () => {
    const options = [{ value: 'best', score: 10 }, { value: 'close', score: 9 }, { value: 'poor', score: 0 }];
    expect(selectNearBest(options, () => 0, 2)).toBe('best');
    expect(selectNearBest(options, () => 0.6, 2)).toBe('best');
    expect(selectNearBest(options, () => 0.7, 2)).toBe('close');
    expect(selectNearBest(options, () => 0.999999, 2)).toBe('close');
    expect(selectNearBest([], () => 0, 2)).toBeNull();
  });
});

describe('Big Two bot hand planning', () => {
  it('preserves a pair instead of automatically responding with its lowest single', () => {
    const visible = state([card('clubs', 4), card('hearts', 4), card('diamonds', 7), card('spades', 8)], {
      lastPlay: { seat: 'W', cards: [card('clubs', 3)], comboType: 'single' },
    });
    const original = structuredClone(visible);
    for (const sample of [0, 0.25, 0.5, 0.9999]) {
      const action = getBigTwoBotAction(visible, () => sample);
      expect(action?.type).toBe('bigtwo-play');
      if (action?.type !== 'bigtwo-play') throw new Error('Expected play');
      expect(action.cards).toHaveLength(1);
      expect(action.cards[0].rank).not.toBe(4);
      expect(canPlay(action.cards, identifyCombo(visible.lastPlay!.cards), false)).toBe(true);
    }
    expect(visible).toEqual(original);
  });

  it('uses a strong single to block an opponent with one card left', () => {
    const visible = state([card('clubs', 4), card('hearts', 10), card('spades', 2)], {
      handCounts: { N: 3, E: 5, S: 5, W: 1 },
      lastPlay: { seat: 'W', cards: [card('clubs', 3)], comboType: 'single' },
    });
    for (const sample of [0, 0.9999]) {
      expect(getBigTwoBotAction(visible, () => sample)).toEqual({ type: 'bigtwo-play', cards: [card('spades', 2)] });
    }
  });

  it('varies similarly rated moves reproducibly with an injected random source', () => {
    const visible = state([card('clubs', 4), card('diamonds', 7), card('hearts', 9)]);
    const first = getBigTwoBotAction(visible, () => 0);
    const last = getBigTwoBotAction(visible, () => 0.9999);
    expect(first).not.toEqual(last);
    expect(getBigTwoBotAction(visible, () => 0)).toEqual(first);
    for (const action of [first, last]) {
      if (action?.type !== 'bigtwo-play') throw new Error('Expected play');
      expect(canPlay(action.cards, null, false)).toBe(true);
    }
  });

  it('always takes an immediate win before considering random alternatives', () => {
    const hand = [card('clubs', 4), card('hearts', 4)];
    for (const sample of [0, 0.9999]) {
      expect(getBigTwoBotAction(state(hand), () => sample)).toEqual({ type: 'bigtwo-play', cards: hand });
    }
  });
});
