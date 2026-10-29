// ─── Pure view helpers for the Reversi table ───

import type { GameSeat, ReversiVisibleState } from '@shared/types';
import { rvCounts, rvLegalMoves, rvNode } from '@shared/rules/reversi';
import type { RvSide } from '@shared/rules/reversi';
import type { NodeId } from '@shared/rules/board/board-model';

export interface ReversiPiece {
  readonly node: NodeId;
  readonly side: RvSide;
}

/** Side (colour) a seat plays: the first seat plays dark. */
export function reversiSide(game: Pick<ReversiVisibleState, 'seats'>, seat: GameSeat): RvSide {
  return game.seats.indexOf(seat) === 0 ? 0 : 1;
}

export function reversiPieces(discs: ReversiVisibleState['discs']): ReversiPiece[] {
  const pieces: ReversiPiece[] = [];
  discs.forEach((cell, index) => {
    if (cell !== null) pieces.push({ node: rvNode(index), side: cell });
  });
  return pieces;
}

/** Cells the viewer may play now: none unless it is their turn in a running match. */
export function reversiTargets(game: ReversiVisibleState, mySeat: GameSeat | null): NodeId[] {
  if (mySeat === null || game.phase !== 'playing' || game.currentTurnSeat !== mySeat) return [];
  return rvLegalMoves(game.discs, reversiSide(game, mySeat)).map(rvNode);
}

/** Disc totals by seat. */
export function reversiDiscCounts(game: ReversiVisibleState): Partial<Record<GameSeat, number>> {
  const [dark, light] = rvCounts(game.discs);
  return { [game.seats[0]]: dark, [game.seats[1]]: light };
}

/** The latest placement, for the last-move dot. */
export function reversiLastMove(game: ReversiVisibleState): { readonly to: NodeId } | null {
  for (let index = game.log.length - 1; index >= 0; index--) {
    const to = game.log[index].to;
    if (to !== undefined) return { to };
  }
  return null;
}

/** The seat whose turn was just skipped, while the next move has not been played. */
export function reversiPassedSeat(game: ReversiVisibleState): GameSeat | null {
  const last = game.log.at(-1);
  return game.phase === 'playing' && last && last.to === undefined ? last.seat : null;
}

/** Placements made so far (passes are not moves). */
export function reversiPlacements(game: ReversiVisibleState): number {
  return game.log.filter((entry) => entry.to !== undefined).length;
}
