import type { GameSeat, Rank } from '@shared/types';
import type { GoFishVisibleState } from '@shared/games/gofish/types';
import { GF_BOOK_SIZE, gfHandSize } from '@shared/rules/gofish';
import { dealUnseen } from './search/card-dealer';
import type { DealSeat } from './search/card-dealer';

// What one seat can know about the other hands in the hand in play, from its own cards and the public log.
// Ranks are indexed 0–12 (2 through ace). Every other hand is split into cards whose rank the log shows
// (an asked rank, cards handed over, a lucky draw) and unknown cards. Each unknown card keeps the set of
// ranks it may still be: a refusal, handing over a whole rank, or a booked rank rule ranks out for every
// card in that hand at that moment, and a missed draw cannot be the asked rank. Cards drawn later start
// unconstrained, so old refusals never apply to them. The copies of each rank that are neither in this hand,
// shown elsewhere, nor booked lie among the unknown cards and the stock; sampling deals exactly those.

export const GF_RANKS = 13;
const ALL_RANKS = (1 << GF_RANKS) - 1;

export const rankIndex = (rank: Rank): number => rank - 2;
export const indexRank = (index: number): Rank => (index + 2) as Rank;

/** One other seat's hand as the log shows it. */
export interface SeatKnowledge {
  /** Cards of each rank the seat is shown to hold */
  readonly known: number[];
  /** One bit mask of possible ranks per unknown card */
  readonly unknown: number[];
}

export interface GoFishKnowledge {
  /** Seats in play order; `mine` is the deciding seat's index */
  readonly seats: readonly GameSeat[];
  readonly mine: number;
  /** Cards of each rank in the deciding seat's hand */
  readonly own: readonly number[];
  /** Per seat in `seats` order; the deciding seat's entry is empty */
  readonly hands: readonly SeatKnowledge[];
  /** Bit per booked rank */
  readonly booked: number;
  /** Copies of each rank among the unknown cards and the stock */
  readonly hidden: readonly number[];
  readonly stock: number;
  /** False when the log could not be followed exactly and only hand sizes were used */
  readonly exact: boolean;
}

const bit = (index: number): number => 1 << index;

function bitCount(mask: number): number {
  let count = 0;
  for (let value = mask; value !== 0; value &= value - 1) count++;
  return count;
}

/**
 * Removes one unknown card of `rank`; false when no unknown card may have it. Which card it was is not
 * known, so the most constrained candidate is removed and every other candidate widens to also allow
 * whatever the removed one allowed: the card that really left may have been any of them, and the removed
 * card's own value then sits in its place. Nested possibilities (the usual case) lose nothing.
 */
function takeUnknown(hand: SeatKnowledge, rank: number): boolean {
  const slots = hand.unknown;
  let chosen = -1;
  for (let index = 0; index < slots.length; index++) {
    if ((slots[index] & bit(rank)) !== 0 && (chosen < 0 || bitCount(slots[index]) < bitCount(slots[chosen]))) chosen = index;
  }
  if (chosen < 0) return false;
  const [removed] = slots.splice(chosen, 1);
  for (let index = 0; index < slots.length; index++) if ((slots[index] & bit(rank)) !== 0) slots[index] |= removed;
  return true;
}

/** Removes `count` cards of `rank`, shown ones first; false when the hand cannot have had them. */
function removeCards(hand: SeatKnowledge, rank: number, count: number): boolean {
  let left = count;
  const shown = Math.min(hand.known[rank], left);
  hand.known[rank] -= shown;
  left -= shown;
  for (; left > 0; left--) if (!takeUnknown(hand, rank)) return false;
  return true;
}

function ruleOut(hand: SeatKnowledge, rank: number): void {
  for (let index = 0; index < hand.unknown.length; index++) hand.unknown[index] &= ~bit(rank);
}

function emptyHand(): SeatKnowledge {
  return { known: new Array<number>(GF_RANKS).fill(0), unknown: [] };
}

/** The log entries of the hand in play. */
function currentHandLog(visible: GoFishVisibleState): GoFishVisibleState['log'] {
  let start = 0;
  visible.log.forEach((entry, index) => {
    if (entry.type === 'hand') start = index;
  });
  return visible.log.slice(start);
}

/** Replays the hand's log; null when it contradicts itself (then only hand sizes are trusted). */
function followLog(visible: GoFishVisibleState, seats: readonly GameSeat[], mine: number): SeatKnowledge[] | null {
  const hands = seats.map(() => emptyHand());
  const at = (seat: GameSeat): SeatKnowledge | null => {
    const index = seats.indexOf(seat);
    return index < 0 || index === mine ? null : hands[index];
  };
  let booked = 0;
  for (const entry of currentHandLog(visible)) {
    switch (entry.type) {
      case 'hand': {
        const size = gfHandSize(seats.length);
        hands.forEach((hand, index) => {
          if (index !== mine) hand.unknown.push(...new Array<number>(size).fill(ALL_RANKS));
        });
        break;
      }
      case 'ask': {
        const rank = rankIndex(entry.rank);
        const asker = at(entry.seat);
        const target = at(entry.target);
        // The asker holds the rank: an unknown card becomes a shown one.
        if (asker && asker.known[rank] === 0) {
          if (!takeUnknown(asker, rank)) return null;
          asker.known[rank] = 1;
        }
        if (target) {
          if (entry.given > 0 && !removeCards(target, rank, entry.given)) return null;
          if (entry.given === 0 && target.known[rank] > 0) return null;
          ruleOut(target, rank);
        }
        if (asker) {
          asker.known[rank] += entry.given;
          if (entry.fished === 'lucky') asker.known[rank] += 1;
          else if (entry.fished === 'miss') asker.unknown.push(ALL_RANKS & ~booked & ~bit(rank));
        }
        break;
      }
      case 'book': {
        const rank = rankIndex(entry.rank);
        const holder = at(entry.seat);
        if (holder && !removeCards(holder, rank, GF_BOOK_SIZE)) return null;
        booked |= bit(rank);
        for (const hand of hands) {
          hand.known[rank] = 0;
          ruleOut(hand, rank);
        }
        break;
      }
      case 'refill':
        at(entry.seat)?.unknown.push(ALL_RANKS & ~booked);
        break;
      case 'handEnd':
        break;
    }
  }
  return hands;
}

/** Sizes alone: every other hand is unknown cards that may be any unbooked rank. */
function sizesOnly(visible: GoFishVisibleState, seats: readonly GameSeat[], mine: number, booked: number): SeatKnowledge[] {
  return seats.map((seat, index) => ({
    known: new Array<number>(GF_RANKS).fill(0),
    unknown: index === mine ? [] : new Array<number>(visible.handCounts[seat]).fill(ALL_RANKS & ~booked),
  }));
}

/** Reads the seat's view into hand knowledge. Reads `visible` only. */
export function goFishKnowledge(visible: GoFishVisibleState): GoFishKnowledge {
  const seats = [...visible.seats];
  const mine = seats.indexOf(visible.mySeat);
  const own = new Array<number>(GF_RANKS).fill(0);
  for (const card of visible.myHand) own[rankIndex(card.rank)]++;
  let booked = 0;
  for (const seat of seats) for (const rank of visible.books[seat] ?? []) booked |= bit(rankIndex(rank));

  const hiddenOf = (hands: readonly SeatKnowledge[]): number[] => Array.from({ length: GF_RANKS }, (_, rank) => (
    (booked & bit(rank)) !== 0 ? 0 : GF_BOOK_SIZE - own[rank] - hands.reduce((sum, hand) => sum + hand.known[rank], 0)));
  const fits = (hands: readonly SeatKnowledge[], hidden: readonly number[]): boolean => {
    if (hidden.some((count) => count < 0)) return false;
    const places = hands.reduce((sum, hand) => sum + hand.unknown.length, 0) + visible.stockCount;
    if (places !== hidden.reduce((sum, count) => sum + count, 0)) return false;
    return seats.every((seat, index) => index === mine
      || hands[index].unknown.length + hands[index].known.reduce((sum, count) => sum + count, 0) === visible.handCounts[seat]);
  };

  const followed = followLog(visible, seats, mine);
  if (followed) {
    for (const hand of followed) for (let index = 0; index < hand.unknown.length; index++) hand.unknown[index] &= ~booked;
    const hidden = hiddenOf(followed);
    if (fits(followed, hidden)) {
      return { seats, mine, own, hands: followed, booked, hidden, stock: visible.stockCount, exact: true };
    }
  }
  const loose = sizesOnly(visible, seats, mine, booked);
  const hidden = hiddenOf(loose).map((count) => Math.max(0, count));
  return { seats, mine, own, hands: loose, booked, hidden, stock: visible.stockCount, exact: false };
}

/**
 * Whether `seat` surely holds `rank`: the log shows it, or the stock is empty and no other hand's unknown
 * cards may be that rank while copies are still hidden, so they must all be in this hand.
 */
export function certainHolder(knowledge: GoFishKnowledge, seat: number, rank: number): boolean {
  const hand = knowledge.hands[seat];
  if (hand.known[rank] > 0) return true;
  if (knowledge.stock > 0 || knowledge.hidden[rank] === 0) return false;
  const mayHold = (slots: readonly number[]): boolean => slots.some((mask) => (mask & bit(rank)) !== 0);
  return mayHold(hand.unknown)
    && knowledge.hands.every((other, index) => index === seat || index === knowledge.mine || !mayHold(other.unknown));
}

/** What every seat can read from the log alone: the same knowledge, with no hand of one's own. */
export function goFishPublicKnowledge(visible: GoFishVisibleState): GoFishKnowledge {
  return goFishKnowledge({ ...visible, mySeat: '' as GameSeat, myHand: [] });
}

/** One full layout consistent with the knowledge: rank counts per seat (own hand included) and the stock. */
export interface GoFishWorld {
  /** `seats.length * 13` rank counts */
  readonly counts: Int8Array;
  /** Ranks from the top of the stock down */
  readonly stock: Int8Array;
}

/**
 * Deals the hidden copies to the unknown cards and the stock at random, honoring every rank an unknown card
 * is ruled out of. Null when no consistent deal was found.
 */
export function sampleGoFishWorld(knowledge: GoFishKnowledge, random: () => number): GoFishWorld | null {
  const { seats, mine, hands, hidden } = knowledge;
  const unseen: number[] = [];
  hidden.forEach((count, rank) => {
    for (let copy = 0; copy < count; copy++) unseen.push(rank);
  });
  // Unknown cards with the same possibilities form one dealing group.
  const groups: { seat: number; mask: number; size: number }[] = [];
  hands.forEach((hand, seat) => {
    if (seat === mine) return;
    for (const mask of hand.unknown) {
      const group = groups.find((entry) => entry.seat === seat && entry.mask === mask);
      if (group) group.size++;
      else groups.push({ seat, mask, size: 1 });
    }
  });
  const dealSeats: DealSeat<number>[] = groups.map(({ mask, size }) => ({ size, accepts: (rank: number) => (mask & bit(rank)) !== 0 }));
  dealSeats.push({ size: knowledge.stock });
  const deal = dealUnseen({ unseen, seats: dealSeats, attempts: 1 }, random);
  if (!deal) return null;

  const counts = new Int8Array(seats.length * GF_RANKS);
  for (let rank = 0; rank < GF_RANKS; rank++) counts[mine * GF_RANKS + rank] = knowledge.own[rank];
  hands.forEach((hand, seat) => {
    if (seat !== mine) for (let rank = 0; rank < GF_RANKS; rank++) counts[seat * GF_RANKS + rank] += hand.known[rank];
  });
  groups.forEach((group, index) => {
    for (const rank of deal.hands[index]) counts[group.seat * GF_RANKS + rank]++;
  });
  const stock = Int8Array.from(deal.hands[groups.length]);
  for (let index = stock.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [stock[index], stock[other]] = [stock[other], stock[index]];
  }
  return { counts, stock };
}
