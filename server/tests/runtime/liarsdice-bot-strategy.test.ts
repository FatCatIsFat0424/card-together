import { describe, expect, it } from 'vitest';
import type { DiceFace, GameSeat, LiarsDiceStandingBid, LiarsDiceVisibleState } from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { ldiIsLegalBid, ldiLegalBids, ldiTotalDice } from '@shared/rules/liarsdice';
import { gameSeatMap } from '@shared/rules/seats';
import type { BotAction } from '../../src/bots/bot-decisions';
import { getBotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { firstLegalAction } from '../../src/runtime/automated-action';
import {
  atLeastMatches, bidHoldsChance, easyLiarsDiceAction, getLiarsDiceBotAction, liarsDiceFirstLegalAction,
  standingBidHoldsChance,
} from '../../src/bots/liarsdice-strategy';

const samples = [0, 0.25, 0.5, 0.75, 0.9999];

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function view(
  myDice: DiceFace[], overrides: Partial<LiarsDiceVisibleState> & { others?: Partial<Record<GameSeat, number>> } = {},
): LiarsDiceVisibleState {
  const { others = { E: 5, S: 5 }, ...rest } = overrides;
  return {
    gameType: 'liarsdice', phase: 'playing', mySeat: 'N', seats: ['N', 'E', 'S'], myDice,
    diceCounts: gameSeatMap((seat) => seat === 'N' ? myDice.length : others[seat] ?? 0), round: 1, bid: null, onesWild: true,
    currentTurnSeat: 'N', eliminated: [], log: [], result: null, ...rest,
  };
}

const bidBy = (seat: GameSeat, quantity: number, face: DiceFace): LiarsDiceStandingBid => ({ seat, quantity, face });

function move(action: BotAction | null): { type: 'bid'; quantity: number; face: DiceFace } | { type: 'challenge' } {
  if (action?.type !== 'game-action' || action.request.gameType !== 'liarsdice') throw new Error('Expected a dice action');
  return action.request.action;
}

/** A random but valid table from the viewpoint of the seat to act. */
function randomView(random: () => number): LiarsDiceVisibleState {
  const seats = GAME_SEAT_ORDER.filter(() => random() < 0.6);
  const players: GameSeat[] = seats.length >= 2 ? seats : ['N', 'E'];
  const mySeat = players[Math.floor(random() * players.length)];
  const counts = gameSeatMap((seat) => players.includes(seat) ? 1 + Math.floor(random() * 5) : 0);
  const myDice = Array.from({ length: counts[mySeat] }, () => 1 + Math.floor(random() * 6)) as DiceFace[];
  const total = ldiTotalDice(counts);
  const bids = ldiLegalBids(null, total);
  const others = players.filter((seat) => seat !== mySeat);
  const standing = random() < 0.3 ? null : { ...bids[Math.floor(random() * bids.length)], seat: others[Math.floor(random() * others.length)] };
  return {
    gameType: 'liarsdice', phase: 'playing', mySeat, seats: players, myDice, diceCounts: counts, round: 1, bid: standing,
    onesWild: random() < 0.7, currentTurnSeat: mySeat, eliminated: [], log: [], result: null,
  };
}

describe("Liar's Dice bot strategy", () => {
  describe('probability', () => {
    it('should match the binomial tail', () => {
      expect(atLeastMatches(5, 1 / 6, 0)).toBe(1);
      expect(atLeastMatches(5, 1 / 6, 6)).toBe(0);
      expect(atLeastMatches(5, 1 / 6, 1)).toBeCloseTo(1 - (5 / 6) ** 5, 10);
      expect(atLeastMatches(4, 0.5, 2)).toBeCloseTo(11 / 16, 10);
      expect(atLeastMatches(10, 1 / 3, 10)).toBeCloseTo((1 / 3) ** 10, 12);
    });

    it('should fall as the required count rises and rise with the chance per die', () => {
      for (let need = 1; need <= 12; need++) {
        expect(atLeastMatches(12, 1 / 6, need)).toBeLessThanOrEqual(atLeastMatches(12, 1 / 6, need - 1));
        expect(atLeastMatches(12, 1 / 3, need)).toBeGreaterThanOrEqual(atLeastMatches(12, 1 / 6, need));
      }
    });

    it('should count the bot\'s own dice as certain and the unseen ones as chance', () => {
      const own = view([4, 4, 1, 2, 3]);
      // Ones are wild: three of the five own dice are 4s, so two more among the ten unseen dice are needed.
      expect(bidHoldsChance(own, { quantity: 3, face: 4 }, true)).toBe(1);
      expect(bidHoldsChance(own, { quantity: 5, face: 4 }, true)).toBeCloseTo(atLeastMatches(10, 1 / 3, 2), 10);
      expect(bidHoldsChance(own, { quantity: 5, face: 4 }, false)).toBeCloseTo(atLeastMatches(10, 1 / 6, 3), 10);
      expect(bidHoldsChance(own, { quantity: 2, face: 1 }, true)).toBeCloseTo(atLeastMatches(10, 1 / 6, 1), 10);
    });

    it('should credit the bidder with the named face when judging the standing bid', () => {
      const standing = view([2, 2, 3, 3, 5], { bid: bidBy('E', 6, 4) });
      const plain = bidHoldsChance(standing, { quantity: 6, face: 4 }, true);
      expect(standingBidHoldsChance(standing)).toBeGreaterThan(plain);
      expect(standingBidHoldsChance(view([2]))).toBe(1);
    });
  });

  describe('hard bot', () => {
    it('should call a bid that cannot be true and accept one that is almost certain', () => {
      const absurd = view([2, 2, 3, 3, 5], { bid: bidBy('E', 15, 6) });
      for (const sample of samples) expect(move(getLiarsDiceBotAction(absurd, () => sample))).toEqual({ type: 'challenge' });
      const modest = view([2, 2, 2, 3, 5], { bid: bidBy('E', 1, 2) });
      for (const sample of samples) expect(move(getLiarsDiceBotAction(modest, () => sample)).type).toBe('bid');
    });

    it('should call a bid far above the dice on the table and raise a bid it holds itself', () => {
      const high = view([6, 6, 6, 6, 6], { bid: bidBy('E', 9, 3) });
      expect(move(getLiarsDiceBotAction(high, () => 0.3))).toEqual({ type: 'challenge' });
      const mine = view([4, 4, 4, 4, 1], { bid: bidBy('E', 4, 4) });
      expect(move(getLiarsDiceBotAction(mine, () => 0.3)).type).toBe('bid');
    });

    it('should open on a face it holds', () => {
      const holding = view([5, 5, 5, 5, 2], { others: { E: 5 } });
      for (const sample of samples) {
        const opening = move(getLiarsDiceBotAction(holding, () => sample));
        expect(opening).toMatchObject({ type: 'bid', face: expect.any(Number) });
        if (opening.type === 'bid') expect(opening.quantity).toBeLessThanOrEqual(ldiTotalDice(holding.diceCounts));
      }
      expect(move(getLiarsDiceBotAction(holding, () => 0))).toMatchObject({ type: 'bid', face: 5 });
    });

    it('should not wait on ones once they stopped being wild', () => {
      const dice: DiceFace[] = [1, 1, 1, 2, 3];
      const wild = view(dice, { bid: bidBy('E', 4, 5), onesWild: true });
      const plain = view(dice, { bid: bidBy('E', 4, 5), onesWild: false });
      expect(standingBidHoldsChance(wild)).toBeGreaterThan(standingBidHoldsChance(plain));
    });

    it('should do nothing when it is not its turn or the match is over', () => {
      expect(getLiarsDiceBotAction(view([1, 2, 3, 4, 5], { currentTurnSeat: 'E' }), () => 0.5)).toBeNull();
      expect(getBotAction(view([1, 2, 3, 4, 5], { phase: 'scoring' }), () => 0.5, 'hard')).toBeNull();
    });

    it('should decide from its own filtered view only', () => {
      const own = view([3, 3, 4, 5, 6], { bid: bidBy('E', 4, 3) });
      const first = move(getLiarsDiceBotAction(own, () => 0.4));
      // Nothing outside the view can matter: the same view always yields the same decision.
      expect(move(getLiarsDiceBotAction(structuredClone(own), () => 0.4))).toEqual(first);
      expect(Object.keys(own)).not.toContain('hands');
    });
  });

  describe('legality', () => {
    it('should only ever choose legal actions, whatever the table', () => {
      const random = seeded(77);
      for (let round = 0; round < 400; round++) {
        const visible = randomView(random);
        const total = ldiTotalDice(visible.diceCounts);
        for (const difficulty of ['hard', 'easy'] as const) {
          const choice = move(getBotAction(visible, random, difficulty));
          if (choice.type === 'challenge') {
            expect(visible.bid).not.toBeNull();
            expect(visible.bid?.seat).not.toBe(visible.mySeat);
          } else {
            expect(ldiIsLegalBid(visible.bid, choice, total)).toBe(true);
          }
        }
        const bot = gameBot('liarsdice');
        for (const action of [bot.turnTimeout?.(visible, { isBot: false, strategy: () => null }), bot.firstLegal(visible),
          firstLegalAction(visible)]) {
          const choice = move(action ?? null);
          if (choice.type === 'bid') expect(ldiIsLegalBid(visible.bid, choice, total)).toBe(true);
          else expect(visible.bid && visible.bid.seat !== visible.mySeat).toBe(true);
        }
      }
    });

    it('should call when no raise exists', () => {
      const full = view([3], { bid: bidBy('E', 2, 1), others: { E: 1 } });
      expect(ldiLegalBids(full.bid, 2)).toEqual([]);
      for (const action of [getLiarsDiceBotAction(full, () => 0.5), easyLiarsDiceAction(full), liarsDiceFirstLegalAction(full)]) {
        expect(move(action)).toEqual({ type: 'challenge' });
      }
    });
  });

  describe('easy bot', () => {
    it('should call when the bid is more than one die above the expected count', () => {
      // Expect 2 own 3s plus 10 unseen dice at one third each: about 5.3 dice.
      const over = view([3, 3, 4, 5, 6], { bid: bidBy('E', 8, 3) });
      expect(move(easyLiarsDiceAction(over))).toEqual({ type: 'challenge' });
      const within = view([3, 3, 4, 5, 6], { bid: bidBy('E', 6, 3) });
      expect(move(easyLiarsDiceAction(within))).toEqual({ type: 'bid', quantity: 6, face: 4 });
    });

    it('should raise by the least allowed and open on its strongest face', () => {
      expect(move(easyLiarsDiceAction(view([2, 4, 4, 6, 6], { bid: bidBy('E', 3, 6) })))).toEqual({ type: 'bid', quantity: 3, face: 1 });
      expect(move(easyLiarsDiceAction(view([2, 4, 4, 4, 6])))).toEqual({ type: 'bid', quantity: 3, face: 4 });
      expect(move(easyLiarsDiceAction(view([1, 1, 3, 3, 3])))).toEqual({ type: 'bid', quantity: 5, face: 3 });
    });

    it('should be deterministic', () => {
      const own = view([1, 3, 5, 5, 6], { bid: bidBy('S', 3, 5) });
      expect(easyLiarsDiceAction(own)).toEqual(easyLiarsDiceAction(structuredClone(own)));
      expect(gameBot('liarsdice').turnTimeout?.(own, { isBot: false, strategy: () => null })).toEqual(easyLiarsDiceAction(own));
    });
  });

  describe('first legal action', () => {
    it('should challenge a standing bid and otherwise open with the least bid', () => {
      expect(move(liarsDiceFirstLegalAction(view([1, 2, 3, 4, 5], { bid: bidBy('E', 2, 4) })))).toEqual({ type: 'challenge' });
      expect(move(liarsDiceFirstLegalAction(view([1, 2, 3, 4, 5])))).toEqual({ type: 'bid', quantity: 1, face: 2 });
      expect(liarsDiceFirstLegalAction(view([1, 2, 3, 4, 5], { currentTurnSeat: 'E' }))).toBeNull();
    });
  });
});
