import { describe, it, expect } from 'vitest';
import {
  createBiddingState,
  compareBids,
  getValidBids,
  validateBid,
  applyBid,
  checkBiddingEnd,
  getNextSeat,
} from '../../src/engine/bidding';

describe('bidding engine', () => {

  describe('getNextSeat', () => {
    it('should cycle N → E → S → W → N', () => {
      expect(getNextSeat('N')).toBe('E');
      expect(getNextSeat('E')).toBe('S');
      expect(getNextSeat('S')).toBe('W');
      expect(getNextSeat('W')).toBe('N');
    });
  });

  describe('createBiddingState', () => {
    it('should create initial state with correct start seat', () => {
      const state = createBiddingState('N');
      expect(state.currentBidderSeat).toBe('N');
      expect(state.bids).toHaveLength(0);
      expect(state.highestBid).toBeNull();
      expect(state.consecutivePassCount).toBe(0);
      expect(state.isFirstRound).toBe(true);
    });
  });

  describe('compareBids', () => {
    it('should rank higher level above lower level', () => {
      expect(compareBids(
        { level: 2, suit: 'clubs' },
        { level: 1, suit: 'nt' },
      )).toBeGreaterThan(0);
    });

    it('should rank NT above spades at same level', () => {
      expect(compareBids(
        { level: 1, suit: 'nt' },
        { level: 1, suit: 'spades' },
      )).toBeGreaterThan(0);
    });

    it('should rank spades above hearts at same level', () => {
      expect(compareBids(
        { level: 1, suit: 'spades' },
        { level: 1, suit: 'hearts' },
      )).toBeGreaterThan(0);
    });

    it('should rank clubs as lowest suit', () => {
      expect(compareBids(
        { level: 1, suit: 'clubs' },
        { level: 1, suit: 'diamonds' },
      )).toBeLessThan(0);
    });

    it('should return 0 for identical bids', () => {
      expect(compareBids(
        { level: 3, suit: 'hearts' },
        { level: 3, suit: 'hearts' },
      )).toBe(0);
    });
  });

  describe('validateBid', () => {
    it('should reject bid from wrong seat', () => {
      const state = createBiddingState('N');
      const result = validateBid(state, 'E', { type: 'bid', level: 1, suit: 'clubs' });
      expect(result).toEqual({ valid: false, reason: expect.any(String) });
    });

    it('should allow pass from correct seat', () => {
      const state = createBiddingState('N');
      expect(validateBid(state, 'N', { type: 'pass' })).toEqual({ valid: true });
    });

    it('should allow first bid at any level', () => {
      const state = createBiddingState('N');
      expect(validateBid(state, 'N', { type: 'bid', level: 1, suit: 'clubs' })).toEqual({ valid: true });
    });

    it('should reject bid lower than current highest', () => {
      let state = createBiddingState('N');
      state = applyBid(state, 'N', { type: 'bid', level: 2, suit: 'hearts' });
      const result = validateBid(state, 'E', { type: 'bid', level: 1, suit: 'nt' });
      expect(result).toEqual({ valid: false, reason: expect.any(String) });
    });

    it('should reject bid equal to current highest', () => {
      let state = createBiddingState('N');
      state = applyBid(state, 'N', { type: 'bid', level: 1, suit: 'hearts' });
      const result = validateBid(state, 'E', { type: 'bid', level: 1, suit: 'hearts' });
      expect(result).toEqual({ valid: false, reason: expect.any(String) });
    });

    it('should allow bid higher than current highest', () => {
      let state = createBiddingState('N');
      state = applyBid(state, 'N', { type: 'bid', level: 1, suit: 'hearts' });
      const result = validateBid(state, 'E', { type: 'bid', level: 1, suit: 'spades' });
      expect(result).toEqual({ valid: true });
    });
  });

  describe('checkBiddingEnd', () => {
    it('should return all_pass when first round four consecutive passes', () => {
      let state = createBiddingState('N');
      state = applyBid(state, 'N', { type: 'pass' });
      state = applyBid(state, 'E', { type: 'pass' });
      state = applyBid(state, 'S', { type: 'pass' });
      state = applyBid(state, 'W', { type: 'pass' });
      expect(checkBiddingEnd(state)).toBe('all_pass');
    });

    it('should return contract when bid followed by 3 passes', () => {
      let state = createBiddingState('N');
      state = applyBid(state, 'N', { type: 'bid', level: 1, suit: 'clubs' });
      state = applyBid(state, 'E', { type: 'pass' });
      state = applyBid(state, 'S', { type: 'pass' });
      state = applyBid(state, 'W', { type: 'pass' });
      expect(checkBiddingEnd(state)).toBe('contract');
    });

    it('should return continue when bidding is still active', () => {
      let state = createBiddingState('N');
      state = applyBid(state, 'N', { type: 'bid', level: 1, suit: 'clubs' });
      state = applyBid(state, 'E', { type: 'pass' });
      expect(checkBiddingEnd(state)).toBe('continue');
    });

    it('should return continue after bid breaks pass sequence', () => {
      let state = createBiddingState('N');
      state = applyBid(state, 'N', { type: 'bid', level: 1, suit: 'clubs' });
      state = applyBid(state, 'E', { type: 'pass' });
      state = applyBid(state, 'S', { type: 'bid', level: 2, suit: 'hearts' });
      state = applyBid(state, 'W', { type: 'pass' });
      expect(checkBiddingEnd(state)).toBe('continue');
    });

    it('should track contract correctly after multiple bids', () => {
      let state = createBiddingState('N');
      state = applyBid(state, 'N', { type: 'bid', level: 1, suit: 'clubs' });
      state = applyBid(state, 'E', { type: 'bid', level: 1, suit: 'hearts' });
      state = applyBid(state, 'S', { type: 'bid', level: 2, suit: 'diamonds' });
      state = applyBid(state, 'W', { type: 'pass' });
      state = applyBid(state, 'N', { type: 'pass' });
      state = applyBid(state, 'E', { type: 'pass' });
      expect(checkBiddingEnd(state)).toBe('contract');
      expect(state.highestBid?.seat).toBe('S');
      expect(state.highestBid?.suit).toBe('diamonds');
      expect(state.highestBid?.level).toBe(2);
    });
  });

  describe('getValidBids', () => {
    it('should include pass and all 35 bids when no bids yet', () => {
      const state = createBiddingState('N');
      const valid = getValidBids(state);
      expect(valid).toHaveLength(36); // 1 pass + 35 bids (7 levels × 5 suits)
      expect(valid[0]).toEqual({ type: 'pass' });
    });

    it('should only include bids higher than current highest', () => {
      let state = createBiddingState('N');
      state = applyBid(state, 'N', { type: 'bid', level: 3, suit: 'hearts' });
      const valid = getValidBids(state);
      // Should include pass + bids > 3H
      const bidActions = valid.filter((b) => b.type === 'bid');
      for (const bid of bidActions) {
        if (bid.type === 'bid') {
          expect(compareBids(
            { level: bid.level, suit: bid.suit },
            { level: 3, suit: 'hearts' },
          )).toBeGreaterThan(0);
        }
      }
    });
  });
});
