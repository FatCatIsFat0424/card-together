import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, ChinesePokerVisibleState } from '@shared/types';
import { cpIsFoul, cpIsValidArrangement } from '@shared/rules/chinesepoker';
import * as arrange from '@shared/rules/chinesepoker-arrange';
import { cpGreedyArrangement } from '@shared/rules/chinesepoker-arrange';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import { getChinesePokerBotAction } from '../../src/bots/chinesepoker-strategy';

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
  afterEach(() => vi.restoreAllMocks());
  it('should submit a valid non-foul arrangement', () => {
    const random = seeded(3);
    for (let round = 0; round < 20; round++) {
      const hand = shuffleDeck(createDeck(), random).slice(0, 13);
      const action = getChinesePokerBotAction(state(hand), () => 0.5);
      if (action?.type !== 'chinesepoker-arrange') throw new Error('Expected an arrangement');
      expect(cpIsValidArrangement(hand, action.arrangement)).toBe(true);
      expect(cpIsFoul(action.arrangement)).toBe(false);
    }
  });

  it.each([
    { roll: 0, selected: 0 }, { roll: 0.25, selected: 0 }, { roll: 0.5, selected: 1 },
    { roll: 0.75, selected: 2 }, { roll: 0.9999, selected: 2 },
    { roll: 0.335, selected: 0 }, { roll: 0.67, selected: 1 },
  ])('selects candidate $selected for roll $roll and excludes scores outside the margin', ({ roll, selected }) => {
    const hand = createDeck().slice(0, 13);
    const base = cpGreedyArrangement(hand);
    const candidates = [base,
      { ...base, front: [...base.front].reverse() },
      { ...base, back: [...base.back].reverse() },
      { ...base, middle: [...base.middle].reverse() },
    ];
    const ranked = candidates.map((arrangement, index) => ({ arrangement, score: [3, 2.98, 2.96, 2.9][index] }));
    const search = vi.spyOn(arrange, 'cpRankArrangements').mockReturnValue(ranked);
    const before = structuredClone({ hand, ranked });
    const random = vi.fn(() => roll);
    // Eligible weights are 1, 1/1.02 and 1/1.04; their cumulative cutoffs are about .340 and .673.
    expect(getChinesePokerBotAction(state(hand), random)).toEqual({
      type: 'chinesepoker-arrange', arrangement: candidates[selected],
    });
    expect(search).toHaveBeenCalledExactlyOnceWith(hand, 6);
    expect(random).toHaveBeenCalledTimes(1);
    expect({ hand, ranked }).toEqual(before);
  });

  it('should do nothing after submitting or once scoring starts', () => {
    const hand = createDeck().slice(0, 13);
    const submitted = { N: true, E: true, S: false, W: false };
    expect(getChinesePokerBotAction(state(hand, { submitted, myArrangement: cpGreedyArrangement(hand) }), () => 0))
      .toBeNull();
    expect(getChinesePokerBotAction(state(hand, { phase: 'scoring' }), () => 0)).toBeNull();
  });
});
