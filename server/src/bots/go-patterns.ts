// ─── Go bot 3 × 3 patterns: the playout shapes and the codes behind the fitted move priors ───
//
// A pattern code packs the eight neighbours of a point, two bits each (`EMPTY`, `BLACK`, `WHITE`, `EDGE`), in the
// order NW, N, NE, W, E, SW, S, SE. The playout shapes are the classic MoGo hane, cut, and edge patterns (Gelly
// et al., 2006), matched in every rotation, reflection, and colour swap. The prior model reads codes relative to
// the side to move (own stones as `BLACK`) folded to one canonical code per symmetry class.

import type { Board } from './go-board';

const CODES = 1 << 16;

/** The pattern code around `point`. */
export function patternCode(board: Board, point: number): number {
  const c = board.colour;
  const w = board.geometry.width;
  return c[point - w - 1] | (c[point - w] << 2) | (c[point - w + 1] << 4) | (c[point - 1] << 6)
    | (c[point + 1] << 8) | (c[point + w - 1] << 10) | (c[point + w] << 12) | (c[point + w + 1] << 14);
}

/** Neighbour offsets `[dx, dy]` in code order. */
const OFFSETS: readonly (readonly [number, number])[] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** For each of the eight symmetries, the code slot each slot moves to. */
const SYMMETRIES: readonly (readonly number[])[] = (() => {
  const transforms: ((x: number, y: number) => [number, number])[] = [
    (x, y) => [x, y], (x, y) => [-y, x], (x, y) => [-x, -y], (x, y) => [y, -x],
    (x, y) => [-x, y], (x, y) => [x, -y], (x, y) => [y, x], (x, y) => [-y, -x],
  ];
  return transforms.map((transform) => OFFSETS.map(([x, y]) => {
    const [tx, ty] = transform(x, y);
    return OFFSETS.findIndex(([ox, oy]) => ox === tx && oy === ty);
  }));
})();

function transformCode(code: number, symmetry: readonly number[]): number {
  let result = 0;
  for (let slot = 0; slot < 8; slot++) result |= ((code >> (2 * slot)) & 3) << (2 * symmetry[slot]);
  return result;
}

/** A code with black and white exchanged: the two bits of a slot flip where they differ (01 and 10). */
export function swapColours(code: number): number {
  const differ = (code ^ (code >> 1)) & 0x5555;
  return code ^ (differ | (differ << 1));
}

/** Canonical codes computed so far (-1 until first asked), so loading the module costs nothing. */
const CANONICAL = new Int32Array(CODES).fill(-1);

/** The smallest code among a code's eight symmetric images: one representative per symmetry class. */
export function canonicalCode(code: number): number {
  let best = CANONICAL[code];
  if (best >= 0) return best;
  best = code;
  for (const symmetry of SYMMETRIES) best = Math.min(best, transformCode(code, symmetry));
  CANONICAL[code] = best;
  return best;
}

/** The canonical code around `point` with the side to move's stones as `BLACK`. */
export function ownPatternCode(board: Board, point: number): number {
  const code = patternCode(board, point);
  return canonicalCode(board.toMove === 1 ? code : swapColours(code));
}

/**
 * MoGo playout shapes, centre empty: `X` and `O` the two colours, `.` empty, `#` edge, `x` not `X`, `o` not `O`,
 * `?` anything. Each also matches with the colours exchanged, so a shape serves both sides.
 */
const MOGO_SHAPES: readonly string[] = [
  'XOX...???', // hane: enclosing hane
  'XO....?.?', // hane: non-cutting hane
  'XO?X..x.?', // hane: magari
  '.O.X.....', // katatsuke or diagonal attachment
  'XO?O.o?o?', // cut: unprotected
  'XO?O.X???', // cut: peeped
  '?X?O.Oooo', // cut: de
  'OX?o.O???', // cut: keima
  'X.?O.?###', // edge: chase
  'OX?X.O###', // edge: block a side cut
  '?X?x.O###', // edge: block a side connection
  '?XOx.x###', // edge: sagari
  '?OXX.O###', // edge: cut
];

const ALLOWED: Readonly<Record<string, readonly number[]>> = {
  X: [1], O: [2], '.': [0], '#': [3], x: [0, 2, 3], o: [0, 1, 3], '?': [0, 1, 2, 3],
};

/** 1 for every code that matches a MoGo shape. */
export const MOGO_PATTERN: Uint8Array = (() => {
  const table = new Uint8Array(CODES);
  for (const shape of MOGO_SHAPES) {
    const around = [...shape.slice(0, 4), ...shape.slice(5)];
    for (const swap of [false, true]) {
      const chars = swap ? around.map((char) => ({ X: 'O', O: 'X', x: 'o', o: 'x' } as Record<string, string>)[char] ?? char) : around;
      for (const symmetry of SYMMETRIES) {
        const options: number[][] = new Array<number[]>(8);
        chars.forEach((char, slot) => {
          options[symmetry[slot]] = [...ALLOWED[char]];
        });
        const fill = (slot: number, code: number): void => {
          if (slot === 8) {
            table[code] = 1;
            return;
          }
          for (const value of options[slot]) fill(slot + 1, code | (value << (2 * slot)));
        };
        fill(0, 0);
      }
    }
  }
  return table;
})();
