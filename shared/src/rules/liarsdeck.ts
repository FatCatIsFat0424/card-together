// ─── Liar's Deck rules engine (pure functions, shared by client and server) ───
// Rules: docs/games.md#liars-deck

import type { LiarCard, LiarFace, LiarsDeckLastPlay, LiarTableFace, Seat } from '../types';
import { SEAT_ORDER_CLOCKWISE } from '../constants';
import { nextSeatCounterClockwise } from './seats';

export const LD_HAND_SIZE = 5;
export const LD_MAX_PLAY = 3;
export const LD_CHAMBERS = 6;
export const LD_TABLE_FACES: readonly LiarTableFace[] = ['K', 'Q', 'A'];
export const LD_FACES: readonly LiarFace[] = ['K', 'Q', 'A', 'joker'];

const FACE_COUNTS: Record<LiarFace, number> = { K: 6, Q: 6, A: 6, joker: 2 };

/** 6 kings, 6 queens, 6 aces and 2 jokers; ids follow this order. */
export const LD_DECK: readonly LiarCard[] = LD_FACES.flatMap((face) =>
  Array.from({ length: FACE_COUNTS[face] }, () => face))
  .map((face, id) => ({ id, face }));

/** Cards that count as the table face in any round: its six copies plus both jokers. */
export const LD_TRUTH_COUNT = FACE_COUNTS.K + FACE_COUNTS.joker;

export function ldIsTruth(face: LiarFace, tableFace: LiarTableFace): boolean {
  return face === 'joker' || face === tableFace;
}

/** A play is a lie when any of its cards is neither the table face nor a joker. */
export function ldIsLie(faces: readonly LiarFace[], tableFace: LiarTableFace): boolean {
  return faces.some((face) => !ldIsTruth(face, tableFace));
}

/** Next surviving seat counterclockwise. */
export function ldNextAlive(seat: Seat, eliminated: readonly Seat[]): Seat {
  let next = nextSeatCounterClockwise(seat);
  while (eliminated.includes(next) && next !== seat) next = nextSeatCounterClockwise(next);
  return next;
}

/** Next seat counterclockwise that still holds cards, or null when no other seat does. */
export function ldNextHolder(seat: Seat, handCounts: Readonly<Record<Seat, number>>): Seat | null {
  let next = nextSeatCounterClockwise(seat);
  while (next !== seat) {
    if (handCounts[next] > 0) return next;
    next = nextSeatCounterClockwise(next);
  }
  return null;
}

/** Only the previous play can be challenged, so the first turn of a round must play. */
export function ldCanChallenge(seat: Seat, lastPlay: LiarsDeckLastPlay | null): boolean {
  return lastPlay !== null && lastPlay.seat !== seat;
}

/** The last seat still holding cards cannot play into an empty table and must call LIAR. */
export function ldMustChallenge(
  seat: Seat, handCounts: Readonly<Record<Seat, number>>, lastPlay: LiarsDeckLastPlay | null,
): boolean {
  return ldCanChallenge(seat, lastPlay) && handCounts[seat] > 0
    && SEAT_ORDER_CLOCKWISE.every((other) => other === seat || handCounts[other] === 0);
}

/** Hand display order: K, Q, A, joker, then deck id. */
export function ldSortHand(hand: readonly LiarCard[]): LiarCard[] {
  return [...hand].sort((a, b) => LD_FACES.indexOf(a.face) - LD_FACES.indexOf(b.face) || a.id - b.id);
}
