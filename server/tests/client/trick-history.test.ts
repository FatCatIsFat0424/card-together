import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card, TrickRecord } from '@shared/types';
import { viewerFirstSeats } from '../../../client/src/game-view';
import { bridgeSeatColumns, bridgeTrickRows } from '../../../client/src/games/bridge/TrickHistory';
import { TrickHistoryTable } from '../../../client/src/games/TrickHistoryTable';
import { compactSeatLabel } from '../../../client/src/games/seat-names';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('trick history table', () => {
  it('orders columns by seating from the viewer, or from the first seat without one', () => {
    const seats = ['N', 'E', 'S', 'W', 'P5'] as const;
    expect(viewerFirstSeats(seats, 'S')).toEqual(['S', 'W', 'P5', 'N', 'E']);
    expect(viewerFirstSeats(seats, 'P6')).toEqual(['N', 'E', 'S', 'W', 'P5']);
    expect(viewerFirstSeats(seats, null)).toEqual(['N', 'E', 'S', 'W', 'P5']);
  });

  it('keeps each Bridge card under its seat whoever leads', () => {
    const tricks: TrickRecord[] = [
      { leadSeat: 'W', winnerSeat: 'E',
        cards: { W: card(2, 'clubs'), N: card(5, 'clubs'), E: card(14, 'clubs'), S: card(9, 'clubs') } },
    ];
    expect(bridgeTrickRows(tricks)).toEqual([{ number: 1, leadSeat: 'W', winnerSeat: 'E', cards: tricks[0].cards }]);
  });

  it('lists a running auction above the tricks under the same seat columns', () => {
    useI18nStore.getState().setLocale('en');
    const names: Record<string, string> = { N: 'Ann', E: 'Bot E', S: 'Cat', W: 'Dan' };
    const columns = bridgeSeatColumns('E');
    const calls = [
      { seat: 'W', action: { type: 'bid', level: 1, suit: 'clubs' } },
      { seat: 'N', action: { type: 'pass' } },
    ] as const;
    const html = renderToStaticMarkup(createElement(TrickHistoryTable, { rows: [], columns, mySeat: 'E',
      cardText: () => '', seatName: (seat) => names[seat], auction: { calls, toAct: 'E', finished: false } }));
    const headings = [...html.matchAll(/<th scope="col"[^>]*><span[^>]*>([^<]*)<\/span><\/th>/g)].map((match) => match[1]);
    expect(headings).toEqual(['Bot E', 'Cat', 'Dan', 'Ann']);
    const cells = [...html.matchAll(/<tr class="[^"]*calls[^"]*">(.*?)<\/tr>/g)]
      .map((match) => [...match[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((cell) => cell[1].replace(/<[^>]+>/g, '')));
    // West opened, so the viewer's next call waits on a new row under their own column.
    expect(cells).toEqual([['', '', '1♣', 'P'], ['?', '', '', '']]);
    expect(html).not.toContain('Trick history');
    expect(html).toContain('Game record');
  });

  it('folds a finished auction behind a toggle above the tricks', () => {
    const tricks = bridgeTrickRows([{ leadSeat: 'E', winnerSeat: 'E',
      cards: { E: card(14, 'clubs'), S: card(2, 'clubs'), W: card(3, 'clubs'), N: card(4, 'clubs') } }]);
    const html = renderToStaticMarkup(createElement(TrickHistoryTable, { rows: tricks, columns: bridgeSeatColumns('E'),
      mySeat: 'E', cardText: () => '', seatName: (seat) => seat,
      auction: { calls: [{ seat: 'E', action: { type: 'bid', level: 1, suit: 'nt' } }], toAct: null,
        finished: true } }));
    expect(html).toMatch(/aria-expanded="false"><span>Auction<\/span>/);
    expect(html).not.toMatch(/class="[^"]*calls/);
    expect(html.indexOf('aria-expanded')).toBeLessThan(html.search(/<tbody class="[^"]*trick/));
  });

  it('heads Napoleon columns with seat numbers and keeps the name as the hover title', () => {
    useI18nStore.getState().setLocale('zh-TW');
    const { t } = useI18nStore.getState();
    const columns = viewerFirstSeats(['N', 'E', 'S', 'W', 'P5', 'P6'], 'S');
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
