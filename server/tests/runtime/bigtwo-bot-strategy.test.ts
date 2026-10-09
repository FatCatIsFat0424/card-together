import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BigTwoVisibleState, Card } from '@shared/types';
import { canPlay, identifyCombo } from '@shared/rules/bigtwo';
import { getBigTwoBotAction } from '../../src/bots/bigtwo-strategy';
import { getBotAction } from '../../src/bots/bot-decisions';
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

describe('Big Two bot passing', () => {
  afterEach(() => vi.restoreAllMocks());
  const samples = [0, 0.25, 0.5, 0.75, 0.9999];
  const quadSevens = [card('clubs', 7), card('diamonds', 7), card('hearts', 7), card('spades', 7)];
  const kingPair = { seat: 'W' as const, cards: [card('clubs', 13), card('spades', 13)], comboType: 'pair' as const };
  const earlyHand = [...quadSevens, card('diamonds', 3), card('clubs', 4), card('hearts', 5), card('spades', 6),
    card('clubs', 9), card('diamonds', 10), card('hearts', 11), card('spades', 12), card('clubs', 8)];

  it('passes instead of spending a bomb on an early pair of kings', () => {
    const visible = state(earlyHand, { handCounts: { N: 13, E: 13, S: 13, W: 11 }, lastPlay: kingPair });
    for (const sample of samples) expect(getBigTwoBotAction(visible, () => sample)).toEqual({ type: 'bigtwo-pass' });
  });

  it('keeps a lone 2 early when it is the only card that beats an ace', () => {
    const hand = [card('spades', 2), card('clubs', 3), card('diamonds', 4), card('hearts', 5), card('spades', 6),
      card('clubs', 8), card('diamonds', 9), card('hearts', 10), card('spades', 11), card('clubs', 12)];
    const visible = state(hand, {
      handCounts: { N: 10, E: 12, S: 12, W: 11 },
      lastPlay: { seat: 'W', cards: [card('hearts', 14)], comboType: 'single' },
    });
    for (const sample of samples) expect(getBigTwoBotAction(visible, () => sample)).toEqual({ type: 'bigtwo-pass' });
  });

  it('still answers with ordinary cards rather than passing', () => {
    const visible = state(earlyHand, {
      handCounts: { N: 13, E: 13, S: 13, W: 12 },
      lastPlay: { seat: 'W', cards: [card('hearts', 3)], comboType: 'single' },
    });
    for (const sample of samples) {
      const action = getBigTwoBotAction(visible, () => sample);
      if (action?.type !== 'bigtwo-play') throw new Error('Expected play');
      expect(action.cards).toHaveLength(1);
    }
  });

  it('plays an ordinary card instead of passing or spending control cards', () => {
    const hand = [...quadSevens, card('spades', 2), card('hearts', 14), card('clubs', 3), card('diamonds', 5),
      card('hearts', 9), card('spades', 11)];
    const visible = state(hand, {
      handCounts: { N: 10, E: 13, S: 13, W: 12 },
      lastPlay: { seat: 'W', cards: [card('clubs', 13)], comboType: 'single' },
    });
    for (const sample of samples) {
      expect(getBigTwoBotAction(visible, () => sample)).toEqual({ type: 'bigtwo-play', cards: [card('hearts', 14)] });
    }
  });

  it('releases a lone 2 once an opponent is down to five cards', () => {
    const hand = [card('spades', 2), card('clubs', 3), card('diamonds', 5), card('hearts', 9), card('spades', 11),
      card('clubs', 12), card('diamonds', 13)];
    const ace = { seat: 'W' as const, cards: [card('hearts', 14)], comboType: 'single' as const };
    const early = state(hand, { handCounts: { N: 7, E: 12, S: 12, W: 11 }, lastPlay: ace });
    const late = state(hand, { handCounts: { N: 7, E: 5, S: 12, W: 11 }, lastPlay: ace });
    for (const sample of samples) {
      expect(getBigTwoBotAction(early, () => sample)).toEqual({ type: 'bigtwo-pass' });
      expect(getBigTwoBotAction(late, () => sample)).toEqual({ type: 'bigtwo-play', cards: [card('spades', 2)] });
    }
  });

  it('keeps playing in the endgame even when the only answer splits a combination', () => {
    const fullHouse = [card('clubs', 5), card('diamonds', 5), card('hearts', 5), card('clubs', 12), card('spades', 12)];
    const hand = [...fullHouse, card('clubs', 3), card('diamonds', 4)];
    const jack = { seat: 'W' as const, cards: [card('hearts', 11)], comboType: 'single' as const };
    const early = state(hand, { handCounts: { N: 7, E: 12, S: 12, W: 11 }, lastPlay: jack });
    const late = state(hand, { handCounts: { N: 7, E: 4, S: 12, W: 11 }, lastPlay: jack });
    for (const sample of samples) {
      expect(getBigTwoBotAction(early, () => sample)).toEqual({ type: 'bigtwo-pass' });
      const action = getBigTwoBotAction(late, () => sample);
      if (action?.type !== 'bigtwo-play') throw new Error('Expected play');
      expect(action.cards).toHaveLength(1);
      expect(action.cards[0].rank).toBe(12);
    }
  });

  it('never passes on a lead, including timed-out human turns', () => {
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const deck = (['clubs', 'diamonds', 'hearts', 'spades'] as const)
      .flatMap((suit) => ([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const).map((rank) => card(suit, rank)));
    for (let deal = 0; deal < 40; deal++) {
      const shuffled = [...deck].sort(() => random() - 0.5);
      for (const size of [13, 8, 3]) {
        const hand = shuffled.slice(0, size);
        const firstPlay = size === 13 && hand.some((own) => own.suit === 'clubs' && own.rank === 3);
        const visible = state(hand, { firstPlay, handCounts: { N: size, E: 13, S: 13, W: 13 } });
        const action = getBigTwoBotAction(visible, random);
        if (action?.type !== 'bigtwo-play') throw new Error('Expected a lead');
        expect(canPlay(action.cards, null, firstPlay)).toBe(true);
        vi.spyOn(Math, 'random').mockReturnValue(random());
        expect(getBotAction(visible)?.type).toBe('bigtwo-play');
      }
    }
    const controlOnly = state([...quadSevens, card('spades', 2), card('hearts', 2)], {
      handCounts: { N: 6, E: 13, S: 13, W: 13 },
    });
    for (const sample of samples) expect(getBigTwoBotAction(controlOnly, () => sample)?.type).toBe('bigtwo-play');
  });

  it('spends the bomb once opponents are close to finishing', () => {
    const visible = state([...quadSevens, card('diamonds', 3), card('clubs', 9)], {
      handCounts: { N: 6, E: 3, S: 4, W: 3 }, lastPlay: kingPair,
    });
    for (const sample of samples) {
      const action = getBigTwoBotAction(visible, () => sample);
      if (action?.type !== 'bigtwo-play') throw new Error('Expected play');
      expect(action.cards).toEqual(expect.arrayContaining(quadSevens));
    }
  });

  it('never passes while a responding opponent still holds one card', () => {
    const visible = state(earlyHand, { handCounts: { N: 13, E: 13, S: 13, W: 1 }, lastPlay: kingPair });
    for (const sample of samples) {
      const action = getBigTwoBotAction(visible, () => sample);
      if (action?.type !== 'bigtwo-play') throw new Error('Expected play');
      expect(action.cards).toEqual(expect.arrayContaining(quadSevens));
    }
  });

  it('ignores a one-card opponent who already passed this round', () => {
    const hand = [card('clubs', 4), card('hearts', 4), card('diamonds', 7), card('spades', 8),
      card('hearts', 2), card('spades', 2)];
    const single = { seat: 'W' as const, cards: [card('clubs', 3)], comboType: 'single' as const };
    const locked = state(hand, { handCounts: { N: 6, E: 1, S: 9, W: 9 }, lastPlay: single, lockedSeats: ['E'] });
    for (const sample of samples) {
      const action = getBigTwoBotAction(locked, () => sample);
      if (action?.type !== 'bigtwo-play') throw new Error('Expected play');
      expect(action.cards).toHaveLength(1);
      expect(action.cards[0].rank).not.toBe(2);
    }
    const active = state(hand, { handCounts: { N: 6, E: 1, S: 9, W: 9 }, lastPlay: single });
    for (const sample of samples) {
      expect(getBigTwoBotAction(active, () => sample)).toEqual({ type: 'bigtwo-play', cards: [card('spades', 2)] });
    }
  });

  it('keeps the bomb for a timed-out human using the shared default decision', () => {
    const visible = state(earlyHand, { handCounts: { N: 13, E: 13, S: 13, W: 11 }, lastPlay: kingPair });
    for (const sample of samples) {
      vi.spyOn(Math, 'random').mockReturnValue(sample);
      expect(getBotAction(visible)).toEqual({ type: 'bigtwo-pass' });
    }
  });
});
