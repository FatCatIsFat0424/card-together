import { describe, expect, it } from 'vitest';
import type { BridgeVisibleState, Seat } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { analyzeAuction, BRIDGE_SUITS, handPoints, isBalancedShape, suitLengths } from '../../src/bots/bridge-auction';
import { getNaturalBridgeBid } from '../../src/bots/bridge-bidding';
import { applyBid, checkBiddingEnd, createBiddingState, validateBid } from '../../src/engine/bidding';
import { createDeck, shuffleDeck } from '../../src/engine/deck';

describe('natural Bridge auction promises', () => {
  it('finishes seeded auctions with legal calls that describe the actual hand', () => {
    for (let seed = 1; seed <= 4096; seed++) {
      let value = seed;
      const random = (): number => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 4294967296;
      };
      const deck = shuffleDeck(createDeck(), random);
      const hands = Object.fromEntries(SEAT_ORDER_CLOCKWISE.map((seat, index) => [seat, deck.slice(index * 13, index * 13 + 13)])) as Record<Seat, typeof deck>;
      let bidding = createBiddingState(SEAT_ORDER_CLOCKWISE[seed % 4]);
      for (let turn = 0; turn < 80 && checkBiddingEnd(bidding) === 'continue'; turn++) {
        const mySeat = bidding.currentBidderSeat;
        const myHand = hands[mySeat];
        const state: BridgeVisibleState = {
          gameType: 'bridge', phase: 'bidding', mySeat, myHand, bidding, dealerSeat: 'W',
          validCards: [], contract: null, playing: null, result: null, log: [], redealPendingSeat: null,
        };
        const action = getNaturalBridgeBid(state);
        const context = `seed ${seed}, ${JSON.stringify(bidding.bids)}, ${mySeat}: ${JSON.stringify(action)}, ${JSON.stringify(myHand)}`;
        expect(validateBid(bidding, mySeat, action).valid, context).toBe(true);
        bidding = applyBid(bidding, mySeat, action);
        const meaning = analyzeAuction(bidding.bids).meanings.at(-1)!;
        const points = handPoints(myHand);
        const lengths = suitLengths(myHand);
        if (meaning.balanced) expect(isBalancedShape(lengths), context).toBe(true);
        expect(points, context).toBeGreaterThanOrEqual(meaning.minPoints ?? 0);
        expect(points, context).toBeLessThanOrEqual(meaning.maxPoints ?? 37);
        for (const suit of BRIDGE_SUITS) {
          expect(lengths[suit], `${context}, ${suit}`).toBeGreaterThanOrEqual(meaning.minLength?.[suit] ?? 0);
          expect(lengths[suit], `${context}, ${suit}`).toBeLessThanOrEqual(meaning.maxLength?.[suit] ?? 13);
        }
      }
      expect(checkBiddingEnd(bidding), `seed ${seed}`).not.toBe('continue');
    }
  }, 30_000);
});
