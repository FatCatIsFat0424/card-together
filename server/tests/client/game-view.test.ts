import { describe, expect, it } from 'vitest';
import type { MatchResult, PlayerVisibleGameState, PlayingState } from '@shared/types';
import {
  AUCTION_COLUMNS, auctionRows, auctionWaitIndex, formatCountdown, lastElimination, lastMove, matchSeats, remainingCards,
  resultSeats,
} from '../../../client/src/game-view';
import type { AuctionCall } from '../../../client/src/game-view';

const pass = { type: 'pass' } as const;
const calls: AuctionCall[] = [
  { seat: 'N', action: { type: 'bid', level: 2, suit: 'hearts' } },
  { seat: 'E', action: pass },
  { seat: 'S', action: pass },
  { seat: 'W', action: pass },
];

describe('auctionRows', () => {
  it('pads before the first bidder column and after the last call', () => {
    const rows = auctionRows(calls);
    expect(rows).toEqual([
      [null, calls[0], calls[1], calls[2]],
      [calls[3], null, null, null],
    ]);
  });
  it('starts in the first column when west bids first', () => {
    const rows = auctionRows([{ seat: 'W', action: pass }]);
    expect(rows).toEqual([[{ seat: 'W', action: pass }, null, null, null]]);
  });
  it('returns no rows for an empty auction', () => {
    expect(auctionRows([])).toEqual([]);
  });
});

describe('auction seat alignment', () => {
  it.each(AUCTION_COLUMNS)('should keep calls under their seat when %s opens', (seat) => {
    const start = AUCTION_COLUMNS.indexOf(seat);
    const auction = Array.from({ length: 9 }, (_, index) => ({
      seat: AUCTION_COLUMNS[(start + index) % 4], action: pass,
    }));
    for (const row of auctionRows(auction)) {
      row.forEach((call, column) => {
        if (call) expect(call.seat).toBe(AUCTION_COLUMNS[column]);
      });
    }
  });
  it.each(AUCTION_COLUMNS)('should show the initial wait marker under %s', (seat) => {
    expect(auctionWaitIndex([], seat)).toBe(AUCTION_COLUMNS.indexOf(seat));
  });
  it('should wrap the next bidder to the next row after south', () => {
    expect(auctionWaitIndex(calls.slice(0, 3), 'W')).toBe(4);
    expect(auctionWaitIndex(calls, 'N')).toBe(5);
    expect(auctionWaitIndex(calls, null)).toBe(-1);
  });
});

describe('remainingCards', () => {
  it('is 13 before play starts', () => {
    expect(remainingCards('E', null)).toBe(13);
  });
  it('subtracts completed tricks and a card already in the current trick', () => {
    const playing = {
      currentTrick: { W: { suit: 'spades', rank: 3 } },
      trickLeadSeat: 'W',
      currentTurnSeat: 'N',
      completedTricks: new Array(5).fill(null),
      trickCountEW: 3,
      trickCountNS: 2,
    } as unknown as PlayingState;
    expect(remainingCards('W', playing)).toBe(7);
    expect(remainingCards('N', playing)).toBe(8);
  });
});

describe('formatCountdown', () => {
  it('should round up to whole seconds as m:ss and never go negative', () => {
    expect(formatCountdown(180_000)).toBe('3:00');
    expect(formatCountdown(59_001)).toBe('1:00');
    expect(formatCountdown(9_500)).toBe('0:10');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5_000)).toBe('0:00');
  });
});

describe('lastMove', () => {
  it('finds the latest play, flip or pass and skips other entries', () => {
    expect(lastMove([])).toBeNull();
    expect(lastMove([{ type: 'bid', seat: 'N' }])).toBeNull();
    expect(lastMove([
      { type: 'play', seat: 'N' }, { type: 'pass', seat: 'E' }, { type: 'trick_end' }, { type: 'eliminated', seat: 'S' },
    ])).toEqual({ seat: 'E', index: 1, pass: true });
    expect(lastMove([{ type: 'flip', seat: 'W' }])).toEqual({ seat: 'W', index: 0, pass: false });
  });
});

describe('lastElimination', () => {
  it('finds the latest bust only', () => {
    expect(lastElimination([{ type: 'play', seat: 'N' }])).toBeNull();
    expect(lastElimination([
      { type: 'eliminated', seat: 'E' }, { type: 'play', seat: 'S' }, { type: 'eliminated', seat: 'W' }, { type: 'play', seat: 'N' },
    ])).toEqual({ seat: 'W', index: 2 });
  });
});

describe('seats taking part', () => {
  it('lists only occupied Blackjack and Hold\'em seats and all four elsewhere', () => {
    expect(matchSeats({ gameType: 'holdem', seats: ['N', 'W'] } as unknown as PlayerVisibleGameState)).toEqual(['N', 'W']);
    expect(matchSeats({ gameType: 'sevens' } as unknown as PlayerVisibleGameState)).toEqual(['N', 'E', 'S', 'W']);
    expect(matchSeats(null)).toEqual(['N', 'E', 'S', 'W']);
    const blackjack = { gameType: 'blackjack', chips: { N: 900, E: 0, S: 1100, W: 0 }, hands: 8, winners: ['S'] };
    expect(resultSeats({ ...blackjack, seats: ['N', 'S'] } as MatchResult)).toEqual(['N', 'S']);
    expect(resultSeats(blackjack as MatchResult)).toEqual(['N', 'E', 'S', 'W']);
  });
});
