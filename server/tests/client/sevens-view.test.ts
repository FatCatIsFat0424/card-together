import { describe, expect, it } from 'vitest';
import type { Card, SevensLogEntry, SevensTable } from '@shared/types';
import {
  coverCost, coverSelection, lastPlayedCard, rankAtOrder, recentMoves, sevensHandMode, sevensRows,
} from '../../../client/src/games/sevens/sevens-view';
import { sevensTranslations } from '../../../client/src/sevens-i18n';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const empty: SevensTable = { spades: null, hearts: null, clubs: null, diamonds: null };

describe('rankAtOrder', () => {
  it('maps row positions back to ranks with the ace at the low end', () => {
    expect(rankAtOrder(1)).toBe(14);
    expect(rankAtOrder(7)).toBe(7);
    expect(rankAtOrder(13)).toBe(13);
  });

  it('rejects positions outside the row', () => {
    expect(() => rankAtOrder(0)).toThrow();
    expect(() => rankAtOrder(14)).toThrow();
    expect(() => rankAtOrder(2.5)).toThrow();
  });
});

describe('sevensRows', () => {
  it('lists the suits in display order with thirteen A…K slots each', () => {
    const rows = sevensRows(empty, []);
    expect(rows.map((row) => row.suit)).toEqual(['spades', 'hearts', 'clubs', 'diamonds']);
    for (const row of rows) {
      expect(row.open).toBe(false);
      expect(row.slots.map((slot) => slot.card.rank)).toEqual([14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
      expect(row.slots.filter((slot) => slot.state === 'next').map((slot) => slot.order)).toEqual([7]);
      expect(row.slots.filter((slot) => slot.state === 'played')).toEqual([]);
    }
  });

  it('marks played ranges and the next slot at each open end', () => {
    const table: SevensTable = { ...empty, hearts: { low: 5, high: 9 } };
    const hearts = sevensRows(table, [])[1];
    expect(hearts.open).toBe(true);
    expect(hearts.slots.filter((slot) => slot.state === 'played').map((slot) => slot.order)).toEqual([5, 6, 7, 8, 9]);
    expect(hearts.slots.filter((slot) => slot.state === 'next').map((slot) => slot.order)).toEqual([4, 10]);
    expect(hearts.slots[0].state).toBe('empty');
  });

  it('does not offer slots beyond the ace or king ends', () => {
    const table: SevensTable = { ...empty, clubs: { low: 1, high: 13 }, spades: { low: 1, high: 7 } };
    const rows = sevensRows(table, []);
    expect(rows[2].slots.every((slot) => slot.state === 'played')).toBe(true);
    expect(rows[0].slots.filter((slot) => slot.state === 'next').map((slot) => slot.card.rank)).toEqual([8]);
  });

  it('marks end rows closed and removes their next slots and targets when enabled', () => {
    const table: SevensTable = {
      spades: { low: 1, high: 7 }, hearts: { low: 7, high: 13 }, clubs: { low: 6, high: 7 }, diamonds: null,
    };
    const targets = [c(8, 'spades'), c(6, 'hearts'), c(8, 'clubs'), c(7, 'diamonds')];
    const before = structuredClone(table);
    const rows = sevensRows(table, targets, true);
    for (const row of rows.slice(0, 2)) {
      expect(row.open).toBe(true);
      expect(row.closed).toBe(true);
      expect(row.slots.some((slot) => slot.state === 'next' || slot.target)).toBe(false);
      expect(row.slots.filter((slot) => slot.state === 'played')).toHaveLength(7);
    }
    expect(rows[2].closed).toBe(false);
    expect(rows[3].closed).toBe(false);
    expect(rows.flatMap((row) => row.slots.filter((slot) => slot.target).map((slot) => slot.card)))
      .toEqual([c(8, 'clubs'), c(7, 'diamonds')]);
    expect(table).toEqual(before);
    expect(targets).toHaveLength(4);

    const defaultRows = sevensRows(table, targets);
    expect(defaultRows).toEqual(sevensRows(table, targets, false));
    expect(defaultRows.slice(0, 2).every((row) => !row.closed)).toBe(true);
    expect(defaultRows[0].slots[7].target).toBe(true);
    expect(defaultRows[1].slots[5].target).toBe(true);
  });

  it('highlights only next slots that match the player\'s valid cards', () => {
    const table: SevensTable = { ...empty, spades: { low: 7, high: 7 } };
    const targets = [c(6, 'spades'), c(7, 'diamonds'), c(9, 'spades')];
    const rows = sevensRows(table, targets);
    const marked = rows.flatMap((row) => row.slots.filter((slot) => slot.target).map((slot) => slot.card));
    expect(marked).toEqual([c(6, 'spades'), c(7, 'diamonds')]);
    expect(targets).toHaveLength(3);
  });
});

describe('sevensHandMode', () => {
  it('plays when the server offers valid cards on the player\'s turn', () => {
    expect(sevensHandMode(true, [c(7, 'spades')], 13)).toBe('play');
  });

  it('covers only on the player\'s own turn with no valid cards', () => {
    expect(sevensHandMode(true, [], 5)).toBe('cover');
    expect(sevensHandMode(false, [], 5)).toBe('wait');
  });

  it('waits when the hand is empty', () => {
    expect(sevensHandMode(true, [], 0)).toBe('wait');
  });
});

describe('cover helpers', () => {
  it('drops a selection that has left the hand', () => {
    const hand = [c(13, 'spades'), c(2, 'hearts')];
    expect(coverSelection(c(2, 'hearts'), hand)).toEqual(c(2, 'hearts'));
    expect(coverSelection(c(3, 'hearts'), hand)).toBeNull();
    expect(coverSelection(null, hand)).toBeNull();
  });

  it('prices the selected card and the resulting penalty', () => {
    expect(coverCost(c(14, 'clubs'), [])).toEqual({ penalty: 1, total: 1 });
    expect(coverCost(c(13, 'spades'), [c(12, 'hearts'), c(14, 'diamonds')])).toEqual({ penalty: 13, total: 26 });
  });
});

describe('log helpers', () => {
  const log: SevensLogEntry[] = [
    { type: 'play', seat: 'S', card: c(7, 'spades'), timestamp: 1 },
    { type: 'play', seat: 'E', card: c(8, 'spades'), timestamp: 2 },
    { type: 'cover', seat: 'N', timestamp: 3 },
  ];

  it('finds the latest played card past cover entries', () => {
    expect(lastPlayedCard(log)).toEqual(c(8, 'spades'));
    expect(lastPlayedCard([])).toBeNull();
    expect(lastPlayedCard([{ type: 'cover', seat: 'W', timestamp: 1 }])).toBeNull();
  });

  it('returns recent moves newest first without mutating the log', () => {
    expect(recentMoves(log, 2).map((entry) => entry.timestamp)).toEqual([3, 2]);
    expect(recentMoves(log, 10)).toHaveLength(3);
    expect(recentMoves(log, 0)).toEqual([]);
    expect(log.map((entry) => entry.timestamp)).toEqual([1, 2, 3]);
  });
});

describe('sevens translations', () => {
  it('defines every key in both locales', () => {
    expect(Object.keys(sevensTranslations['zh-TW']).sort()).toEqual(Object.keys(sevensTranslations.en).sort());
    for (const value of Object.values(sevensTranslations['zh-TW'])) expect(value.trim()).not.toBe('');
  });
});
