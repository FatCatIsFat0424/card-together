import { describe, expect, it } from 'vitest';
import type { Card, ChinesePokerVisibleState } from '@shared/types';
import { cpIsFoul, cpIsValidArrangement } from '@shared/rules/chinesepoker';
import { cpGreedyArrangement } from '@shared/rules/chinesepoker-arrange';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import { getChinesePokerBotAction } from '../../src/bots/chinesepoker-strategy';

const samples = [0, 0.25, 0.5, 0.75, 0.9999];

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function state(myHand: Card[], overrides: Partial<ChinesePokerVisibleState> = {}): ChinesePokerVisibleState {
  return {
    gameType: 'chinesepoker', phase: 'arranging', mySeat: 'E', myHand, myArrangement: null,
    submitted: { N: true, E: false, S: false, W: false }, arrangeDeadline: 0, autoArranged: [],
    log: [], result: null, ...overrides,
  };
}

describe('Chinese Poker bot strategy', () => {
  it('should submit a valid non-foul arrangement', () => {
    const random = seeded(3);
    for (let round = 0; round < 20; round++) {
      const hand = shuffleDeck(createDeck(), random).slice(0, 13);
      for (const sample of samples) {
        const action = getChinesePokerBotAction(state(hand), () => sample);
        if (action?.type !== 'chinesepoker-arrange') throw new Error('Expected an arrangement');
        expect(cpIsValidArrangement(hand, action.arrangement)).toBe(true);
        expect(cpIsFoul(action.arrangement)).toBe(false);
      }
    }
  });

  it('should do nothing after submitting or once scoring starts', () => {
    const hand = createDeck().slice(0, 13);
    const submitted = { N: true, E: true, S: false, W: false };
    expect(getChinesePokerBotAction(state(hand, { submitted, myArrangement: cpGreedyArrangement(hand) }), () => 0))
      .toBeNull();
    expect(getChinesePokerBotAction(state(hand, { phase: 'scoring' }), () => 0)).toBeNull();
  });
});
