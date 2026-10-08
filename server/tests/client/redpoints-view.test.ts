import { describe, expect, it } from 'vitest';
import type { Card } from '@shared/types';
import { redPointsCardAction, redPointsTableLayout, redPointsTablePage } from '../../../client/src/games/redpoints/redpoints-view';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('redPointsCardAction', () => {
  it('discards immediately when the chosen card cannot capture', () => {
    expect(redPointsCardAction(c(3, 'clubs'), [c(5, 'hearts')]))
      .toEqual({ type: 'play', capture: null });
  });

  it('captures the sole legal card without another confirmation', () => {
    expect(redPointsCardAction(c(3, 'clubs'), [c(5, 'hearts'), c(7, 'spades')]))
      .toEqual({ type: 'play', capture: c(7, 'spades') });
    expect(redPointsCardAction(c(14, 'clubs'), [c(9, 'diamonds')]))
      .toEqual({ type: 'play', capture: c(9, 'diamonds') });
    expect(redPointsCardAction(c(12, 'clubs'), [c(12, 'hearts')]))
      .toEqual({ type: 'play', capture: c(12, 'hearts') });
  });

  it('preserves the player choice between captures with different scores', () => {
    const table = Object.freeze([c(7, 'spades'), c(7, 'hearts')]);
    expect(redPointsCardAction(c(3, 'clubs'), table)).toEqual({ type: 'choose' });
    expect(table).toEqual([c(7, 'spades'), c(7, 'hearts')]);
  });
});

describe('redPointsTableLayout', () => {
  it.each([[228, 92], [324, 92], [228, 88], [324, 118], [338, 208], [588, 308]])(
    'fits full readable cards and focus outlines into an actual %i by %i table viewport', (width, height) => {
      const layout = redPointsTableLayout(width, height);
      expect(layout.cardWidth).toBeGreaterThanOrEqual(44);
      expect(layout.cardWidth).toBeLessThanOrEqual(80);
      expect(layout.columns * layout.cardWidth + (layout.columns - 1) * 6 + 8).toBeLessThanOrEqual(width);
      expect(layout.rows * layout.cardWidth * 313 / 224 + (layout.rows - 1) * 6 + 8).toBeLessThanOrEqual(height);
      expect(layout.pageSize).toBe(layout.columns * layout.rows);
    },
  );

  it.each([24, 40, 60, 68])('does not invent a minimum card height in a %ipx-high viewport', (height) => {
    const layout = redPointsTableLayout(400, height);
    expect(layout.rows).toBe(1);
    expect(layout.cardWidth * 313 / 224 + 8).toBeLessThanOrEqual(height);
  });

  it('keeps all four possible captures on a compact first page', () => {
    expect(redPointsTableLayout(228, 88).pageSize).toBeGreaterThanOrEqual(4);
  });

  it('keeps a four-card capture choice usable in a 160px-high compact centre', () => {
    // The compact CSS reserves 72px for two control rows, gaps, and frame padding.
    const layout = redPointsTableLayout(232, 160 - 72);
    expect(layout.cardWidth).toBeGreaterThanOrEqual(44);
    expect(layout.rows).toBe(1);
    expect(layout.pageSize).toBe(4);
  });

  it('uses larger cards when a desktop centre has enough space', () => {
    expect(redPointsTableLayout(348, 258).cardWidth).toBe(80);
  });

  it('enlarges a sparse table into two columns without reserving unused rows', () => {
    const layout = redPointsTableLayout(228, 208, 2);
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(1);
    expect(layout.cardWidth).toBeGreaterThan(80);
    expect(layout.columns * layout.cardWidth + 6 + 8).toBeLessThanOrEqual(228);
    expect(layout.cardWidth * 313 / 224 + 8).toBeLessThanOrEqual(208);
  });

  it('uses two readable rows in a narrow table instead of paging after one row', () => {
    const layout = redPointsTableLayout(205, 194, 12);
    expect(layout.rows).toBe(2);
    expect(layout.pageSize).toBe(layout.columns * 2);
    expect(layout.cardWidth).toBeGreaterThanOrEqual(44);
    expect(layout.cardWidth * 313 / 224 * 2 + 6 + 8).toBeLessThanOrEqual(194);
  });

  it('limits even a tall crowded table to two rows', () => {
    expect(redPointsTableLayout(600, 800, 28).rows).toBe(2);
  });

  it('does not allocate a visible card to a zero-size viewport', () => {
    expect(redPointsTableLayout(0, 0).cardWidth).toBe(0);
  });
});

describe('redPointsTablePage', () => {
  const table = (['clubs', 'diamonds', 'hearts', 'spades'] as const)
    .flatMap((suit) => ([2, 3, 4, 5, 6, 7, 8] as const).map((rank) => c(rank, suit)));

  it('pages a crowded table without losing, duplicating, or mutating cards', () => {
    const original = structuredClone(table);
    const pages = Array.from({ length: 7 }, (_, page) => redPointsTablePage(table, page, 4));
    expect(pages.flatMap((page) => page.cards)).toEqual(table);
    expect(pages.every((page) => page.cards.length === 4 && page.pageCount === 7)).toBe(true);
    expect(table).toEqual(original);
  });

  it('keeps capture targets in their original slots on the requested page', () => {
    const page = redPointsTablePage(table, 1, 4);
    expect(page.page).toBe(1);
    expect(page.cards).toEqual(table.slice(4, 8));
    expect(page.cards[1]).toEqual(c(7, 'clubs'));
    expect(redPointsTablePage(table, 0, 4).cards).toEqual(table.slice(0, 4));
  });

  it('clamps stale page indices after table shrink and handles an empty table', () => {
    expect(redPointsTablePage(table.slice(0, 5), 6, 4))
      .toEqual({ cards: table.slice(4, 5), page: 1, pageCount: 2 });
    expect(redPointsTablePage([], 6, 4)).toEqual({ cards: [], page: 0, pageCount: 1 });
  });
});
