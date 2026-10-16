import type { BidLevel, BidSuit, GameSeat } from '@shared/types';

export const BID_LEVELS: readonly BidLevel[] = [1, 2, 3, 4, 5, 6, 7];
export const BID_SUITS: readonly BidSuit[] = ['clubs', 'diamonds', 'hearts', 'spades', 'nt'];

/** A level-and-suit auction call; Bridge uses levels 1–7 and Napoleon 9–16. */
export type AuctionAction<L extends number = BidLevel> =
  | { readonly type: 'bid'; readonly level: L; readonly suit: BidSuit }
  | { readonly type: 'pass' };

type HighestBid = { readonly level: number; readonly suit: BidSuit; readonly seat?: GameSeat } | null;

/** A bid must outrank the highest bid by level, then by suit order. */
export function isBidHigher(level: number, suit: BidSuit, highest: HighestBid): boolean {
  if (!highest) return true;
  if (level !== highest.level) return level > highest.level;
  return BID_SUITS.indexOf(suit) > BID_SUITS.indexOf(highest.suit);
}

/** A level is selectable while at least one suit at that level is still legal. */
export function isLevelAvailable(level: number, highest: HighestBid): boolean {
  return BID_SUITS.some((suit) => isBidHigher(level, suit, highest));
}

/** Lowest legal level, used as the initial level selection. */
export function lowestAvailableLevel(highest: HighestBid): BidLevel | null;
export function lowestAvailableLevel<L extends number>(highest: HighestBid, levels: readonly L[]): L | null;
export function lowestAvailableLevel(highest: HighestBid, levels: readonly number[] = BID_LEVELS): number | null {
  return levels.find((level) => isLevelAvailable(level, highest)) ?? null;
}

export interface PendingCall<L extends number = BidLevel> {
  /** Number of calls in the auction when the choice was made. */
  readonly auctionLength: number;
  readonly action: AuctionAction<L>;
}

/** A pending call survives only for the same auction position and while it remains legal. */
export function currentCall<L extends number = BidLevel>(
  pending: PendingCall<L> | null, auctionLength: number, highest: HighestBid,
): AuctionAction<L> | null {
  if (!pending || pending.auctionLength !== auctionLength) return null;
  const { action } = pending;
  if (action.type === 'pass') return action;
  return isBidHigher(action.level, action.suit, highest) ? action : null;
}

/** Latest calls, oldest first, for compact layouts without the auction table. */
export function recentCalls<T extends { readonly seat: GameSeat }>(bids: readonly T[], count: number): readonly T[] {
  return count > 0 ? bids.slice(-count) : [];
}
