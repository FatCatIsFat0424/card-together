/** Width of one hand tile's tap area in pixels; the drawn tile sits centred inside it. */
export const HAND_HIT = 40;
/** Narrowest tap area a hand accepts before it adds another row. */
export const HAND_HIT_NARROW = 32;
/** Space between neighbouring tap areas in a row. */
export const HAND_GAP = 2;
const MAX_ROWS = 4;
/** A hand wraps into two rows before its tap areas narrow below full size, but never into a third. */
const NARROWING_ROWS = 2;
const MIN_HIT = 24;

export interface HandFit {
  readonly rows: number;
  /** Tiles per row; the rows are balanced so a wrapped hand never leaves a lone tile on the last one */
  readonly perRow: number;
  /** Width of one tap area in pixels */
  readonly hit: number;
}

const rowWidth = (perRow: number, hit: number): number => perRow * hit + (perRow - 1) * HAND_GAP;
const hitFor = (perRow: number, width: number): number => Math.floor((width - (perRow - 1) * HAND_GAP) / perRow);

/**
 * How a hand of `count` tiles lays out in `width` pixels. Tiles keep a full tap area in one row, then in two
 * rows; a hand still too wide narrows its tap areas to at most `HAND_HIT_NARROW` before a third row opens.
 * Only a box too narrow even for four rows narrows them further.
 */
export function fitHand(count: number, width: number): HandFit {
  if (count <= 1 || width <= 0) return { rows: 1, perRow: Math.max(1, count), hit: HAND_HIT };
  const perRowOf = (rows: number): number => Math.ceil(count / rows);
  /** Balancing can leave the last planned row empty, so the row count follows from the row length. */
  const layout = (rows: number, hit: number): HandFit => ({ rows: Math.ceil(count / perRowOf(rows)), perRow: perRowOf(rows), hit });
  for (let rows = 1; rows <= NARROWING_ROWS; rows++) {
    if (rowWidth(perRowOf(rows), HAND_HIT) <= width) return layout(rows, HAND_HIT);
  }
  const narrowed = hitFor(perRowOf(NARROWING_ROWS), width);
  if (narrowed >= HAND_HIT_NARROW) return layout(NARROWING_ROWS, narrowed);
  for (let rows = NARROWING_ROWS + 1; rows <= MAX_ROWS; rows++) {
    if (rowWidth(perRowOf(rows), HAND_HIT) <= width) return layout(rows, HAND_HIT);
  }
  return layout(MAX_ROWS, Math.max(MIN_HIT, hitFor(perRowOf(MAX_ROWS), width)));
}
