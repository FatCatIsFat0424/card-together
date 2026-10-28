import { describe, expect, it } from 'vitest';
import type { GameSeat, MatchResult, PlayerVisibleGameState, PlayingState } from '@shared/types';
import {
  AUCTION_COLUMNS, auctionRows, auctionWaitIndex, formatCountdown, lastElimination, lastMove, latestCallIndex, matchSeats,
  remainingCards, resultSeats, seatLayout, tablePosition,
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
  it('should lay out a Napoleon auction under its own four to six seat columns', () => {
    const columns = ['N', 'E', 'S', 'W', 'P5', 'P6'] as const;
    const napoleon: AuctionCall[] = [
      { seat: 'P5', action: { type: 'bid', level: 9, suit: 'clubs' } },
      { seat: 'P6', action: pass },
      { seat: 'N', action: { type: 'bid', level: 10, suit: 'nt' } },
    ];
    expect(auctionRows(napoleon, columns)).toEqual([
      [null, null, null, null, napoleon[0], napoleon[1]],
      [napoleon[2], null, null, null, null, null],
    ]);
    expect(auctionWaitIndex(napoleon, 'E', columns)).toBe(7);
    expect(auctionWaitIndex([], 'P6', columns)).toBe(5);
  });
  it('should wrap the next bidder to the next row after south', () => {
    expect(auctionWaitIndex(calls.slice(0, 3), 'W')).toBe(4);
    expect(auctionWaitIndex(calls, 'N')).toBe(5);
    expect(auctionWaitIndex(calls, null)).toBe(-1);
  });
});

describe('latestCallIndex', () => {
  it("finds each seat's most recent call, or -1 before it has called", () => {
    const auction: AuctionCall[] = [
      { seat: 'N', action: { type: 'bid', level: 1, suit: 'clubs' } },
      { seat: 'E', action: pass },
      { seat: 'S', action: { type: 'bid', level: 1, suit: 'nt' } },
      { seat: 'W', action: pass },
      { seat: 'N', action: { type: 'bid', level: 3, suit: 'hearts' } },
    ];
    expect(latestCallIndex(auction, 'N')).toBe(4);
    expect(latestCallIndex(auction, 'E')).toBe(1);
    expect(latestCallIndex(auction, 'S')).toBe(2);
    expect(latestCallIndex([], 'W')).toBe(-1);
    expect(latestCallIndex(auction.slice(0, 2), 'S')).toBe(-1);
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
    expect(matchSeats({ gameType: 'napoleon', seats: ['N', 'E', 'S', 'W', 'P5'] } as unknown as PlayerVisibleGameState))
      .toEqual(['N', 'E', 'S', 'W', 'P5']);
    expect(resultSeats({ gameType: 'napoleon', seats: ['N', 'E', 'S', 'W', 'P5', 'P6'] } as unknown as MatchResult))
      .toEqual(['N', 'E', 'S', 'W', 'P5', 'P6']);
  });
});

describe('table seat layouts', () => {
  const positions = (seats: GameSeat[], me: GameSeat) => seats.map((seat) => tablePosition(seat, me, seats));

  it('seats two players face to face whichever seats they hold', () => {
    expect(seatLayout(['N', 'E'])).toBe('facing');
    expect(positions(['N', 'E'], 'N')).toEqual(['bottom', 'top']);
    expect(positions(['N', 'E'], 'E')).toEqual(['top', 'bottom']);
    expect(positions(['E', 'P5'], 'P5')).toEqual(['top', 'bottom']);
  });

  it('seats three players at bottom, upper left and upper right in turn order', () => {
    expect(seatLayout(['N', 'E', 'S'])).toBe('trio');
    expect(positions(['N', 'E', 'S'], 'N')).toEqual(['bottom', 'topLeft', 'topRight']);
    expect(positions(['N', 'E', 'S'], 'E')).toEqual(['topRight', 'bottom', 'topLeft']);
    expect(positions(['N', 'S', 'P5'], 'P5')).toEqual(['topLeft', 'topRight', 'bottom']);
  });

  it('keeps the compass cross for four compass seats', () => {
    expect(seatLayout(['N', 'E', 'S', 'W'])).toBe('compass');
    expect(positions(['N', 'E', 'S', 'W'], 'S')).toEqual(['top', 'right', 'bottom', 'left']);
    expect(tablePosition('W', 'N')).toBe('right');
  });

  it('rings four seats that include an additional seat, and five to eight seats', () => {
    expect(seatLayout(['N', 'E', 'S', 'P5'])).toBe('ring');
    expect(positions(['N', 'E', 'S', 'P5'], 'N')).toEqual(['bottom', 'left', 'top', 'right']);
    const five: GameSeat[] = ['N', 'E', 'S', 'W', 'P5'];
    expect(positions(five, 'N')).toEqual(['bottom', 'left', 'topLeft', 'topRight', 'right']);
    const six: GameSeat[] = [...five, 'P6'];
    expect(positions(six, 'N')).toEqual(['bottom', 'bottomLeft', 'topLeft', 'top', 'topRight', 'bottomRight']);
    const eight: GameSeat[] = [...six, 'P7', 'P8'];
    expect(positions(eight, 'W')).toEqual(['topRight', 'right', 'bottomRight', 'bottom', 'bottomLeft', 'left', 'topLeft', 'top']);
    expect(positions(eight, 'N')).toEqual(['bottom', 'bottomLeft', 'left', 'topLeft', 'top', 'topRight', 'right', 'bottomRight']);
  });

  it('always puts the viewer at the bottom', () => {
    for (const seats of [['N', 'S'], ['E', 'S', 'W'], ['N', 'E', 'S', 'W'], ['N', 'E', 'S', 'P5', 'P6'], ['N', 'E', 'S', 'W', 'P5', 'P6', 'P7', 'P8']] as GameSeat[][]) {
      for (const me of seats) expect(tablePosition(me, me, seats)).toBe('bottom');
    }
  });
});
