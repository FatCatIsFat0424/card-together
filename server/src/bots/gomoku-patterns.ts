// ─── Gomoku line patterns: what one stone makes along one axis, looked up from a nine-cell window ───
//
// A window holds the cells four steps either side of an intersection, two bits each. The tables answer: if
// this side played the empty centre, what would the line through it become? Everything that is not the
// side's own stone (the opponent's stones and the board edge) blocks equally.

/** Line shape a stone makes, weakest first. */
export const NONE = 0;
/** Two stones that can still grow into a four with two more stones on a closed line */
export const TWO = 1;
/** Two stones that can still become an open three */
export const OPEN_TWO = 2;
/** Three stones that can become a four (but not an open four) */
export const THREE = 3;
/** Three stones that can become an open four: the opponent must answer now */
export const OPEN_THREE = 4;
/** Four stones with one completion: five next move unless blocked */
export const FOUR = 5;
/** Four stones with two completions: cannot be blocked */
export const OPEN_FOUR = 6;
export const FIVE = 7;

const WINDOW = 9;
const CENTRE = 4;

/** Contiguous own cells (value 1) around `x`. */
function runAround(cells: readonly number[], x: number): [number, number] {
  let start = x;
  let end = x;
  while (start > 0 && cells[start - 1] === 1) start--;
  while (end < WINDOW - 1 && cells[end + 1] === 1) end++;
  return [start, end];
}

/** Empty cells whose stone would complete a five through the centre; -1 when the centre already holds one. */
function completions(cells: number[]): number {
  const [start, end] = runAround(cells, CENTRE);
  if (end - start + 1 >= 5) return -1;
  let count = 0;
  for (let x = 0; x < WINDOW; x++) {
    if (cells[x] !== 0) continue;
    cells[x] = 1;
    const [s, e] = runAround(cells, x);
    cells[x] = 0;
    if (e - s + 1 >= 5 && s <= CENTRE && e >= CENTRE) count++;
  }
  return count;
}

const memo = new Int8Array(3 ** WINDOW).fill(-1);

/** Shape of the line when the centre (already own) is surrounded by `cells`: 0 empty, 1 own, 2 blocked. */
function level(cells: number[]): number {
  let key = 0;
  for (let i = WINDOW - 1; i >= 0; i--) key = key * 3 + cells[i];
  if (memo[key] >= 0) return memo[key];
  let result: number;
  const done = completions(cells);
  if (done < 0) result = FIVE;
  else if (done >= 2) result = OPEN_FOUR;
  else if (done === 1) result = FOUR;
  else {
    let makesFour = false;
    let makesOpenFour = false;
    for (let x = 0; x < WINDOW && !makesOpenFour; x++) {
      if (cells[x] !== 0) continue;
      cells[x] = 1;
      const next = completions(cells);
      cells[x] = 0;
      if (next >= 2) makesOpenFour = true;
      else if (next === 1) makesFour = true;
    }
    if (makesOpenFour) result = OPEN_THREE;
    else if (makesFour) result = THREE;
    else {
      let growsOpen = false;
      let growsClosed = false;
      for (let x = 0; x < WINDOW && !growsOpen; x++) {
        if (cells[x] !== 0) continue;
        cells[x] = 1;
        const next = level(cells);
        cells[x] = 0;
        if (next === OPEN_THREE) growsOpen = true;
        else if (next === THREE) growsClosed = true;
      }
      result = growsOpen ? OPEN_TWO : growsClosed ? TWO : NONE;
    }
  }
  memo[key] = result;
  return result;
}

/** Table entry not computed yet. */
const UNKNOWN = 255;

/**
 * `SHAPE[side][window]`: the shape side `side` makes by playing the window's empty centre. A window is nine
 * two-bit cells, the cell k steps along the axis at bits `2 * (k + 4)`; 0 empty, 1 black, 2 white, 3 off the
 * board. Windows whose centre is taken read 0. Entries fill in on first use (`shapeOf`), which keeps the
 * start of a worker cheap: a game only ever meets a small part of the 262,144 windows.
 */
export const SHAPE: readonly [Uint8Array, Uint8Array] = [new Uint8Array(4 ** WINDOW).fill(UNKNOWN), new Uint8Array(4 ** WINDOW).fill(UNKNOWN)];

const scratch = new Array<number>(WINDOW).fill(0);

function computeShape(side: 0 | 1, window: number): number {
  if (((window >> (2 * CENTRE)) & 3) !== 0) return NONE;
  const own = side + 1;
  for (let i = 0; i < WINDOW; i++) {
    const code = (window >> (2 * i)) & 3;
    scratch[i] = i === CENTRE ? 1 : code === 0 ? 0 : code === own ? 1 : 2;
  }
  return level(scratch);
}

/** The shape side `side` makes by playing the centre of `window`. */
export function shapeOf(side: 0 | 1, window: number): number {
  const known = SHAPE[side][window];
  if (known !== UNKNOWN) return known;
  return (SHAPE[side][window] = computeShape(side, window));
}
