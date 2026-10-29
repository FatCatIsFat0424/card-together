// ─── Pure view helpers for the Land Battle Chess table ───

import type { GameSeat, LandBattleMove, LandBattleVisibleState } from '@shared/types';
import { coordinateLabel } from '@shared/rules/board/board-model';
import type { BoardModel, NodeId } from '@shared/rules/board/board-model';
import type { MoveNotation } from '@shared/rules/board/board-move';
import {
  LB_NODES, lbCell, lbDestinations, lbLegalMoves, lbNode, lbSlotIndex, lbSlotOf, lbSlotProblem,
} from '@shared/rules/landbattle';
import type { LbCell, LbRank, LbSide } from '@shared/rules/landbattle';

/** Side a seat plays: the first seat deploys at the bottom and moves first. */
export function landBattleSide(game: Pick<LandBattleVisibleState, 'seats'>, seat: GameSeat): LbSide {
  return game.seats.indexOf(seat) === 1 ? 1 : 0;
}

/** The pieces as the rules see them from the viewer's side: own identities known, others blank. */
export function landBattleBoard(game: LandBattleVisibleState): (LbCell | null)[] {
  const board: (LbCell | null)[] = new Array<LbCell | null>(LB_NODES).fill(null);
  for (const piece of game.pieces) {
    const at = lbCell(piece.node);
    if (at !== null) board[at] = piece.rank ? { side: piece.side, rank: piece.rank } : { side: piece.side };
  }
  return board;
}

/** Own pieces with a legal move; none unless it is the viewer's turn in a running match. */
export function landBattleMovable(game: LandBattleVisibleState, mySeat: GameSeat | null): NodeId[] {
  if (mySeat === null || game.phase !== 'playing' || game.currentTurnSeat !== mySeat) return [];
  const side = landBattleSide(game, mySeat);
  return [...new Set(lbLegalMoves(landBattleBoard(game), side).map((move) => lbNode(move.from)))];
}

/** Legal destinations of the piece on `from`, each marked when it attacks. */
export function landBattleTargets(game: LandBattleVisibleState, from: NodeId): { node: NodeId; capture: boolean }[] {
  const board = landBattleBoard(game);
  const index = lbCell(from);
  if (index === null) return [];
  return lbDestinations(board, index).map((move) => ({ node: lbNode(move.to), capture: board[move.to] !== null }));
}

/** The railway stations a move passes through, for the pending path. */
export function landBattlePath(game: LandBattleVisibleState, from: NodeId, to: NodeId): NodeId[] {
  const index = lbCell(from);
  const target = lbCell(to);
  if (index === null || target === null) return [];
  return (lbDestinations(landBattleBoard(game), index).find((move) => move.to === target)?.path ?? []).map(lbNode);
}

export function landBattleLastMove(game: LandBattleVisibleState): LandBattleMove | null {
  return game.log.at(-1) ?? null;
}

export function landBattleRemaining(game: LandBattleVisibleState, seat: GameSeat): number {
  const side = landBattleSide(game, seat);
  return game.pieces.filter((piece) => piece.side === side).length;
}

/** Station and identity of each piece of a draft deployment. */
export function draftPieces(layout: readonly LbRank[], side: LbSide): { node: NodeId; slot: number; rank: LbRank }[] {
  return layout.map((rank, slot) => ({ node: lbNode(lbSlotIndex(side, slot)), slot, rank }));
}

/** Slot of a station in the viewer's own deployment, or -1. */
export function draftSlot(node: NodeId, side: LbSide): number {
  const index = lbCell(node);
  return index === null ? -1 : lbSlotOf(side, index);
}

/** Why exchanging two slots breaks a placement rule, or null when it may be done. */
export function swapProblem(layout: readonly LbRank[], a: number, b: number): 'flag' | 'mine' | 'bomb' | null {
  return lbSlotProblem(layout[a], b) ?? lbSlotProblem(layout[b], a);
}

/** Coordinates with the battle outcome: `c4xc5+` won, `c4xc5-` lost, `c4xc5=` both removed; 勝／負／同 in Chinese. */
export function landBattleNotation(board: BoardModel): MoveNotation<LandBattleMove> {
  return (move, locale) => {
    const route = [...move.path ?? [], move.to].map((id) => coordinateLabel(board, id));
    const base = `${coordinateLabel(board, move.from)}${move.capture ? 'x' : '-'}${route.at(-1)}`;
    if (!move.battle) return base;
    const marks = locale === 'zh-TW' ? { win: ' 勝', lose: ' 負', tie: ' 同' } : { win: '+', lose: '−', tie: '=' };
    return `${base}${marks[move.battle]}`;
  };
}
