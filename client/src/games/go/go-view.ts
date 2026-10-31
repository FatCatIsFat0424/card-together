// ─── Pure view helpers for the Go table ───

import type { GameSeat, GoMoveRecord, GoVisibleState } from '@shared/types';
import {
  GO_COLUMNS, GO_HANDICAP_KOMI, GO_KOMI, goLegalPoints, goNode, goPointName, goPointOfNode, goScore,
} from '@shared/rules/go';
import type { GoScore, GoSide, GoSize } from '@shared/rules/go';
import { goMovesOfLog, goReplayLog } from '@shared/rules/go-match';
import type { NodeId } from '@shared/rules/board/board-model';
import type { MoveNotation } from '@shared/rules/board/board-move';

/** `D4`-style notation; a capture adds the count (`D4×2`). A pass is worded as Go players do. */
export function goNotation(size: GoSize): MoveNotation<GoMoveRecord> {
  return (move, locale) => {
    const point = move.to === undefined ? null : goPointOfNode(size, move.to);
    if (point === null) return locale === 'zh-TW' ? '停一手' : 'Pass';
    return `${goPointName(size, point)}${move.captured ? `×${move.captured}` : ''}`;
  };
}

/** Column letters along the bottom and row numbers (from the top) along the left. */
export const goFileLabels = (size: GoSize): string[] => GO_COLUMNS.slice(0, size).split('');
export const goRankLabels = (size: GoSize): string[] => Array.from({ length: size }, (_, index) => String(size - index));

export interface GoStone {
  readonly node: NodeId;
  readonly side: GoSide;
  readonly index: number;
}

export function goStones(game: Pick<GoVisibleState, 'stones' | 'options'>): GoStone[] {
  const stones: GoStone[] = [];
  game.stones.forEach((cell, index) => {
    if (cell !== null) stones.push({ node: goNode(game.options.size, index), side: cell, index });
  });
  return stones;
}

/** Side a seat plays: the first seat holds black. */
export function goSideOf(game: Pick<GoVisibleState, 'seats'>, seat: GameSeat): GoSide {
  return game.seats.indexOf(seat) === 0 ? 0 : 1;
}

/** Intersections the viewer may play now: none unless it is their turn to play. Superko and suicide are left out. */
export function goTargets(game: GoVisibleState, mySeat: GameSeat | null): NodeId[] {
  if (mySeat === null || game.phase !== 'playing' || game.currentTurnSeat !== mySeat) return [];
  const moves = goMovesOfLog(game.options.size, game.log);
  const replay = moves && goReplayLog(game.options, moves, game.resumes);
  return replay ? goLegalPoints(replay.position, replay.history).map((point) => goNode(game.options.size, point)) : [];
}

/** The latest stone, for the last-move dot. */
export function goLastMove(game: Pick<GoVisibleState, 'log'>): { readonly to: NodeId } | null {
  const last = game.log.at(-1);
  return last?.to === undefined ? null : { to: last.to };
}

/** Dead stones to show: the marking while it runs, the settled count afterwards, none while playing. */
export function goDeadStones(game: GoVisibleState): readonly number[] {
  return game.phase === 'marking' ? game.dead : game.result?.dead ?? [];
}

/** The count behind the marking or the finished result; null while play goes on or after a resignation. */
export function goCount(game: GoVisibleState): GoScore | null {
  const showing = game.phase === 'marking' || (game.result !== null && game.result.reason !== 'resign');
  if (!showing) return null;
  const komi = game.result?.komi ?? (game.options.handicap > 0 ? GO_HANDICAP_KOMI : GO_KOMI);
  return goScore(game.options.size, game.stones, goDeadStones(game), komi);
}
