import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card, TrickRecord } from '@shared/types';
import { bridgeTrickRows } from '../../../client/src/games/bridge/TrickHistory';
import { TrickHistoryTable, trickHistoryColumns } from '../../../client/src/games/TrickHistoryTable';
import { compactSeatLabel } from '../../../client/src/games/seat-names';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

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

  it('heads Napoleon columns with seat numbers and keeps the name as the hover title', () => {
    useI18nStore.getState().setLocale('zh-TW');
    const { t } = useI18nStore.getState();
    const columns = trickHistoryColumns(['N', 'E', 'S', 'W', 'P5', 'P6'], 'S');
    const rows = [{ number: 1, leadSeat: 'S' as const, winnerSeat: 'E' as const,
      cards: { S: card(2, 'clubs'), W: card(5, 'clubs'), P5: card(9, 'clubs'), P6: card(3, 'clubs'),
        N: card(4, 'clubs'), E: card(14, 'clubs') } }];
    const html = renderToStaticMarkup(createElement(TrickHistoryTable, { rows, columns, mySeat: 'S',
      cardText: () => '', columnLabel: (seat) => compactSeatLabel(t, 'napoleon', seat) }));
    const headings = [...html.matchAll(/<th scope="col"[^>]*><span[^>]*>([^<]*)<\/span><\/th>/g)].map((match) => match[1]);
    expect(headings).toEqual(['3', '4', '5', '6', '1', '2']);
    expect(html).toContain('title="南"');
    useI18nStore.getState().setLocale('en');
  });
});
