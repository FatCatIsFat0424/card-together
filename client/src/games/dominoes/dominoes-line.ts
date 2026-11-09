import type { DominoPlacement } from '@shared/games/dominoes/types';

/** Width of one slot in half-tile edges: a tile lies two long, a double stands one wide, an end marker is a stub. */
const TILE_WIDTH = 2;
const DOUBLE_WIDTH = 1;
const MARKER_WIDTH = 1.25;
const MIN_EDGE = 8;
const MAX_EDGE = 44;

export interface LineSlot {
  readonly kind: 'marker' | 'tile';
  /** Which end a marker names, or the position of a tile in the line */
  readonly side?: 'left' | 'right';
  readonly index?: number;
  readonly double: boolean;
}

/** The markers for both open ends around the tiles, in line order. */
export function lineSlots(line: readonly DominoPlacement[]): LineSlot[] {
  return [
    { kind: 'marker', side: 'left', double: false },
    ...line.map((placed, index): LineSlot => ({ kind: 'tile', index, double: placed.left === placed.right })),
    { kind: 'marker', side: 'right', double: false },
  ];
}

export interface LineFit {
  /** Edge of one half-tile in pixels */
  readonly edge: number;
  /** Slot indices per row, in line order; odd rows are drawn right to left so the line snakes */
  readonly rows: readonly (readonly number[])[];
}

export const lineGap = (edge: number): number => Math.max(2, Math.round(edge * 0.12));
const rowGap = (edge: number): number => Math.max(2, Math.round(edge * 0.2));

function slotWidth(slot: LineSlot, edge: number): number {
  return edge * (slot.kind === 'marker' ? MARKER_WIDTH : slot.double ? DOUBLE_WIDTH : TILE_WIDTH);
}

function pack(slots: readonly LineSlot[], edge: number, width: number): number[][] {
  const gap = lineGap(edge);
  const rows: number[][] = [[]];
  let used = 0;
  slots.forEach((slot, index) => {
    const needed = slotWidth(slot, edge);
    const row = rows[rows.length - 1];
    if (row.length > 0 && used + gap + needed > width) {
      rows.push([index]);
      used = needed;
    } else {
      used += (row.length > 0 ? gap : 0) + needed;
      row.push(index);
    }
  });
  return rows;
}

/** Height of a packed layout: a row holding a standing double is two edges tall. */
function packedHeight(slots: readonly LineSlot[], rows: readonly (readonly number[])[], edge: number): number {
  const heights = rows.map((row) => edge * (row.some((index) => slots[index].double) ? 2 : 1));
  return heights.reduce((sum, height) => sum + height, 0) + rowGap(edge) * (rows.length - 1);
}

/** The largest tile size at which the whole line, both end markers included, fits the given box. */
export function fitLine(slots: readonly LineSlot[], width: number, height: number): LineFit {
  for (let edge = MAX_EDGE; edge >= MIN_EDGE; edge--) {
    const rows = pack(slots, edge, width);
    if (packedHeight(slots, rows, edge) <= height) return { edge, rows };
  }
  return { edge: MIN_EDGE, rows: pack(slots, MIN_EDGE, width) };
}

/** Whether row `row` runs right to left. */
export const reversedRow = (row: number): boolean => row % 2 === 1;
