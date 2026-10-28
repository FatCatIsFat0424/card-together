// ─── Liar's Dice rules engine (pure functions, shared by client and server) ───
// Rules: docs/games/dice.md#吹牛骰

import type { DiceFace, GameSeat, LiarsDiceBid } from '../types';

export const LDI_DICE_PER_PLAYER = 5;
export const LDI_FACES = 6;
export const LDI_WILD_FACE: DiceFace = 1;
export const LDI_ALL_FACES: readonly DiceFace[] = [1, 2, 3, 4, 5, 6];

/** `random` returns a number in [0, 1). */
export function ldiRoll(count: number, random: () => number): DiceFace[] {
  return Array.from({ length: count }, () => 1 + Math.min(LDI_FACES - 1, Math.floor(random() * LDI_FACES)) as DiceFace);
}

export function ldiTotalDice(counts: Readonly<Partial<Record<GameSeat, number>>>): number {
  return Object.values(counts).reduce<number>((sum, count) => sum + (count ?? 0), 0);
}

/** Faces from lowest to highest: ones outrank every other face. */
export const LDI_FACE_ORDER: readonly DiceFace[] = [2, 3, 4, 5, 6, 1];

function faceRank(face: DiceFace): number {
  return LDI_FACE_ORDER.indexOf(face);
}

/** Whether `next` outbids `previous`: more dice of any face, or the same number of a higher face. */
export function ldiRaises(previous: LiarsDiceBid, next: LiarsDiceBid): boolean {
  return next.quantity > previous.quantity
    || (next.quantity === previous.quantity && faceRank(next.face) > faceRank(previous.face));
}

/** A well-formed bid no larger than the dice in play that outbids the standing bid, if any. */
export function ldiIsLegalBid(previous: LiarsDiceBid | null, next: LiarsDiceBid, totalDice: number): boolean {
  return Number.isInteger(next.quantity) && next.quantity >= 1 && next.quantity <= totalDice
    && LDI_ALL_FACES.includes(next.face) && (previous === null || ldiRaises(previous, next));
}

/** Every legal bid, from lowest to highest. */
export function ldiLegalBids(previous: LiarsDiceBid | null, totalDice: number): LiarsDiceBid[] {
  const bids: LiarsDiceBid[] = [];
  for (let quantity = 1; quantity <= totalDice; quantity++) {
    for (const face of LDI_FACE_ORDER) {
      if (ldiIsLegalBid(previous, { quantity, face }, totalDice)) bids.push({ quantity, face });
    }
  }
  return bids;
}

/** The lowest legal bid; null when only a challenge remains. */
export function ldiMinimalBid(previous: LiarsDiceBid | null, totalDice: number): LiarsDiceBid | null {
  return ldiLegalBids(previous, totalDice)[0] ?? null;
}

/** Bidding on ones ends their wild role for the rest of the round. */
export function ldiOnesWildAfter(onesWild: boolean, bid: LiarsDiceBid): boolean {
  return onesWild && bid.face !== LDI_WILD_FACE;
}

/** Dice showing `face`; ones also count while they are wild, except when the bid itself is on ones. */
export function ldiCountFace(dice: readonly DiceFace[], face: DiceFace, onesWild: boolean): number {
  const wild = onesWild && face !== LDI_WILD_FACE;
  return dice.filter((die) => die === face || (wild && die === LDI_WILD_FACE)).length;
}

export interface LiarsDiceCall {
  readonly count: number;
  /** The bid holds, so the challenger loses a die */
  readonly bidTrue: boolean;
}

/** Counts every cup against the bid; reaching the bid's quantity makes it true. */
export function ldiResolveCall(
  dice: Readonly<Partial<Record<GameSeat, readonly DiceFace[]>>>, bid: LiarsDiceBid, onesWild: boolean,
): LiarsDiceCall {
  const count = Object.values(dice).reduce<number>((sum, cup) => sum + ldiCountFace(cup ?? [], bid.face, onesWild), 0);
  return { count, bidTrue: count >= bid.quantity };
}

/** Next seat after `seat` in `seats` order that has not been eliminated. */
export function ldiNextAlive(seat: GameSeat, seats: readonly GameSeat[], eliminated: readonly GameSeat[]): GameSeat {
  const start = seats.indexOf(seat);
  for (let step = 1; step <= seats.length; step++) {
    const candidate = seats[(start + step) % seats.length];
    if (!eliminated.includes(candidate)) return candidate;
  }
  return seat;
}

/** The loser opens the next round, or the next survivor when the loser's last die went. */
export function ldiNextStarter(loser: GameSeat, seats: readonly GameSeat[], eliminated: readonly GameSeat[]): GameSeat {
  return eliminated.includes(loser) ? ldiNextAlive(loser, seats, eliminated) : loser;
}
