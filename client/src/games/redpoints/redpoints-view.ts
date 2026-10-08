import type { Card } from '@shared/types';
import { rpPairOptions } from '@shared/rules/redpoints';

export type RedPointsCardAction = { type: 'choose' } | { type: 'play'; capture: Card | null };

/** Ask only when the table offers a meaningful capture choice. */
export function redPointsCardAction(card: Card, table: readonly Card[]): RedPointsCardAction {
  const options = rpPairOptions(card, table);
  return options.length > 1 ? { type: 'choose' } : { type: 'play', capture: options[0] ?? null };
}

export interface RedPointsTableLayout {
  columns: number;
  rows: number;
  cardWidth: number;
  pageSize: number;
}

/** Fit the measured table viewport, reserving room for capture/focus outlines. */
export function redPointsTableLayout(width: number, height: number, cardCount = Infinity): RedPointsTableLayout {
  const availableWidth = Math.max(0, width - 8);
  const availableHeight = Math.max(0, height - 8);
  const minimumColumns = Math.min(4, Math.max(1, Math.floor((availableWidth + 6) / 50)));
  const columns = Math.min(Math.max(1, cardCount), 8, Math.max(minimumColumns, Math.floor((availableWidth + 6) / 74)));
  const rows = Math.min(Math.max(1, Math.ceil(cardCount / columns)), 2, Math.max(1, Math.floor((availableHeight + 6) / (44 * 313 / 224 + 6))));
  // A very short allocated viewport cannot fit a 44px card: never invent space and crop it.
  const cardWidth = Math.max(0, Math.floor(Math.min(cardCount <= 4 ? 110 : 80,
    (availableWidth - (columns - 1) * 6) / columns,
    (availableHeight - (rows - 1) * 6) / rows * 224 / 313)));
  return { columns, rows, cardWidth, pageSize: columns * rows };
}

export interface RedPointsTablePage {
  cards: readonly Card[];
  page: number;
  pageCount: number;
}

/** Preserve table positions; capture previews never affect pagination. */
export function redPointsTablePage(
  table: readonly Card[], requestedPage: number, pageSize: number,
): RedPointsTablePage {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(table.length / size));
  const page = Math.min(pageCount - 1, Math.max(0, Math.floor(requestedPage)));
  return { cards: table.slice(page * size, (page + 1) * size), page, pageCount };
}
