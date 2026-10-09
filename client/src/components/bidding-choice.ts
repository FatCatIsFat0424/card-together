import type { BidAction, BidLevel, BidSuit, BiddingState, Seat } from '@shared/types';

export const BID_LEVELS: readonly BidLevel[] = [1, 2, 3, 4, 5, 6, 7];
export const BID_SUITS: readonly BidSuit[] = ['clubs', 'diamonds', 'hearts', 'spades', 'nt'];

type HighestBid = BiddingState['highestBid'];

/** A bid must outrank the highest bid by level, then by suit order. */
export function isBidHigher(level: BidLevel, suit: BidSuit, highest: HighestBid): boolean {
  if (!highest) return true;
  if (level !== highest.level) return level > highest.level;
  return BID_SUITS.indexOf(suit) > BID_SUITS.indexOf(highest.suit);
}

/** A level is selectable while at least one suit at that level is still legal. */
export function isLevelAvailable(level: BidLevel, highest: HighestBid): boolean {
  return BID_SUITS.some((suit) => isBidHigher(level, suit, highest));
}

/** Lowest legal level, used as the initial level selection. */
export function lowestAvailableLevel(highest: HighestBid): BidLevel | null {
  return BID_LEVELS.find((level) => isLevelAvailable(level, highest)) ?? null;
}

export interface PendingCall {
  /** Number of calls in the auction when the choice was made. */
  readonly auctionLength: number;
  readonly action: BidAction;
}

/** A pending call survives only for the same auction position and while it remains legal. */
export function currentCall(
  pending: PendingCall | null, auctionLength: number, highest: HighestBid,
): BidAction | null {
  if (!pending || pending.auctionLength !== auctionLength) return null;
  const { action } = pending;
  if (action.type === 'pass') return action;
  return isBidHigher(action.level, action.suit, highest) ? action : null;
}

/** Latest calls, oldest first, for compact layouts without the auction table. */
export function recentCalls<T extends { readonly seat: Seat }>(bids: readonly T[], count: number): readonly T[] {
  return count > 0 ? bids.slice(-count) : [];
}
