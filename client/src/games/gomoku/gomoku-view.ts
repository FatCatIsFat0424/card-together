// ─── Pure view helpers for the Gomoku table ───

import type { GameSeat, GomokuMove, GomokuVisibleState } from '@shared/types';
import {
  GM_CELLS, gmBlackSeat, gmCell, gmForbiddenInPlace, gmNode, gmPlacements, gmSideOfStone, gmStage,
  gmWinningLine,
} from '@shared/rules/gomoku';
import type { GmCell, GmSide, GmStage } from '@shared/rules/gomoku';
import type { NodeId } from '@shared/rules/board/board-model';
import type { MoveNotation } from '@shared/rules/board/board-move';
import { coordinateNotation } from '@shared/rules/board/board-move';
import { gomokuBoard } from '@shared/rules/board/boards';

const NOTATION = coordinateNotation(gomokuBoard());

/** Placement notation (`h8`), or the second seat's colour choice. */
export const gomokuNotation: MoveNotation<GomokuMove> = (move, locale) => {
  if (move.swap === undefined) return NOTATION(move, locale);
  if (locale === 'zh-TW') return move.swap ? '換執黑' : '維持執白';
  return move.swap ? 'Takes black' : 'Keeps white';
};

export interface GomokuStone {
  readonly node: NodeId;
  readonly side: GmSide;
}

export function gomokuStones(stones: GomokuVisibleState['stones']): GomokuStone[] {
  const result: GomokuStone[] = [];
  stones.forEach((cell, index) => {
    if (cell !== null) result.push({ node: gmNode(index), side: cell });
  });
  return result;
}

/** The seat playing black, which the second seat becomes after a swap. */
export function gomokuBlackSeat(game: Pick<GomokuVisibleState, 'seats' | 'log'>): GameSeat {
  return gmBlackSeat(game.seats, game.log);
}

/** Side (colour) a seat plays right now. */
export function gomokuSide(game: Pick<GomokuVisibleState, 'seats' | 'log'>, seat: GameSeat): GmSide {
  return gomokuBlackSeat(game) === seat ? 0 : 1;
}

export function gomokuStageOf(game: Pick<GomokuVisibleState, 'options' | 'log'>): GmStage {
  return gmStage(game.options, game.log);
}

/** Colour of the next stone to go down. */
export function gomokuNextSide(game: Pick<GomokuVisibleState, 'log'>): GmSide {
  return gmSideOfStone(gmPlacements(game.log));
}

function placing(game: GomokuVisibleState, mySeat: GameSeat | null): boolean {
  return mySeat !== null && game.phase === 'playing' && game.currentTurnSeat === mySeat && gomokuStageOf(game) !== 'choosing';
}

export interface GomokuMoves {
  /** Intersections the viewer may play now: none unless it is their turn to place a stone */
  readonly targets: NodeId[];
  /** Points black may not play under Renju, shown to the black player on their turn */
  readonly forbidden: NodeId[];
}

export function gomokuMoves(game: GomokuVisibleState, mySeat: GameSeat | null): GomokuMoves {
  const moves: GomokuMoves = { targets: [], forbidden: [] };
  if (!placing(game, mySeat)) return moves;
  const checked = game.options.renju && gomokuNextSide(game) === 0;
  const work = checked ? [...game.stones] : game.stones;
  for (let index = 0; index < GM_CELLS; index++) {
    if (work[index] !== null) continue;
    if (checked && gmForbiddenInPlace(work as GmCell[], index)) moves.forbidden.push(gmNode(index));
    else moves.targets.push(gmNode(index));
  }
  return moves;
}

/** The latest stone, for the last-move dot. */
export function gomokuLastMove(game: Pick<GomokuVisibleState, 'log'>): { readonly to: NodeId } | null {
  for (let index = game.log.length - 1; index >= 0; index--) {
    const to = game.log[index].to;
    if (to !== undefined) return { to };
  }
  return null;
}

/** The five (or more) stones that won the match, empty otherwise. */
export function gomokuWinningNodes(game: GomokuVisibleState): NodeId[] {
  if (game.result?.reason !== 'five-in-row') return [];
  const last = gomokuLastMove(game);
  const index = last ? gmCell(last.to) : null;
  const side = index === null ? null : game.stones[index];
  return index === null || side === null
    ? [] : gmWinningLine(game.stones, index, side, game.options.renju).map(gmNode);
}

/** Stones placed so far (a colour choice is not a stone). */
export function gomokuStoneCount(game: Pick<GomokuVisibleState, 'log'>): number {
  return gmPlacements(game.log);
}
