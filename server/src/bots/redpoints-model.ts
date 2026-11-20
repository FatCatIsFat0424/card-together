import type { Card, RedPointsVisibleState, Seat } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { rpCanPair, rpCardPoints } from '@shared/rules/redpoints';

// Compact Red Points model shared by the heuristic and the search. A card is a number 0..51 (suit × 13 +
// rank − 2); pairing and points come from lookup tables built from the shared rules. Everything here reads only
// the seat's own filtered view.

const SUITS: readonly Card['suit'][] = ['clubs', 'diamonds', 'hearts', 'spades'];

export const rpIndex = (card: Card): number => SUITS.indexOf(card.suit) * 13 + card.rank - 2;
export const rpCard = (index: number): Card => ({ suit: SUITS[Math.floor(index / 13)], rank: (index % 13) + 2 as Card['rank'] });

/** Points of each card. */
export const POINTS: readonly number[] = Array.from({ length: 52 }, (_, index) => rpCardPoints(rpCard(index)));
const PAIRS = new Uint8Array(52 * 52);
for (let a = 0; a < 52; a++) for (let b = 0; b < 52; b++) PAIRS[a * 52 + b] = rpCanPair(rpCard(a), rpCard(b)) ? 1 : 0;
export const pairs = (a: number, b: number): boolean => PAIRS[a * 52 + b] === 1;

/** Clockwise seat index; play runs counterclockwise, so the next seat is index + 3. */
export const seatIndex = (seat: Seat): number => SEAT_ORDER_CLOCKWISE.indexOf(seat);
export const nextSeatIndex = (index: number): number => (index + 3) & 3;

/** The most valuable table card `card` captures, or -1. */
export function bestTarget(card: number, table: readonly number[]): number {
  let best = -1;
  for (const target of table) if (pairs(card, target) && (best < 0 || POINTS[target] > POINTS[best])) best = target;
  return best;
}

/** One hand play by another seat, with the table it faced and the cards it played from then on. */
export interface PlayEvidence {
  readonly seat: number;
  readonly table: readonly number[];
  /** Points the play actually took. */
  readonly gained: number;
  /** This play's card and every later hand card of the seat: what it held then besides its current hand. */
  readonly heldSince: readonly number[];
}

export interface RedPointsKnowledge {
  /** Cards in other hands or the stock: not held, on the table, captured, or the pending flip. */
  readonly unseen: readonly number[];
  readonly hand: readonly number[];
  readonly table: readonly number[];
  readonly scores: readonly number[];
  readonly plays: readonly PlayEvidence[];
}

export function readKnowledge(visible: RedPointsVisibleState): RedPointsKnowledge {
  const hand = visible.myHand.map(rpIndex);
  const table = visible.table.map(rpIndex);
  const known = new Set([...hand, ...table]);
  const scores = [0, 0, 0, 0];
  for (const seat of SEAT_ORDER_CLOCKWISE) {
    for (const card of visible.captured[seat] ?? []) {
      known.add(rpIndex(card));
      scores[seatIndex(seat)] += rpCardPoints(card);
    }
  }
  if (visible.pendingFlip) known.add(rpIndex(visible.pendingFlip));
  const unseen: number[] = [];
  for (let card = 0; card < 52; card++) if (!known.has(card)) unseen.push(card);

  // Walk the log backwards from the current table to recover the table each play faced.
  const me = seatIndex(visible.mySeat);
  const plays: PlayEvidence[] = [];
  const later: number[][] = [[], [], [], []];
  let current = [...table];
  for (let index = visible.log.length - 1; index >= 0; index--) {
    const entry = visible.log[index];
    const card = rpIndex(entry.card);
    current = entry.captured ? [...current, rpIndex(entry.captured)] : current.filter((own) => own !== card);
    if (entry.type !== 'play') continue;
    const seat = seatIndex(entry.seat);
    later[seat].push(card);
    if (seat === me) continue;
    const gained = entry.captured ? POINTS[card] + POINTS[rpIndex(entry.captured)] : 0;
    plays.push({ seat, table: current, gained, heldSince: [...later[seat]] });
  }
  return { unseen, hand, table, scores, plays };
}

/** The most points one play from `hand` could take from `table`. */
export function bestCapture(hand: readonly number[], table: readonly number[]): number {
  let best = 0;
  for (const card of hand) {
    const target = bestTarget(card, table);
    if (target >= 0) best = Math.max(best, POINTS[card] + POINTS[target]);
  }
  return best;
}
