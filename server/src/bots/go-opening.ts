// ─── Go bot opening knowledge ───
//
// 9 × 9: black opens on tengen. 13 × 13 and 19 × 19: while a corner is still empty and nothing on the board is
// short of liberties, take that corner on the 4-4 or a 3-4 point, the standard first moves; handicap stones already
// hold their corners, so white takes the free ones. Everything after comes from the search.

import { goChain, goIndex, goLiberties } from '@shared/rules/go';
import type { GoPosition, GoSize } from '@shared/rules/go';

/** Rows and columns of a corner that must be empty before the bot claims it. */
const CORNER_SPAN: Readonly<Record<GoSize, number>> = { 9: 0, 13: 6, 19: 7 };
/** The opening phase ends after this many moves even when a corner is still free. */
const OPENING_MOVES: Readonly<Record<GoSize, number>> = { 9: 1, 13: 8, 19: 14 };

/** Whether any chain on the board has two liberties or fewer: then fighting comes before taking corners. */
function anyChainShort(position: GoPosition): boolean {
  const { size, stones } = position;
  const seen = new Uint8Array(stones.length);
  for (let point = 0; point < stones.length; point++) {
    if (stones[point] === null || seen[point]) continue;
    const chain = goChain(size, stones, point);
    for (const stone of chain) seen[stone] = 1;
    if (goLiberties(size, stones, chain).length <= 2) return true;
  }
  return false;
}

/** The corner (`[flipCol, flipRow]`) regions without any stone. */
function emptyCorners(position: GoPosition): [boolean, boolean][] {
  const { size, stones } = position;
  const span = CORNER_SPAN[size];
  const corners: [boolean, boolean][] = [];
  for (const flipCol of [false, true]) {
    for (const flipRow of [false, true]) {
      let empty = true;
      for (let row = 0; row < span && empty; row++) {
        for (let col = 0; col < span && empty; col++) {
          const point = goIndex(size, flipCol ? size - 1 - col : col, flipRow ? size - 1 - row : row);
          if (stones[point] !== null) empty = false;
        }
      }
      if (empty) corners.push([flipCol, flipRow]);
    }
  }
  return corners;
}

/** A book move (intersection index) for the side to move, or null to search. */
export function goOpeningMove(position: GoPosition, random: () => number): number | null {
  const { size, stones } = position;
  if (position.moves >= OPENING_MOVES[size]) return null;
  if (size === 9) {
    const centre = goIndex(size, 4, 4);
    return stones.every((cell) => cell === null) && position.toMove === 0 ? centre : null;
  }
  if (anyChainShort(position)) return null;
  const corners = emptyCorners(position);
  if (corners.length === 0) return null;
  const [flipCol, flipRow] = corners[Math.floor(random() * corners.length)];
  const roll = random();
  // The 4-4 point half the time, otherwise one of the two 3-4 points.
  const [col, row] = roll < 0.5 ? [3, 3] : roll < 0.75 ? [2, 3] : [3, 2];
  return goIndex(size, flipCol ? size - 1 - col : col, flipRow ? size - 1 - row : row);
}
