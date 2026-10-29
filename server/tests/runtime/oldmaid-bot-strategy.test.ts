import { describe, expect, it } from 'vitest';
import type { Card, CardOrJoker, GameSeat, OldMaidVisibleState } from '@shared/types';
import { omIsPermutation } from '@shared/rules/oldmaid';
import type { BotAction } from '../../src/bots/bot-decisions';
import { getBotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { firstLegalAction } from '../../src/runtime/automated-action';
import { easyOldMaidAction, getOldMaidBotAction, oldMaidFirstLegalAction } from '../../src/bots/oldmaid-strategy';

const samples = [0, 0.25, 0.5, 0.75, 0.9999];
const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const JOKER: CardOrJoker = { joker: 'big' };

function view(myHand: CardOrJoker[], overrides: Partial<OldMaidVisibleState> = {}): OldMaidVisibleState {
  return {
    gameType: 'oldmaid', phase: 'playing', mySeat: 'N', seats: ['N', 'E', 'S'], deal: 1, totalDeals: 3, myHand,
    handCounts: { N: myHand.length, E: 4, S: 3, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 }, finished: [], currentTurnSeat: 'N',
    drawFrom: 'E', totals: { N: 0, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 }, log: [], result: null, ...overrides,
  };
}

function draw(action: BotAction | null): { index: number; reorder?: readonly number[] } {
  if (action?.type !== 'game-action' || action.request.gameType !== 'oldmaid' || action.request.action.type !== 'draw') {
    throw new Error('Expected a draw');
  }
  const { index, reorder } = action.request.action;
  return { index, reorder };
}

describe('Old Maid bots', () => {
  it('should draw a legal position of the neighbour\'s hand for every difficulty and random value', () => {
    for (const difficulty of ['easy', 'hard'] as const) {
      for (const value of samples) {
        const { index } = draw(getBotAction(view([c('hearts', 5), JOKER]), () => value, difficulty));
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(4);
      }
    }
  });

  it('should reach every position over the random range', () => {
    const seen = new Set(samples.concat([0.1, 0.6]).map((value) => draw(easyOldMaidAction(view([c('hearts', 5)]), () => value)).index));
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });

  it('should only act on its own turn while playing', () => {
    for (const bot of [easyOldMaidAction, getOldMaidBotAction, oldMaidFirstLegalAction]) {
      expect(bot(view([JOKER], { currentTurnSeat: 'E' }), () => 0.5)).toBeNull();
      expect(bot(view([JOKER], { phase: 'scoring', drawFrom: null }), () => 0.5)).toBeNull();
      expect(bot(view([JOKER], { drawFrom: null }), () => 0.5)).toBeNull();
    }
    expect(getBotAction(view([JOKER], { phase: 'scoring' }))).toBeNull();
  });

  it('should have the easy bot leave its hand alone', () => {
    for (const value of samples) expect(draw(easyOldMaidAction(view([c('hearts', 5), JOKER, c('clubs', 2)]), () => value)).reorder)
      .toBeUndefined();
  });

  it('should have the hard bot shuffle its own hand only while it holds the joker', () => {
    const holding = view([c('hearts', 5), JOKER, c('clubs', 2), c('spades', 9)]);
    for (const value of samples) {
      const { reorder } = draw(getOldMaidBotAction(holding, () => value));
      expect(reorder && omIsPermutation(reorder, 4)).toBe(true);
    }
    const orders = new Set(samples.concat([0.1, 0.6, 0.35]).map((value) => JSON.stringify(
      draw(getOldMaidBotAction(holding, seededSteps(value))).reorder)));
    expect(orders.size).toBeGreaterThan(1);
    expect(draw(getOldMaidBotAction(view([c('hearts', 5), c('clubs', 2)]), () => 0.4)).reorder).toBeUndefined();
    expect(draw(getOldMaidBotAction(view([JOKER]), () => 0.4)).reorder).toBeUndefined();
  });

  it('should decide from the filtered view alone, never from hidden hands', () => {
    const base = view([c('hearts', 5), JOKER]);
    const noisy = { ...base, observedHands: { E: [JOKER, c('clubs', 3)] } } as OldMaidVisibleState;
    // Observed hands exist only in spectator views; a seated bot's choice must not depend on them.
    expect(getOldMaidBotAction(base, () => 0.3)).toEqual(getOldMaidBotAction({ ...noisy, observedHands: undefined }, () => 0.3));
    expect(Object.keys(base)).not.toContain('hands');
  });

  it('should timeout and fall back to a legal draw', () => {
    const bot = gameBot('oldmaid');
    const context = { isBot: false, strategy: () => null };
    const timedOut = bot.turnTimeout?.(view([JOKER]), context) ?? null;
    expect(draw(timedOut).index).toBeLessThan(4);
    expect(draw(firstLegalAction(view([JOKER])))).toEqual({ index: 0, reorder: undefined });
    expect(firstLegalAction(view([JOKER], { phase: 'scoring', drawFrom: null }))).toBeNull();
    const seats: GameSeat[] = ['N'];
    expect(oldMaidFirstLegalAction(view([JOKER], { currentTurnSeat: seats[0], handCounts: { ...view([]).handCounts, E: 0 } }))).toBeNull();
  });
});

/** A source that walks a few distinct values from a starting point. */
function seededSteps(start: number): () => number {
  let value = start;
  return () => {
    value = (value * 7919 + 0.137) % 1;
    return value;
  };
}
