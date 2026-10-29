// ─── Pure view helpers for the Chinese checkers table ───

import type { ChineseCheckersMove, ChineseCheckersVisibleState, GameSeat } from '@shared/types';
import {
  CC_BOARD, ccArrived, ccDestinations, ccFindMove, ccIndex, ccNode,
} from '@shared/rules/chinesecheckers';
import { STAR_CORNERS } from '@shared/rules/board/boards';
import type { NodeId } from '@shared/rules/board/board-model';
import { sideRotation } from '@shared/rules/board/board-model';
import type { BoardSeatPlace } from '../board/board-table';

export interface ChineseCheckersPiece {
  readonly node: NodeId;
  /** Home corner of the marble's owner, which also picks its colour */
  readonly corner: number;
}

/** Home corner of a seat, or null for a seat outside the match. */
export function seatCorner(game: Pick<ChineseCheckersVisibleState, 'seats' | 'corners'>, seat: GameSeat): number | null {
  const index = game.seats.indexOf(seat);
  return index < 0 ? null : game.corners[index];
}

/** Turn that puts the seat's home corner at the bottom; the first seat's view for anyone else. */
export function chineseCheckersRotation(game: Pick<ChineseCheckersVisibleState, 'seats' | 'corners'>, seat: GameSeat): number {
  return sideRotation(CC_BOARD, seatCorner(game, seat) ?? game.corners[0] ?? 0);
}

export function chineseCheckersPieces(holes: ChineseCheckersVisibleState['holes']): ChineseCheckersPiece[] {
  const pieces: ChineseCheckersPiece[] = [];
  holes.forEach((hole, index) => {
    if (hole !== null) pieces.push({ node: ccNode(index), corner: hole });
  });
  return pieces;
}

/** Whether the viewer moves now: their turn in a running match they have not left. */
function myCorner(game: ChineseCheckersVisibleState, mySeat: GameSeat | null): number | null {
  if (mySeat === null || game.phase !== 'playing' || game.currentTurnSeat !== mySeat || game.resigned.includes(mySeat)) return null;
  return seatCorner(game, mySeat);
}

/** Own marbles that can move now: none unless it is the viewer's turn. */
export function chineseCheckersMovable(game: ChineseCheckersVisibleState, mySeat: GameSeat | null): NodeId[] {
  const corner = myCorner(game, mySeat);
  if (corner === null) return [];
  const movable: NodeId[] = [];
  game.holes.forEach((hole, index) => {
    if (hole === corner && ccDestinations(game.holes, index).length > 0) movable.push(ccNode(index));
  });
  return movable;
}

/** Every hole the selected marble can reach this turn, steps and jump-chain ends alike. */
export function chineseCheckersTargets(game: ChineseCheckersVisibleState, mySeat: GameSeat | null, from: NodeId | null): NodeId[] {
  const corner = myCorner(game, mySeat);
  const index = from === null ? null : ccIndex(from);
  if (corner === null || index === null || game.holes[index] !== corner) return [];
  return ccDestinations(game.holes, index).map((destination) => ccNode(destination.to));
}

/** Landings between `from` and `to` of the chain the server will play, for the pending-move preview. */
export function chineseCheckersPath(game: ChineseCheckersVisibleState, from: NodeId, to: NodeId): NodeId[] {
  const start = ccIndex(from);
  const end = ccIndex(to);
  const corner = start === null ? null : game.holes[start];
  const found = start === null || end === null || corner === null || corner === undefined ? null : ccFindMove(game.holes, corner, start, end);
  return found ? found.path.map(ccNode) : [];
}

/**
 * Opponents placed by where their corner lies from the viewer's: the opposite corner on top, corners to its
 * left and right beside the board.
 */
export function chineseCheckersPlaces(
  game: Pick<ChineseCheckersVisibleState, 'seats' | 'corners'>, bottomSeat: GameSeat,
): Partial<Record<GameSeat, BoardSeatPlace>> {
  const own = seatCorner(game, bottomSeat) ?? game.corners[0] ?? 0;
  const places: Partial<Record<GameSeat, BoardSeatPlace>> = {};
  game.seats.forEach((seat, index) => {
    if (seat === bottomSeat) return;
    const turn = (game.corners[index] - own + STAR_CORNERS.length) % STAR_CORNERS.length;
    places[seat] = turn === STAR_CORNERS.length / 2 ? 'top' : turn < STAR_CORNERS.length / 2 ? 'left' : 'right';
  });
  return places;
}

/**
 * The seats in the order the table stacks them: the opposite corner first, then each side column from its
 * upper corner down, so a seat's plate sits at the height of its corner. The viewer's seat keeps its place.
 */
export function chineseCheckersSeatOrder(
  game: Pick<ChineseCheckersVisibleState, 'seats' | 'corners'>, bottomSeat: GameSeat,
): GameSeat[] {
  const own = seatCorner(game, bottomSeat) ?? game.corners[0] ?? 0;
  const count = STAR_CORNERS.length;
  // Turns from the viewer: 3 is opposite, 2 and 1 run down the left, 4 and 5 down the right.
  const height = (seat: GameSeat): number => {
    const turn = ((seatCorner(game, seat) ?? own) - own + count) % count;
    return turn === 0 ? -1 : turn <= count / 2 ? count / 2 - turn : turn;
  };
  return [...game.seats].sort((a, b) => height(a) - height(b));
}

/** Marbles each seat has in its target triangle, out of ten. */
export function chineseCheckersArrived(game: ChineseCheckersVisibleState, seat: GameSeat): number {
  const corner = seatCorner(game, seat);
  return corner === null || game.resigned.includes(seat) ? 0 : ccArrived(game.holes, corner);
}

/** The latest move, for the last-move markers and its jump path. */
export function chineseCheckersLastMove(game: ChineseCheckersVisibleState): ChineseCheckersMove | null {
  for (let index = game.log.length - 1; index >= 0; index--) {
    if (game.log[index].to !== undefined) return game.log[index];
  }
  return null;
}

/** The seat whose turn was just skipped because every marble was blocked, until the next move. */
export function chineseCheckersPassedSeat(game: ChineseCheckersVisibleState): GameSeat | null {
  const last = game.log.at(-1);
  return game.phase === 'playing' && last && last.to === undefined && !last.resigned ? last.seat : null;
}

/** Moves made so far; passes and resignations are not moves. */
export function chineseCheckersMoveCount(game: ChineseCheckersVisibleState): number {
  return game.log.filter((entry) => entry.to !== undefined).length;
}
