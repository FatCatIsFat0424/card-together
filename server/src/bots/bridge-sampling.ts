import type { BridgeVisibleState, Card, Seat, Suit } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { analyzeAuction, BRIDGE_SUITS, humanSeats } from './bridge-auction';
import type { SeatProfile } from './bridge-auction';

// Deals the cards a seat cannot see to the other three hands. Hand sizes and shown voids are hard limits;
// what the auction and partner's signals showed are soft: a few random deals are tried and the one that
// strays least is kept, because human calls and signals need not follow the bot agreements.

/** Random deals tried per sample while looking for one that fits the auction and signals. */
const DEAL_ATTEMPTS = 30;

export const SUIT_INDEX: Readonly<Record<Suit, number>> = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };

export const seatIndex = (seat: Seat): number => SEAT_ORDER_CLOCKWISE.indexOf(seat);
/** `suit * 16 + rank - 2`, the solver's card encoding. */
export const cardCode = (card: Card): number => SUIT_INDEX[card.suit] * 16 + card.rank - 2;

/** A signal reading: `seat` likely holds (or lacks) a top honor in `suit`; `weight` scales a mismatch. */
export interface HonorHint {
  readonly seat: Seat;
  readonly suit: Suit;
  /** True: holds the ace, king, or queen. False: holds neither the ace nor the king. */
  readonly holds: boolean;
  readonly weight: number;
}

export interface DealConstraints {
  readonly me: number;
  readonly myMasks: Int32Array;
  /** Cards nobody has shown, in the solver's encoding. */
  readonly unseen: readonly number[];
  /** Cards each seat still holds; 0 for the viewer. */
  readonly capacity: readonly number[];
  /** Cards each seat already played, as `seat * 4 + suit` rank masks. */
  readonly playedMasks: Int32Array;
  readonly voids: readonly (readonly boolean[])[];
  readonly profiles: readonly SeatProfile[];
  readonly hints: readonly HonorHint[];
}

/** Seats that failed to follow a led suit hold none of it. */
export function shownVoids(visible: BridgeVisibleState): Record<Seat, Set<Suit>> {
  const voids: Record<Seat, Set<Suit>> = { N: new Set(), E: new Set(), S: new Set(), W: new Set() };
  const playing = visible.playing;
  if (!playing) return voids;
  const tricks = [
    ...playing.completedTricks.map((trick) => ({ leadSeat: trick.leadSeat, cards: trick.cards as Partial<Record<Seat, Card>> })),
    { leadSeat: playing.trickLeadSeat, cards: playing.currentTrick },
  ];
  for (const trick of tricks) {
    const led = trick.cards[trick.leadSeat];
    if (!led) continue;
    for (const seat of SEAT_ORDER_CLOCKWISE) {
      const card = trick.cards[seat];
      if (card && card.suit !== led.suit) voids[seat].add(led.suit);
    }
  }
  return voids;
}

/** Everything the seat knows about the hidden hands, from its own view. */
export function dealConstraints(visible: BridgeVisibleState, hints: readonly HonorHint[] = []): DealConstraints {
  const me = seatIndex(visible.mySeat);
  const known = new Set<number>();
  const myMasks = new Int32Array(4);
  for (const card of visible.myHand) {
    myMasks[SUIT_INDEX[card.suit]] |= 1 << (card.rank - 2);
    known.add(cardCode(card));
  }
  const playedMasks = new Int32Array(16);
  const counts = [0, 0, 0, 0];
  const playing = visible.playing;
  const tricks = playing
    ? [...playing.completedTricks.map((trick) => trick.cards as Partial<Record<Seat, Card>>), playing.currentTrick] : [];
  for (const cards of tricks) {
    for (const seat of SEAT_ORDER_CLOCKWISE) {
      const card = cards[seat];
      if (!card) continue;
      const index = seatIndex(seat);
      playedMasks[index * 4 + SUIT_INDEX[card.suit]] |= 1 << (card.rank - 2);
      counts[index]++;
      known.add(cardCode(card));
    }
  }
  const unseen: number[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 0; rank < 13; rank++) if (!known.has(suit * 16 + rank)) unseen.push(suit * 16 + rank);
  }
  const shown = shownVoids(visible);
  const analysis = analyzeAuction(visible.bidding?.bids ?? [], humanSeats(visible));
  return {
    me,
    myMasks,
    unseen,
    capacity: counts.map((count, index) => (index === me ? 0 : 13 - count)),
    playedMasks,
    voids: SEAT_ORDER_CLOCKWISE.map((seat) => BRIDGE_SUITS.map((suit) => shown[seat].has(suit))),
    profiles: SEAT_ORDER_CLOCKWISE.map((seat) => analysis.profiles[seat]),
    hints,
  };
}

export function maskCards(masks: Int32Array, offset: number): Card[] {
  const cards: Card[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 0; rank < 13; rank++) {
      if ((masks[offset + suit] & (1 << rank)) !== 0) cards.push({ suit: BRIDGE_SUITS[suit], rank: (rank + 2) as Card['rank'] });
    }
  }
  return cards;
}

const ACE = 1 << 12;
const KING = 1 << 11;
const QUEEN = 1 << 10;
const JACK = 1 << 9;

function bitCount(mask: number): number {
  let count = 0;
  for (let rest = mask; rest !== 0; rest &= rest - 1) count++;
  return count;
}

/** How far a seat's original hand strays from what its calls and signals showed; 0 when it fits. */
function misfit(hands: Int32Array, constraints: DealConstraints, seat: number): number {
  const profile = constraints.profiles[seat];
  let points = 0;
  let distance = 0;
  let doubletons = 0;
  let short = false;
  for (let suit = 0; suit < 4; suit++) {
    const original = hands[seat * 4 + suit] | constraints.playedMasks[seat * 4 + suit];
    points += ((original & ACE) ? 4 : 0) + ((original & KING) ? 3 : 0) + ((original & QUEEN) ? 2 : 0) + ((original & JACK) ? 1 : 0);
    const length = bitCount(original);
    const name = BRIDGE_SUITS[suit];
    distance += Math.max(0, profile.minLength[name] - length) + Math.max(0, length - profile.maxLength[name]);
    if (length < 2) short = true;
    if (length === 2) doubletons++;
  }
  distance += Math.max(0, profile.minPoints - points) + Math.max(0, points - profile.maxPoints);
  // Balanced: no singleton or void and at most one doubleton (4333, 4432, 5332).
  if (profile.balanced && (short || doubletons > 1)) distance += 2;
  for (const hint of constraints.hints) {
    if (seatIndex(hint.seat) !== seat) continue;
    const suit = SUIT_INDEX[hint.suit];
    const holding = hands[seat * 4 + suit] | constraints.playedMasks[seat * 4 + suit];
    const fits = hint.holds ? (holding & (ACE | KING | QUEEN)) !== 0 : (holding & (ACE | KING)) === 0;
    if (!fits) distance += hint.weight;
  }
  return distance;
}

/** Shuffles `items[0, count)` in place. */
function shuffle(items: Int32Array, count: number, random: () => number): void {
  for (let index = count - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    const value = items[index];
    items[index] = items[other];
    items[other] = value;
  }
}

/**
 * One deal of the unseen cards honoring hand sizes and voids, or null when the attempt got stuck. Cards of
 * suits some seat has shown out of go first, so a constrained seat is not filled before their turn.
 */
function dealOnce(constraints: DealConstraints, order: Int32Array, constrained: number, random: () => number): Int32Array | null {
  const hands = new Int32Array(16);
  hands.set(constraints.myMasks, constraints.me * 4);
  const room = [...constraints.capacity];
  const { voids } = constraints;
  shuffle(order, constrained, random);
  const free = order.subarray(constrained);
  shuffle(free, free.length, random);
  for (let index = 0; index < order.length; index++) {
    const card = order[index];
    const suit = card >> 4;
    let total = 0;
    for (let seat = 0; seat < 4; seat++) if (room[seat] > 0 && !voids[seat][suit]) total += room[seat];
    if (total === 0) return null;
    let pick = random() * total;
    let chosen = -1;
    for (let seat = 0; seat < 4; seat++) {
      if (room[seat] === 0 || voids[seat][suit]) continue;
      chosen = seat;
      pick -= room[seat];
      if (pick < 0) break;
    }
    hands[chosen * 4 + suit] |= 1 << (card & 15);
    room[chosen]--;
  }
  return hands;
}

/**
 * The deal, as `seat * 4 + suit` rank masks of the cards still held, that fits the auction and signals best
 * among a few attempts, stopping early at a perfect fit; null when no attempt honored the voids.
 */
export function sampleDeal(constraints: DealConstraints, random: () => number): Int32Array | null {
  const shownOut = (card: number): boolean => constraints.voids.some((suits, seat) => seat !== constraints.me && suits[card >> 4]);
  const order = Int32Array.from([...constraints.unseen.filter(shownOut), ...constraints.unseen.filter((card) => !shownOut(card))]);
  const constrained = constraints.unseen.filter(shownOut).length;
  let best: Int32Array | null = null;
  let bestMisfit = Infinity;
  for (let attempt = 0; attempt < DEAL_ATTEMPTS && bestMisfit > 0; attempt++) {
    const hands = dealOnce(constraints, order, constrained, random);
    if (!hands) continue;
    let total = 0;
    for (let seat = 0; seat < 4; seat++) if (seat !== constraints.me) total += misfit(hands, constraints, seat);
    if (total < bestMisfit) {
      best = hands;
      bestMisfit = total;
    }
  }
  return best;
}
