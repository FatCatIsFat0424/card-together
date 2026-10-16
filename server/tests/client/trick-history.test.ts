import { describe, expect, it } from 'vitest';
import type { Card, TrickRecord } from '@shared/types';
import { bridgeTrickRows } from '../../../client/src/games/bridge/TrickHistory';
import { trickHistoryColumns } from '../../../client/src/games/TrickHistoryTable';

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('trick history table', () => {
  it('orders columns by seating from the viewer, or from the first seat without one', () => {
    const seats = ['N', 'E', 'S', 'W', 'P5'] as const;
    expect(trickHistoryColumns(seats, 'S')).toEqual(['S', 'W', 'P5', 'N', 'E']);
    expect(trickHistoryColumns(seats, 'P6')).toEqual(['N', 'E', 'S', 'W', 'P5']);
    expect(trickHistoryColumns(seats, null)).toEqual(['N', 'E', 'S', 'W', 'P5']);
  });

  it('keeps each Bridge card under its seat whoever leads', () => {
    const tricks: TrickRecord[] = [
      { leadSeat: 'W', winnerSeat: 'E',
        cards: { W: card(2, 'clubs'), N: card(5, 'clubs'), E: card(14, 'clubs'), S: card(9, 'clubs') } },
    ];
    expect(bridgeTrickRows(tricks)).toEqual([{ number: 1, leadSeat: 'W', winnerSeat: 'E', cards: tricks[0].cards }]);
  });
});
