import type { GameSeat } from '@shared/types';

/** Where an opponent's seat sits around the board. */
export type BoardSeatPlace = 'top' | 'left' | 'right';

/**
 * Opponents placed by their turn order after the viewer: the seat halfway round sits on top, earlier seats on
 * the left and later seats on the right, so a two-player opponent is always on top. Games whose seats belong
 * to fixed board corners (Chinese checkers) pin plates beside their corners instead (`BoardSeatAnchors`).
 */
export function boardSeatPlaces(seats: readonly GameSeat[], bottomSeat: GameSeat): Partial<Record<GameSeat, BoardSeatPlace>> {
  const start = Math.max(0, seats.indexOf(bottomSeat));
  const places: Partial<Record<GameSeat, BoardSeatPlace>> = {};
  for (let step = 1; step < seats.length; step++) {
    const seat = seats[(start + step) % seats.length];
    const turn = (step * 2) / seats.length;
    places[seat] = Math.abs(turn - 1) < 1e-9 || seats.length === 2 ? 'top' : turn < 1 ? 'left' : 'right';
  }
  return places;
}

/** A plate pinned to a point of the board frame instead of a container round the board. */
export interface BoardSeatAnchor {
  /** The point as fractions of the board frame's width and height; values outside 0–1 lie beside the board. */
  readonly x: number;
  readonly y: number;
  /** Which edge of the plate lies on the point across: `start` extends the plate rightward, `end` leftward. */
  readonly inline: 'start' | 'center' | 'end';
  /** Which edge lies on the point down: `start` hangs the plate below it, `end` stands it on top. */
  readonly block: 'start' | 'center' | 'end';
  /** Further plate rows away from the point (down for `start`, up for `end`), for plates stacked in a column. */
  readonly stack?: number;
}

/**
 * Board-anchored seats, for boards whose corners belong to seats (the Chinese checkers star): one anchor for wide
 * tables, one for short landscape phones, where the board fills the height and plates may sit beside it, and one
 * for narrow portrait screens, where the board fills the width and plates sit above and below it.
 */
export interface BoardSeatAnchors {
  readonly wide: BoardSeatAnchor;
  readonly compact: BoardSeatAnchor;
  readonly narrow: BoardSeatAnchor;
  /** Corner colour drawn as the plate's edge bar, so crowded plates still tell their corner apart. */
  readonly accent?: string;
}

const SHIFT = { start: '0%', center: '-50%', end: '-100%' } as const;
/** Gap between stacked plates. */
const STACK_GAP = 6;

/** CSS custom properties that place an anchored plate; the board table picks the wide or compact set. */
export function boardSeatAnchorStyle(anchors: BoardSeatAnchors): Record<string, string> {
  const set = (prefix: string, anchor: BoardSeatAnchor): Record<string, string> => ({
    [`--${prefix}-x`]: `${Math.round(anchor.x * 10000) / 100}%`,
    [`--${prefix}-y`]: `${Math.round(anchor.y * 10000) / 100}%`,
    [`--${prefix}-shift`]: `translate(${SHIFT[anchor.inline]}, ${anchor.stack
      ? `calc(${SHIFT[anchor.block]} ${anchor.block === 'end' ? '-' : '+'} ${anchor.stack} * (100% + ${STACK_GAP}px))`
      : SHIFT[anchor.block]})`,
  });
  return {
    ...set('wide', anchors.wide), ...set('compact', anchors.compact), ...set('narrow', anchors.narrow),
    // Narrow rows hold two plates, except a centred plate, which has its row to itself.
    ...anchors.narrow.inline === 'center' ? { '--narrow-max': '100%' } : {},
    ...anchors.accent ? { '--seat-accent': anchors.accent } : {},
  };
}
