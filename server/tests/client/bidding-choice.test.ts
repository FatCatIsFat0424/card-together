import { describe, expect, it } from 'vitest';
import {
  currentCall, isBidHigher, isLevelAvailable, lowestAvailableLevel, recentCalls,
} from '../../../client/src/components/bidding-choice';

describe('bidding choice', () => {
  const highest = { level: 2, suit: 'hearts', seat: 'N' } as const;

  it('should rank bids by level and then suit order', () => {
    expect(isBidHigher(1, 'clubs', null)).toBe(true);
    expect(isBidHigher(2, 'spades', highest)).toBe(true);
    expect(isBidHigher(2, 'hearts', highest)).toBe(false);
    expect(isBidHigher(2, 'diamonds', highest)).toBe(false);
    expect(isBidHigher(1, 'nt', highest)).toBe(false);
    expect(isBidHigher(3, 'clubs', highest)).toBe(true);
  });

  it('should offer only levels that still contain a legal suit', () => {
    expect(isLevelAvailable(2, highest)).toBe(true);
    expect(isLevelAvailable(1, highest)).toBe(false);
    expect(isLevelAvailable(7, { level: 7, suit: 'nt', seat: 'E' })).toBe(false);
    expect(lowestAvailableLevel(highest)).toBe(2);
    expect(lowestAvailableLevel({ level: 2, suit: 'nt', seat: 'E' })).toBe(3);
    expect(lowestAvailableLevel({ level: 7, suit: 'nt', seat: 'E' })).toBeNull();
  });

  it('should keep a pending call only for the same auction position while it is legal', () => {
    const pending = { auctionLength: 3, action: { type: 'bid', level: 3, suit: 'clubs' } } as const;
    expect(currentCall(pending, 3, highest)).toEqual(pending.action);
    expect(currentCall(pending, 4, highest)).toBeNull();
    expect(currentCall(pending, 3, { level: 3, suit: 'spades', seat: 'W' })).toBeNull();
    expect(currentCall({ auctionLength: 0, action: { type: 'pass' } }, 0, null)).toEqual({ type: 'pass' });
    expect(currentCall(null, 0, null)).toBeNull();
  });

  it('should return the latest calls in chronological order', () => {
    const bids = (['N', 'E', 'S', 'W', 'N'] as const).map((seat) => ({ seat, action: { type: 'pass' } as const }));
    expect(recentCalls(bids, 3).map((call) => call.seat)).toEqual(['S', 'W', 'N']);
    expect(recentCalls(bids.slice(0, 2), 4)).toHaveLength(2);
    expect(recentCalls(bids, 0)).toEqual([]);
  });
});
