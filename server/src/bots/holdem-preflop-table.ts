import type { Card } from '@shared/types';

// Heads-up equity against one random hand for each of the 169 starting-hand classes, in thousandths, from a
// 60,000-run simulation per class. Row and column are rank - 2. Pairs sit on the diagonal, suited hands below it
// (row = high card), offsuit hands above it (row = low card).
const EQUITY_VS_RANDOM: readonly (readonly number[])[] = [
  [503, 322, 331, 344, 343, 344, 368, 389, 415, 444, 472, 505, 550],
  [358, 537, 349, 362, 360, 368, 375, 405, 427, 452, 484, 513, 562],
  [369, 386, 570, 381, 384, 385, 395, 405, 436, 461, 490, 522, 567],
  [381, 397, 415, 604, 400, 406, 413, 428, 443, 472, 500, 536, 577],
  [377, 398, 412, 438, 633, 425, 432, 444, 461, 477, 512, 541, 579],
  [383, 401, 418, 438, 452, 665, 448, 462, 476, 496, 513, 549, 588],
  [405, 407, 427, 444, 464, 483, 693, 479, 496, 518, 534, 558, 602],
  [424, 431, 438, 456, 470, 491, 511, 720, 514, 529, 554, 577, 609],
  [447, 459, 462, 469, 491, 508, 524, 542, 751, 551, 571, 596, 626],
  [476, 483, 492, 501, 504, 520, 540, 556, 575, 775, 580, 606, 633],
  [500, 511, 515, 528, 538, 541, 560, 577, 591, 603, 800, 616, 647],
  [528, 542, 550, 557, 569, 576, 580, 602, 619, 627, 633, 826, 654],
  [576, 579, 590, 599, 600, 605, 620, 623, 646, 653, 660, 669, 852],
];

function classCell(a: number, b: number, suited: boolean): readonly [number, number] {
  const high = Math.max(a, b) - 2;
  const low = Math.min(a, b) - 2;
  return high === low || suited ? [high, low] : [low, high];
}

function cellOf(hole: readonly Card[]): readonly [number, number] {
  return classCell(hole[0].rank, hole[1].rank, hole[0].suit === hole[1].suit);
}

function combosOf(row: number, column: number): number {
  if (row === column) return 6;
  return row > column ? 4 : 12;
}

/** Rank fraction per class: 0 is the best hand and values approach 1 for the worst, by combos. */
const RANK_FRACTION: readonly (readonly number[])[] = (() => {
  const classes: { row: number; column: number; equity: number; combos: number }[] = [];
  for (let row = 0; row < 13; row++) {
    for (let column = 0; column < 13; column++) {
      classes.push({ row, column, equity: EQUITY_VS_RANDOM[row][column], combos: combosOf(row, column) });
    }
  }
  classes.sort((a, b) => b.equity - a.equity);
  const table = Array.from({ length: 13 }, () => new Array<number>(13).fill(0));
  let better = 0;
  for (const entry of classes) {
    table[entry.row][entry.column] = (better + entry.combos / 2) / 1326;
    better += entry.combos;
  }
  return table;
})();

/** Fraction of all starting hands that rank above this one; a range of the top `f` holds hands up to `f`. */
export function preflopRankFraction(hole: readonly Card[]): number {
  const [row, column] = cellOf(hole);
  return RANK_FRACTION[row][column];
}

/** Same as {@link preflopRankFraction} for two card ranks and suitedness. */
export function preflopRankFractionOf(rankA: number, rankB: number, suited: boolean): number {
  const [row, column] = classCell(rankA, rankB, suited);
  return RANK_FRACTION[row][column];
}
