// ─── Pure view helpers for the Chinese checkers table ───

import type { ChineseCheckersMove, ChineseCheckersVisibleState, GameSeat } from '@shared/types';
import {
  CC_BOARD, CC_PIECES, ccArrived, ccDestinations, ccFindMove, ccFinished, ccIndex, ccNode,
} from '@shared/rules/chinesecheckers';
import { STAR_CORNERS } from '@shared/rules/board/boards';
import type { NodeId } from '@shared/rules/board/board-model';
import { sideRotation } from '@shared/rules/board/board-model';
import type { BoardSeatAnchor, BoardSeatAnchors } from '../board/board-table';
import { DEFAULT_BOARD_THEME } from '../board/board-theme';
import { boardGeometry } from '../board/board-view';

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

interface SlotAnchor extends Omit<BoardSeatAnchor, 'x' | 'y'> {
  /** Board units of the turned star: holes span x 0–12 and y 0–8√3, and the frame adds the rim round them. */
  readonly x: number;
  readonly y: number;
}

const frame = boardGeometry(CC_BOARD, 0).viewBox;
const LEFT = frame[0];
const TOP = frame[1];
const RIGHT = frame[0] + frame[2];
const BOTTOM = frame[1] + frame[3];
/** Heights of the middle of the upper and lower side triangles. */
const UPPER_ARM = 5.5 * (Math.sqrt(3) / 2);
const LOWER_ARM = 10.5 * (Math.sqrt(3) / 2);

/**
 * Plate anchors for each corner counted clockwise from the viewer's at the bottom. Wide tables keep every plate
 * in the empty notches between the points: beside the bottom point, under or over the side triangles at the
 * frame edge, and right of the top point. Short phones put side plates beside their triangle, outside the board.
 */
const WIDE_SLOTS: readonly SlotAnchor[] = [
  { x: 4.4, y: BOTTOM, inline: 'end', block: 'end' },
  { x: LEFT, y: 11.65, inline: 'start', block: 'start' },
  { x: LEFT, y: 2.2, inline: 'start', block: 'end' },
  { x: 7.45, y: TOP, inline: 'start', block: 'start' },
  { x: RIGHT, y: 2.2, inline: 'end', block: 'end' },
  { x: RIGHT, y: 11.65, inline: 'end', block: 'start' },
];
const COMPACT_SLOTS: readonly SlotAnchor[] = [
  { x: 4.2, y: BOTTOM, inline: 'end', block: 'end' },
  { x: LEFT - 0.2, y: LOWER_ARM, inline: 'end', block: 'center' },
  { x: LEFT - 0.2, y: UPPER_ARM, inline: 'end', block: 'center' },
  { x: 7.4, y: TOP, inline: 'start', block: 'start' },
  { x: RIGHT + 0.2, y: UPPER_ARM, inline: 'start', block: 'center' },
  { x: RIGHT + 0.2, y: LOWER_ARM, inline: 'start', block: 'center' },
];

/** Portrait screens: the upper corners' plates over the board and the lower ones under it, two to a row. */
const NARROW_SLOTS: readonly SlotAnchor[] = [
  { x: 6, y: BOTTOM, inline: 'center', block: 'start', stack: 1 },
  { x: LEFT, y: BOTTOM, inline: 'start', block: 'start' },
  { x: LEFT, y: TOP, inline: 'start', block: 'end' },
  { x: 6, y: TOP, inline: 'center', block: 'end', stack: 1 },
  { x: RIGHT, y: TOP, inline: 'end', block: 'end' },
  { x: RIGHT, y: BOTTOM, inline: 'end', block: 'start' },
];

const toFrame = ({ x, y, ...edges }: SlotAnchor): BoardSeatAnchor => ({
  x: (x - frame[0]) / frame[2], y: (y - frame[1]) / frame[3], ...edges,
});

/** Corner position of a seat as drawn: 0 is the viewer's corner at the bottom, then clockwise. */
export function chineseCheckersSlot(
  game: Pick<ChineseCheckersVisibleState, 'seats' | 'corners'>, bottomSeat: GameSeat, seat: GameSeat,
): number | null {
  const own = seatCorner(game, bottomSeat) ?? game.corners[0] ?? 0;
  const corner = seatCorner(game, seat);
  return corner === null ? null : (corner - own + STAR_CORNERS.length) % STAR_CORNERS.length;
}

/** Every seat's plate pinned beside its home corner of the turned star, with the corner colour as its edge bar. */
export function chineseCheckersAnchors(
  game: Pick<ChineseCheckersVisibleState, 'seats' | 'corners'>, bottomSeat: GameSeat,
): Partial<Record<GameSeat, BoardSeatAnchors>> {
  const anchors: Partial<Record<GameSeat, BoardSeatAnchors>> = {};
  for (const seat of game.seats) {
    const slot = chineseCheckersSlot(game, bottomSeat, seat);
    const corner = seatCorner(game, seat);
    if (slot === null || corner === null) continue;
    anchors[seat] = {
      wide: toFrame(WIDE_SLOTS[slot]), compact: toFrame(COMPACT_SLOTS[slot]), narrow: toFrame(NARROW_SLOTS[slot]),
      accent: DEFAULT_BOARD_THEME.pieces.marbles[corner],
    };
  }
  return anchors;
}

/**
 * The seats in reading order round the star: the viewer first, then the opposite corner, then each side from
 * its upper corner down.
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

/** Marbles each seat has in its target triangle, out of ten; a finished target counts opposing marbles as arrived. */
export function chineseCheckersArrived(game: ChineseCheckersVisibleState, seat: GameSeat): number {
  const corner = seatCorner(game, seat);
  if (corner === null || game.resigned.includes(seat)) return 0;
  return ccFinished(game.holes, corner) ? CC_PIECES : ccArrived(game.holes, corner);
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
