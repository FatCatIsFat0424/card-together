// ─── Pure view helpers for the Jungle table ───

import type { GameSeat, JungleMove, JungleVisibleState } from '@shared/types';
import { JG_ANIMALS, jgCell, jgNode, jgPieceCount, jgRankOf, jgSideOf, jgTargets } from '@shared/rules/jungle';
import type { JgSide } from '@shared/rules/jungle';
import { jungleBoard } from '@shared/rules/board/boards';
import type { NodeId } from '@shared/rules/board/board-model';
import { coordinateNotation } from '@shared/rules/board/board-move';
import type { MoveNotation } from '@shared/rules/board/board-move';

export interface JunglePiece {
  readonly node: NodeId;
  readonly side: JgSide;
  /** 1 rat to 8 elephant */
  readonly rank: number;
}

export interface JungleTarget {
  readonly node: NodeId;
  readonly capture: boolean;
}

/** Token text per rank (index = rank - 1): the animal's character, or a short English form. */
export const JUNGLE_GLYPHS: Readonly<Record<'en' | 'zh-TW', readonly string[]>> = {
  'zh-TW': ['鼠', '貓', '狗', '狼', '豹', '虎', '獅', '象'],
  en: ['Ra', 'Ca', 'Do', 'Wo', 'Lp', 'Ti', 'Li', 'El'],
};

/** Translation key of an animal's name. */
export const jungleAnimalKey = (rank: number): `jungle.animal.${typeof JG_ANIMALS[number]}` =>
  `jungle.animal.${JG_ANIMALS[rank - 1]}`;

const COORDINATES = coordinateNotation(jungleBoard());

/** Animal and coordinates: `象 g3-g4`, or `El g3xg4` for a capture. */
export const jungleNotation: MoveNotation<JungleMove> = (move, locale) => {
  const glyph = JUNGLE_GLYPHS[locale][move.piece - 1];
  return `${glyph}${locale === 'en' ? ' ' : ''}${COORDINATES(move, locale)}`;
};

/** Side a seat plays: the first seat is side 0, moves first, and plays red. */
export function jungleSide(game: Pick<JungleVisibleState, 'seats'>, seat: GameSeat): JgSide {
  return game.seats.indexOf(seat) === 0 ? 0 : 1;
}

export function junglePieces(cells: JungleVisibleState['cells']): JunglePiece[] {
  const pieces: JunglePiece[] = [];
  cells.forEach((cell, index) => {
    if (cell !== 0) pieces.push({ node: jgNode(index), side: jgSideOf(cell), rank: jgRankOf(cell) });
  });
  return pieces;
}

function ownTurn(game: JungleVisibleState, mySeat: GameSeat | null): mySeat is GameSeat {
  return mySeat !== null && game.phase === 'playing' && game.currentTurnSeat === mySeat;
}

/** Destinations of the piece on `from` for the viewer; empty off turn or for a piece that is not theirs. */
export function jungleTargets(game: JungleVisibleState, mySeat: GameSeat | null, from: NodeId): JungleTarget[] {
  const index = jgCell(from);
  if (!ownTurn(game, mySeat) || index === null || game.cells[index] === 0
    || jgSideOf(game.cells[index]) !== jungleSide(game, mySeat)) return [];
  return jgTargets(game.cells, index).map((to) => ({ node: jgNode(to), capture: game.cells[to] !== 0 }));
}

/** The viewer's pieces that have a legal move now. */
export function jungleMovable(game: JungleVisibleState, mySeat: GameSeat | null): NodeId[] {
  if (!ownTurn(game, mySeat)) return [];
  const side = jungleSide(game, mySeat);
  const movable: NodeId[] = [];
  game.cells.forEach((cell, index) => {
    if (cell !== 0 && jgSideOf(cell) === side && jgTargets(game.cells, index).length > 0) movable.push(jgNode(index));
  });
  return movable;
}

/** Pieces left by seat. */
export function jungleCounts(game: JungleVisibleState): Partial<Record<GameSeat, number>> {
  return { [game.seats[0]]: jgPieceCount(game.cells, 0), [game.seats[1]]: jgPieceCount(game.cells, 1) };
}

/** The latest move, for the last-move marks. */
export function jungleLastMove(game: JungleVisibleState): { readonly from: NodeId; readonly to: NodeId } | null {
  const last = game.log.at(-1);
  return last ? { from: last.from, to: last.to } : null;
}
