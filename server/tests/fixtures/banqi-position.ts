import { BQ_DOWN, BQ_EMPTY, bqFullSet, bqPiece } from '@shared/rules/banqi';
import type { BqBoard, BqPiece, BqRank } from '@shared/rules/banqi';
import type { BanqiGameState } from '@shared/games/banqi/types';

/** Pieces by letter: K A E R H C P are the red general, advisor, elephant, chariot, horse, cannon, soldier; lower case is black. */
const LETTERS = 'KAERHCP';

/** A position from four rows of eight characters: `.` empty, `#` face down, letters as above. */
export function position(rows: readonly string[]): BqBoard {
  return rows.join('').split('').map((char) => {
    if (char === '.') return BQ_EMPTY;
    if (char === '#') return BQ_DOWN;
    return bqPiece(char === char.toUpperCase() ? 0 : 1, LETTERS.indexOf(char.toUpperCase()) as BqRank);
  });
}

/**
 * Writes a position into a running game. Face-down cells get the pieces the rows leave over, in set order, so the
 * two colours stay balanced only when the rows use whole sets; tests that need a coherent log play the game out.
 */
export function setPosition(game: BanqiGameState, rows: readonly string[], colours: [0 | 1, 0 | 1] | null = [0, 1]): void {
  const board = position(rows);
  const remaining: BqPiece[] = bqFullSet();
  for (const slot of board) {
    const index = remaining.indexOf(slot);
    if (slot >= 0 && index >= 0) remaining.splice(index, 1);
  }
  game.board = [...board];
  game.hidden = board.map((slot) => (slot === BQ_DOWN ? remaining.shift() ?? BQ_EMPTY : BQ_EMPTY));
  game.colours = colours;
}
