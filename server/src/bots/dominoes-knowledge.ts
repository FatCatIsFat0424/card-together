import type { GameSeat } from '@shared/types';
import type { DominoesVisibleState, DominoTile } from '@shared/games/dominoes/types';
import { dmAllTiles, dmCompareHeavy, dmIsDouble, DM_PIPS } from '@shared/rules/dominoes';
import { dealUnseen } from './search/card-dealer';
import type { DealSeat } from './search/card-dealer';

// What one seat can know about the other hands in the round in play. Tiles are numbered 0–27 in
// `dmAllTiles` order and a hand is a 28-bit mask. Every other hand is a list of unknown tiles, each with the
// mask of tiles it may still be: a draw or a pass rules out both open numbers for every tile in that hand at
// that moment, while a tile drawn afterwards starts unconstrained. In round 1 the opening tile also rules
// out, for every dealt tile, each double above it (and, when it is not a double, every double and heavier
// tile), since its holder had to open with the best one. Sampling deals the unseen tiles under these limits.

export const DM_TILES: readonly DominoTile[] = dmAllTiles();
export const DM_TILE_COUNT = DM_TILES.length;
export const DM_ALL = (1 << DM_TILE_COUNT) - 1;
export const TILE_LOW = Int8Array.from(DM_TILES, (tile) => tile[0]);
export const TILE_HIGH = Int8Array.from(DM_TILES, (tile) => tile[1]);
export const TILE_PIPS = Int8Array.from(DM_TILES, (tile) => tile[0] + tile[1]);
/** Tiles holding each number */
export const PIP_MASK = Int32Array.from(DM_PIPS, (pip) => DM_TILES.reduce((mask, tile, id) => (
  tile[0] === pip || tile[1] === pip ? mask | (1 << id) : mask), 0));

export const tileId = (tile: DominoTile): number => DM_TILES.findIndex((own) => own[0] === tile[0] && own[1] === tile[1]);

export function maskOf(tiles: readonly DominoTile[]): number {
  return tiles.reduce((mask, tile) => mask | (1 << tileId(tile)), 0);
}

export function bitCount(mask: number): number {
  let value = mask - ((mask >>> 1) & 0x55555555);
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function maskPips(mask: number): number {
  let total = 0;
  for (let rest = mask; rest !== 0; rest &= rest - 1) total += TILE_PIPS[31 - Math.clz32(rest & -rest)];
  return total;
}

export interface DominoesKnowledge {
  /** Seats in play order; `mine` is the deciding seat's index */
  readonly seats: readonly GameSeat[];
  readonly mine: number;
  readonly own: number;
  /** Tiles neither in this hand nor on the line */
  readonly unseen: number;
  /** Possible-tile masks of each other seat's unknown tiles; empty for the deciding seat */
  readonly hands: readonly (readonly number[])[];
  readonly boneyard: number;
  /** False when the log could not be followed and only hand sizes were used */
  readonly exact: boolean;
}

/**
 * Removes one unknown tile that may be `id`; false when none may. Which one it was is not known, so the
 * most constrained candidate is removed and every other candidate widens to also allow what the removed one
 * allowed (its tile may now sit in that place). Nested possibilities, the usual case, lose nothing.
 */
function takeUnknown(slots: number[], id: number): boolean {
  let chosen = -1;
  for (let index = 0; index < slots.length; index++) {
    if ((slots[index] & (1 << id)) !== 0 && (chosen < 0 || bitCount(slots[index]) < bitCount(slots[chosen]))) chosen = index;
  }
  if (chosen < 0) return false;
  const [removed] = slots.splice(chosen, 1);
  for (let index = 0; index < slots.length; index++) if ((slots[index] & (1 << id)) !== 0) slots[index] |= removed;
  return true;
}

/** Tiles round 1's opening tile shows nobody was dealt. */
function aboveOpening(opening: DominoTile): number {
  return DM_TILES.reduce((mask, tile, id) => {
    const above = dmIsDouble(opening)
      ? dmIsDouble(tile) && tile[0] > opening[0]
      : dmIsDouble(tile) || dmCompareHeavy(tile, opening) < 0;
    return above ? mask | (1 << id) : mask;
  }, 0);
}

function followLog(visible: DominoesVisibleState, seats: readonly GameSeat[], mine: number): number[][] | null {
  let start = -1;
  visible.log.forEach((entry, index) => {
    if (entry.type === 'round') start = index;
  });
  if (start < 0) return null;
  const log = visible.log.slice(start);
  const hands = seats.map((): number[] => []);
  const at = (seat: GameSeat): number[] | null => {
    const index = seats.indexOf(seat);
    return index < 0 || index === mine ? null : hands[index];
  };
  for (const entry of log) {
    switch (entry.type) {
      case 'round': {
        const opening = entry.round === 1 ? log.find((later) => later.type === 'play') : undefined;
        const dealt = DM_ALL & ~(opening?.type === 'play' ? aboveOpening(opening.tile) : 0);
        seats.forEach((seat, index) => {
          if (index !== mine) hands[index].push(...new Array<number>(entry.counts[seat] ?? 0).fill(dealt));
        });
        break;
      }
      case 'play': {
        const hand = at(entry.seat);
        if (hand && !takeUnknown(hand, tileId(entry.tile))) return null;
        break;
      }
      case 'draw':
      case 'pass': {
        const hand = at(entry.seat);
        if (!hand) break;
        const unplayable = ~(PIP_MASK[entry.ends.left] | PIP_MASK[entry.ends.right]);
        for (let index = 0; index < hand.length; index++) hand[index] &= unplayable;
        if (entry.type === 'draw') hand.push(DM_ALL);
        break;
      }
      case 'roundEnd':
        break;
    }
  }
  return hands;
}

/** Reads the seat's view into hand knowledge. Reads `visible` only. */
export function dominoesKnowledge(visible: DominoesVisibleState): DominoesKnowledge {
  const seats = [...visible.seats];
  const mine = seats.indexOf(visible.mySeat);
  const own = maskOf(visible.myHand);
  const unseen = DM_ALL & ~own & ~maskOf(visible.line.map((placed) => placed.tile));
  const fits = (hands: readonly (readonly number[])[]): boolean => seats.every((seat, index) => index === mine
    || hands[index].length === visible.handCounts[seat])
    && hands.reduce((sum, hand) => sum + hand.length, 0) + visible.boneyardCount === bitCount(unseen);
  const followed = followLog(visible, seats, mine);
  if (followed && fits(followed)) {
    return { seats, mine, own, unseen, hands: followed.map((hand) => hand.map((mask) => mask & unseen)), boneyard: visible.boneyardCount, exact: true };
  }
  const loose = seats.map((seat, index) => (index === mine ? [] : new Array<number>(visible.handCounts[seat]).fill(unseen)));
  return { seats, mine, own, unseen, hands: loose, boneyard: visible.boneyardCount, exact: false };
}

/** One full layout consistent with the knowledge. */
export interface DominoesWorld {
  /** Hand masks in seat order, the deciding seat's own included */
  readonly hands: Int32Array;
  /** Tile ids in drawing order */
  readonly boneyard: Int8Array;
}

/**
 * Deals the unseen tiles to the unknown tiles and the boneyard at random, honoring every limit. Null when no
 * consistent deal was found (or the sizes do not add up).
 */
export function sampleDominoesWorld(knowledge: DominoesKnowledge, random: () => number): DominoesWorld | null {
  const unseen: number[] = [];
  for (let id = 0; id < DM_TILE_COUNT; id++) if ((knowledge.unseen & (1 << id)) !== 0) unseen.push(id);
  const groups: { seat: number; mask: number; size: number }[] = [];
  knowledge.hands.forEach((slots, seat) => {
    for (const mask of slots) {
      const group = groups.find((entry) => entry.seat === seat && entry.mask === mask);
      if (group) group.size++;
      else groups.push({ seat, mask, size: 1 });
    }
  });
  const dealSeats: DealSeat<number>[] = groups.map(({ mask, size }) => ({ size, accepts: (id: number) => (mask & (1 << id)) !== 0 }));
  dealSeats.push({ size: knowledge.boneyard });
  if (dealSeats.reduce((sum, seat) => sum + seat.size, 0) !== unseen.length) return null;
  const deal = dealUnseen({ unseen, seats: dealSeats, attempts: 1 }, random);
  if (!deal) return null;
  const hands = new Int32Array(knowledge.seats.length);
  hands[knowledge.mine] = knowledge.own;
  groups.forEach((group, index) => {
    for (const id of deal.hands[index]) hands[group.seat] |= 1 << id;
  });
  const boneyard = Int8Array.from(deal.hands[groups.length]);
  for (let index = boneyard.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [boneyard[index], boneyard[other]] = [boneyard[other], boneyard[index]];
  }
  return { hands, boneyard };
}
