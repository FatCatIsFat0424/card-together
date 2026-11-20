// ─── Banqi evaluation: material that adapts to the pieces still alive, plus endgame pressure ───

import { BQ_CANNON } from '@shared/rules/banqi';
import { CAN_CAPTURE, CELLS, COLOUR, DISTANCE, RANK } from './banqi-position';
import type { Position } from './banqi-position';

/** Material by rank (general first) in a typical middlegame; `pieceValues` moves these with the pieces left. */
export const BASE_VALUES: readonly number[] = [100, 60, 40, 30, 20, 35, 12];

/** How much more a piece is worth once the enemy pieces able to capture it are gone. */
const SAFETY_GAIN = 0.4;
/** Enemy pieces (generals, soldiers aside) that can capture a piece of rank 0–4 by stepping onto it, at the start. */
const ATTACKERS_AT_START = [6, 3, 5, 7, 9];
/** Pieces left at or below which hunters and prey are scored by distance. */
const PRESSURE_PIECES = 14;
const HUNT_WEIGHT = 0.07;

const counts = new Int32Array(14);
const values = new Float64Array(14);
const cellsOf = [new Int8Array(16), new Int8Array(16)];

/**
 * Value of each piece type for both colours. A general, advisor, elephant, chariot or horse is worth more as the
 * enemy pieces that can capture it disappear (a general with every enemy soldier gone can only fear a cannon); a
 * soldier is worth most while an enemy general is alive; a cannon needs screens, so it fades with the board.
 */
export function pieceValues(remaining: ArrayLike<number>, total: number, out: Float64Array): void {
  for (let colour = 0; colour < 2; colour++) {
    const enemy = (1 - colour) * 7;
    const own = colour * 7;
    let attackers = remaining[enemy + 6];
    for (let rank = 0; rank <= 4; rank++) {
      attackers += remaining[enemy + rank];
      const fraction = Math.min(1, attackers / ATTACKERS_AT_START[rank]);
      out[own + rank] = BASE_VALUES[rank] * (1 + SAFETY_GAIN * (1 - fraction));
      // Soldiers capture only the general, not the ranks in between: they count against rank 0 alone.
      if (rank === 0) attackers -= remaining[enemy + 6];
    }
    out[own + 5] = 14 + 0.9 * total;
    out[own + 6] = 10 + (remaining[enemy] > 0 ? 3 : 0);
  }
}

/**
 * Score for `mine`, squashed to (-1, 1): the material lead relative to what is left on the board, a small pull
 * toward pieces that can catch enemy pieces which cannot hit back, and a fade toward a draw as the no-capture
 * counter runs out.
 */
export function evaluate(position: Position, mine: number): number {
  const { board, pool } = position;
  counts.set(pool);
  for (let cell = 0; cell < CELLS; cell++) if (board[cell] >= 0) counts[board[cell]]++;
  pieceValues(counts, position.alive[0] + position.alive[1], values);
  let ours = 0;
  let theirs = 0;
  for (let piece = 0; piece < 14; piece++) {
    const worth = counts[piece] * values[piece];
    if (COLOUR[piece] === mine) ours += worth;
    else theirs += worth;
  }
  let lead = ours - theirs;

  if (position.alive[0] + position.alive[1] <= PRESSURE_PIECES) {
    let mineCount = 0;
    let theirCount = 0;
    for (let cell = 0; cell < CELLS; cell++) {
      const piece = board[cell];
      if (piece < 0) continue;
      if (COLOUR[piece] === mine) cellsOf[0][mineCount++] = cell;
      else cellsOf[1][theirCount++] = cell;
    }
    for (let i = 0; i < mineCount; i++) {
      const a = cellsOf[0][i];
      const attacker = board[a];
      for (let j = 0; j < theirCount; j++) {
        const b = cellsOf[1][j];
        const prey = board[b];
        const distance = DISTANCE[a * CELLS + b];
        const hunts = RANK[attacker] === BQ_CANNON ? 0.5 : CAN_CAPTURE[attacker * 14 + prey];
        const hunted = RANK[prey] === BQ_CANNON ? 0.5 : CAN_CAPTURE[prey * 14 + attacker];
        if (hunts > hunted) lead += HUNT_WEIGHT * (hunts - hunted) * values[prey] / distance;
        else if (hunted > hunts) lead -= HUNT_WEIGHT * (hunted - hunts) * values[attacker] / distance;
      }
    }
  }

  const scale = 45 + 0.16 * (ours + theirs);
  const fade = position.quiet > 12 ? 1 - 0.7 * Math.min(1, (position.quiet - 12) / 38) : 1;
  return Math.tanh(lead / scale) * fade;
}
