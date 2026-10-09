// ─── Bidding Engine: bidding rules ───

import type { Seat, BidAction, BidLevel, BidSuit, BiddingState } from '@shared/types';
import { BID_SUIT_ORDER } from '@shared/constants';
import { nextSeatClockwise } from '@shared/rules/seats';

/** Bridge turns run clockwise. */
export function getNextSeat(seat: Seat): Seat {
  return nextSeatClockwise(seat);
}

/**
 * Create the initial bidding state
 */
export function createBiddingState(startSeat: Seat): BiddingState {
  return {
    bids: [],
    currentBidderSeat: startSeat,
    highestBid: null,
    consecutivePassCount: 0,
    isFirstRound: true,
  };
}

/**
 * Compare two bids
 * Returns > 0 if a > b, < 0 if a < b, 0 if equal
 */
export function compareBids(
  a: { level: BidLevel; suit: BidSuit },
  b: { level: BidLevel; suit: BidSuit },
): number {
  if (a.level !== b.level) return a.level - b.level;
  return BID_SUIT_ORDER.indexOf(a.suit) - BID_SUIT_ORDER.indexOf(b.suit);
}

/**
 * Get all legal bids currently available
 */
export function getValidBids(state: BiddingState): BidAction[] {
  const validBids: BidAction[] = [{ type: 'pass' }];
  const levels: BidLevel[] = [1, 2, 3, 4, 5, 6, 7];
  const suits: BidSuit[] = ['clubs', 'diamonds', 'hearts', 'spades', 'nt'];

  for (const level of levels) {
    for (const suit of suits) {
      const bid = { level, suit };
      if (!state.highestBid || compareBids(bid, state.highestBid) > 0) {
        validBids.push({ type: 'bid', level, suit });
      }
    }
  }

  return validBids;
}

/**
 * Validate a bid
 */
export function validateBid(
  state: BiddingState,
  seat: Seat,
  action: BidAction,
): { valid: true } | { valid: false; reason: string } {
  // It must be the bidder's turn
  if (seat !== state.currentBidderSeat) {
    return { valid: false, reason: 'Not your turn' };
  }

  // Pass is always legal
  if (action.type === 'pass') {
    return { valid: true };
  }

  // A new bid must outrank the current highest bid
  if (state.highestBid) {
    if (compareBids({ level: action.level, suit: action.suit }, state.highestBid) <= 0) {
      return { valid: false, reason: 'Bid must be higher than current highest bid' };
    }
  }

  return { valid: true };
}

/**
 * Apply a bidding action and return the new state
 */
export function applyBid(
  state: BiddingState,
  seat: Seat,
  action: BidAction,
): BiddingState {
  const newBids = [...state.bids, { seat, action }];
  const nextSeat = getNextSeat(seat);
  const isNewRound = state.isFirstRound && newBids.length >= 4;

  if (action.type === 'pass') {
    return {
      bids: newBids,
      currentBidderSeat: nextSeat,
      highestBid: state.highestBid,
      consecutivePassCount: state.consecutivePassCount + 1,
      isFirstRound: isNewRound ? false : state.isFirstRound,
    };
  }

  // type === 'bid'
  return {
    bids: newBids,
    currentBidderSeat: nextSeat,
    highestBid: { level: action.level, suit: action.suit, seat },
    consecutivePassCount: 0,
    isFirstRound: isNewRound ? false : state.isFirstRound,
  };
}

/**
 * Check whether bidding has ended
 * Returns:
 * - 'continue': bidding goes on
 * - 'all_pass': all four pass in the first round, so redeal
 * - 'contract': three consecutive passes after a bid, so the contract is set
 */
export function checkBiddingEnd(
  state: BiddingState,
): 'continue' | 'all_pass' | 'contract' {
  // All four players pass in the first round
  if (state.bids.length === 4 && state.consecutivePassCount === 4) {
    return 'all_pass';
  }

  // Three consecutive passes after a bid
  if (state.highestBid && state.consecutivePassCount >= 3) {
    return 'contract';
  }

  return 'continue';
}
