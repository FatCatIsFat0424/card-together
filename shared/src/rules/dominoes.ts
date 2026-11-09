// ─── Dominoes rules (pure functions, shared by client and server) ───
// Rules: docs/games/dice.md#骨牌接龍

import type { GameSeat } from '../types';
import type {
  DominoEnds, DominoesLogEntry, DominoPip, DominoPlacement, DominoRoundReason, DominoSide, DominoTile,
} from '../games/dominoes/types';

/** Double-six set: every pair of 0–6 once, 28 tiles. */
export const DM_PIPS: readonly DominoPip[] = [0, 1, 2, 3, 4, 5, 6];

/** A match stops after this many rounds even when nobody reached the target; blocked ties score nothing. */
export const DM_MAX_ROUNDS = 30;

export function dmAllTiles(): DominoTile[] {
  return DM_PIPS.flatMap((low) => DM_PIPS.filter((high) => high >= low).map((high): DominoTile => [low, high]));
}

/** Seven tiles heads-up, five with three or four players. */
export function dmHandSize(players: number): number {
  return players === 2 ? 7 : 5;
}

export const dmSameTile = (a: DominoTile, b: DominoTile): boolean => a[0] === b[0] && a[1] === b[1];

export const dmIsDouble = (tile: DominoTile): boolean => tile[0] === tile[1];

export const dmTilePips = (tile: DominoTile): number => tile[0] + tile[1];

export function dmHandPips(hand: readonly DominoTile[]): number {
  return hand.reduce((sum, tile) => sum + dmTilePips(tile), 0);
}

/** Heavier first: pip total, then the higher half. */
export function dmCompareHeavy(a: DominoTile, b: DominoTile): number {
  return dmTilePips(b) - dmTilePips(a) || b[1] - a[1] || b[0] - a[0];
}

/** Hands read largest on the left. */
export function dmSortHand(hand: readonly DominoTile[]): DominoTile[] {
  return [...hand].sort(dmCompareHeavy);
}

/**
 * The tile that opens round 1: the highest double, or when nobody holds a double the heaviest tile.
 * Returns its holder too.
 */
export function dmOpening(
  hands: Readonly<Partial<Record<GameSeat, readonly DominoTile[]>>>, seats: readonly GameSeat[],
): { readonly seat: GameSeat; readonly tile: DominoTile } {
  const held = seats.flatMap((seat) => (hands[seat] ?? []).map((tile) => ({ seat, tile })));
  const doubles = held.filter((entry) => dmIsDouble(entry.tile));
  const pool = doubles.length > 0 ? doubles : held;
  return pool.reduce((best, entry) => (dmCompareHeavy(entry.tile, best.tile) < 0 ? entry : best));
}

export function dmEnds(line: readonly DominoPlacement[]): DominoEnds | null {
  return line.length === 0 ? null : { left: line[0].left, right: line[line.length - 1].right };
}

export const dmHasPip = (tile: DominoTile, pip: DominoPip): boolean => tile[0] === pip || tile[1] === pip;

/** Ends a tile can be added to; empty on an empty line, which takes any tile without a side. */
export function dmFittingSides(tile: DominoTile, line: readonly DominoPlacement[]): DominoSide[] {
  const ends = dmEnds(line);
  if (!ends) return [];
  const sides: DominoSide[] = [];
  if (dmHasPip(tile, ends.left)) sides.push('left');
  if (dmHasPip(tile, ends.right)) sides.push('right');
  return sides;
}

/** Whether the tile can join a non-empty line at all. */
export const dmFits = (tile: DominoTile, line: readonly DominoPlacement[]): boolean => dmFittingSides(tile, line).length > 0;

/** How a tile lies when added: its matching half touches the line. */
export function dmPlacement(tile: DominoTile, side: DominoSide | null, line: readonly DominoPlacement[]): DominoPlacement | null {
  const ends = dmEnds(line);
  if (!ends || side === null) return ends ? null : { tile, left: tile[0], right: tile[1] };
  const open = side === 'left' ? ends.left : ends.right;
  if (!dmHasPip(tile, open)) return null;
  const other = tile[0] === open ? tile[1] : tile[0];
  return side === 'left' ? { tile, left: other, right: open } : { tile, left: open, right: other };
}

/** The end a tile goes to, or why it cannot: both ends are offered unless they carry the same number. */
export function dmResolveSide(
  tile: DominoTile, line: readonly DominoPlacement[], side: DominoSide | undefined,
): { readonly side: DominoSide | null } | { readonly error: string } {
  const ends = dmEnds(line);
  if (!ends) return side === undefined ? { side: null } : { error: 'The first tile has no end to choose.' };
  const fitting = dmFittingSides(tile, line);
  if (fitting.length === 0) return { error: 'That tile does not match an end.' };
  if (side !== undefined) return fitting.includes(side) ? { side } : { error: 'That tile does not match that end.' };
  if (fitting.length === 1) return { side: fitting[0] };
  return ends.left === ends.right ? { side: 'right' } : { error: 'Choose an end for the tile.' };
}

export interface DominoPlay {
  readonly tile: DominoTile;
  readonly side: DominoSide | null;
}

export interface DominoTurnOptions {
  /** Every legal tile and end; a tile that fits both differently-numbered ends appears once per end */
  readonly plays: readonly DominoPlay[];
  /** Nothing can be played and the boneyard has a tile */
  readonly canDraw: boolean;
  /** Nothing can be played and the boneyard is empty */
  readonly canPass: boolean;
}

/** What the seat on turn may do; `opening` is the tile round 1 must open with. */
export function dmTurnOptions(
  hand: readonly DominoTile[], line: readonly DominoPlacement[], boneyardCount: number, opening: DominoTile | null,
): DominoTurnOptions {
  const ends = dmEnds(line);
  const plays: DominoPlay[] = [];
  if (!ends) {
    for (const tile of hand) if (!opening || dmSameTile(tile, opening)) plays.push({ tile, side: null });
  } else {
    for (const tile of hand) {
      const sides = dmFittingSides(tile, line);
      if (sides.length === 2 && ends.left === ends.right) plays.push({ tile, side: 'right' });
      else for (const side of sides) plays.push({ tile, side });
    }
  }
  return { plays, canDraw: plays.length === 0 && boneyardCount > 0, canPass: plays.length === 0 && boneyardCount === 0 };
}

/** Whether any listed hand holds a tile for the line. */
export function dmAnyCanPlay(hands: readonly (readonly DominoTile[])[], line: readonly DominoPlacement[]): boolean {
  return hands.some((hand) => hand.some((tile) => dmFits(tile, line)));
}

/** A round is blocked when the boneyard is empty and nobody can play. */
export function dmBlocked(
  hands: readonly (readonly DominoTile[])[], line: readonly DominoPlacement[], boneyardCount: number,
): boolean {
  return line.length > 0 && boneyardCount === 0 && !dmAnyCanPlay(hands, line);
}

export interface DominoRoundScore {
  readonly reason: DominoRoundReason;
  readonly winner: GameSeat | null;
  readonly points: number;
}

/**
 * Settles a round. A seat that emptied its hand scores every opponent's pips; in a blocked round the lowest
 * pip total scores the other hands' total, and a tie for lowest scores nothing.
 */
export function dmScoreRound(
  hands: Readonly<Record<GameSeat, readonly DominoTile[]>>, seats: readonly GameSeat[], out: GameSeat | null,
): DominoRoundScore {
  const pips = (seat: GameSeat): number => dmHandPips(hands[seat]);
  const total = seats.reduce((sum, seat) => sum + pips(seat), 0);
  if (out !== null) return { reason: 'domino', winner: out, points: total - pips(out) };
  const lowest = Math.min(...seats.map(pips));
  const holders = seats.filter((seat) => pips(seat) === lowest);
  if (holders.length !== 1) return { reason: 'tie', winner: null, points: 0 };
  return { reason: 'blocked', winner: holders[0], points: total - lowest };
}

/** Seats on the highest total. */
export function dmLeaders(seats: readonly GameSeat[], scores: Readonly<Record<GameSeat, number>>): GameSeat[] {
  const best = Math.max(...seats.map((seat) => scores[seat]));
  return seats.filter((seat) => scores[seat] === best);
}

/** The match ends once a total reaches the target, or after the round cap. */
export function dmMatchOver(
  seats: readonly GameSeat[], scores: Readonly<Record<GameSeat, number>>, target: number, round: number,
): boolean {
  return round >= DM_MAX_ROUNDS || seats.some((seat) => scores[seat] >= target);
}

/** Next seat in play order. */
export function dmNextSeat(seats: readonly GameSeat[], seat: GameSeat): GameSeat {
  return seats[(seats.indexOf(seat) + 1) % seats.length];
}

/**
 * Numbers a seat is known to lack, from what it drew or passed on. A draw adds an unseen tile, so it replaces
 * the older record with the ends it failed to match; a pass changes no hand, so it adds to the record.
 */
export function dmKnownVoids(log: readonly DominoesLogEntry[]): Map<GameSeat, Set<DominoPip>> {
  const voids = new Map<GameSeat, Set<DominoPip>>();
  for (const entry of log) {
    if (entry.type === 'round') voids.clear();
    else if (entry.type === 'draw') voids.set(entry.seat, new Set([entry.ends.left, entry.ends.right]));
    else if (entry.type === 'pass') {
      const set = voids.get(entry.seat) ?? new Set<DominoPip>();
      set.add(entry.ends.left);
      set.add(entry.ends.right);
      voids.set(entry.seat, set);
    } else if (entry.type === 'play') {
      // The seat held both halves of the tile it just laid, and may hold more of either.
      voids.get(entry.seat)?.delete(entry.placement.left);
      voids.get(entry.seat)?.delete(entry.placement.right);
    }
  }
  return voids;
}
