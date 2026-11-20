import type { BigTwoVisibleState, Card, Rank, Seat } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { BIGTWO_RANK_ORDER, BIGTWO_SUIT_ORDER } from '@shared/rules/bigtwo';
import type { BigTwoCombo, BigTwoComboType } from '@shared/rules/bigtwo';

// Compact Big Two model shared by the heuristic and the search. A card is a number 0..51 in Big Two order
// (rank value × 4 + suit, so ♣3 = 0 and ♠2 = 51), which is also the shared rules' comparison key for a
// single. Hands are ascending number arrays. Everything here reads only the seat's own filtered view.

export const SINGLE = 0;
export const PAIR = 1;
export const STRAIGHT = 2;
export const FULL_HOUSE = 3;
export const FOUR = 4;
export const STRAIGHT_FLUSH = 5;
/** Rank value of the 2, the highest rank. */
export const TWO = 12;
/** Rank value of the ace. */
export const ACE = 11;

const TYPE_CODES: Readonly<Record<BigTwoComboType, number>> = {
  single: SINGLE, pair: PAIR, straight: STRAIGHT, fullHouse: FULL_HOUSE, fourOfAKind: FOUR, straightFlush: STRAIGHT_FLUSH,
};

/** A play in the compact model; `key` compares plays of one type exactly as the shared rules do. */
export interface FastCombo {
  readonly type: number;
  readonly key: number;
  readonly cards: readonly number[];
}

export const cardIndex = (card: Card): number =>
  BIGTWO_RANK_ORDER.indexOf(card.rank) * 4 + BIGTWO_SUIT_ORDER.indexOf(card.suit);
export const indexCard = (index: number): Card =>
  ({ rank: BIGTWO_RANK_ORDER[index >> 2] as Rank, suit: BIGTWO_SUIT_ORDER[index & 3] });
export const rankOf = (index: number): number => index >> 2;

export function fastCombo(combo: BigTwoCombo): FastCombo {
  return { type: TYPE_CODES[combo.type], key: combo.key, cards: combo.cards.map(cardIndex).sort((a, b) => a - b) };
}

export const isBombType = (type: number): boolean => type >= FOUR;

export function fastBeats(next: FastCombo, previous: FastCombo): boolean {
  if (isBombType(next.type) && !isBombType(previous.type)) return true;
  if (isBombType(next.type) && next.type !== previous.type) return next.type === STRAIGHT_FLUSH;
  return next.type === previous.type && next.key > previous.key;
}

/** Clockwise seat index; play runs counterclockwise, so the next seat is index + 3. */
export const nextSeatIndex = (index: number): number => (index + 3) & 3;
export const seatIndex = (seat: Seat): number => SEAT_ORDER_CLOCKWISE.indexOf(seat);

/** Rank values of each straight A2345 ... 10JQKA; the comparison card's rank value is `index + 2`. */
export const STRAIGHT_RANKS: readonly (readonly number[])[] = Array.from({ length: 10 }, (_, index) => {
  if (index === 0) return [11, 12, 0, 1, 2];
  if (index === 1) return [12, 0, 1, 2, 3];
  return [index - 2, index - 1, index, index + 1, index + 2];
});

/** Cards of each rank, ascending by suit. */
export function byRank(hand: readonly number[]): number[][] {
  const ranks: number[][] = Array.from({ length: 13 }, () => []);
  for (const card of hand) ranks[card >> 2].push(card);
  for (const cards of ranks) if (cards.length > 1) cards.sort((a, b) => a - b);
  return ranks;
}

/** The five-card or smaller combination formed by exactly these cards, or null. */
export function comboOf(cards: readonly number[]): FastCombo | null {
  const sorted = [...cards].sort((a, b) => a - b);
  const top = sorted[sorted.length - 1];
  if (sorted.length === 1) return { type: SINGLE, key: top, cards: sorted };
  if (sorted.length === 2) return rankOf(sorted[0]) === rankOf(top) ? { type: PAIR, key: top, cards: sorted } : null;
  if (sorted.length !== 5) return null;
  const counts = new Map<number, number>();
  for (const card of sorted) counts.set(rankOf(card), (counts.get(rankOf(card)) ?? 0) + 1);
  if (counts.size === 5) {
    const ranks = new Set(counts.keys());
    for (let index = STRAIGHT_RANKS.length - 1; index >= 0; index--) {
      if (!STRAIGHT_RANKS[index].every((rank) => ranks.has(rank))) continue;
      const last = sorted.find((card) => rankOf(card) === index + 2)!;
      const flush = sorted.every((card) => (card & 3) === (top & 3));
      return { type: flush ? STRAIGHT_FLUSH : STRAIGHT, key: index * 4 + (last & 3), cards: sorted };
    }
    return null;
  }
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (groups[0][1] === 4) return { type: FOUR, key: groups[0][0], cards: sorted };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { type: FULL_HOUSE, key: groups[0][0], cards: sorted };
  return null;
}

// ─── Fast follows and leads for rollouts ───

/** The cheapest straight (or straight flush when `flushSuit` is set) beating `minKey`, built from `ranks`. */
function cheapestStraight(ranks: readonly (readonly number[])[], minKey: number, flushSuit: number): number[] | null {
  for (let index = 0; index < STRAIGHT_RANKS.length; index++) {
    if (index * 4 + 3 <= minKey) continue;
    const window = STRAIGHT_RANKS[index];
    const cards: number[] = [];
    let ok = true;
    for (let position = 0; position < 5 && ok; position++) {
      const options = ranks[window[position]];
      let chosen = -1;
      for (const card of options) {
        if (flushSuit >= 0 && (card & 3) !== flushSuit) continue;
        // The comparison card must lift the key past `minKey`; other ranks take their lowest card.
        if (position === 4 && index * 4 + (card & 3) <= minKey) continue;
        chosen = card;
        break;
      }
      if (chosen < 0) ok = false;
      else cards.push(chosen);
    }
    if (!ok) continue;
    // An accidental straight flush is a different (stronger) play; accept it only when asked for one.
    const flush = cards.every((card) => (card & 3) === (cards[0] & 3));
    if (flushSuit < 0 && flush) continue;
    return cards.sort((a, b) => a - b);
  }
  return null;
}

function cheapestFullHouse(ranks: readonly (readonly number[])[], minKey: number): number[] | null {
  for (let triple = minKey + 1; triple < 13; triple++) {
    if (ranks[triple].length < 3) continue;
    let pair = -1;
    for (const wanted of [2, 3, 4]) {
      for (let rank = 0; rank < 13 && pair < 0; rank++) if (rank !== triple && ranks[rank].length === wanted) pair = rank;
      if (pair >= 0) break;
    }
    if (pair < 0) continue;
    return [...ranks[triple].slice(0, 3), ...ranks[pair].slice(0, 2)].sort((a, b) => a - b);
  }
  return null;
}

function cheapestFour(ranks: readonly (readonly number[])[], minKey: number, hand: readonly number[]): number[] | null {
  for (let rank = minKey + 1; rank < 13; rank++) {
    if (ranks[rank].length !== 4) continue;
    const kicker = hand.find((card) => rankOf(card) !== rank && ranks[rankOf(card)].length === 1)
      ?? hand.find((card) => rankOf(card) !== rank);
    if (kicker === undefined) return null;
    return [...ranks[rank], kicker].sort((a, b) => a - b);
  }
  return null;
}

function anyStraightFlush(ranks: readonly (readonly number[])[], minKey: number): number[] | null {
  let best: number[] | null = null;
  let bestKey = Infinity;
  for (let suit = 0; suit < 4; suit++) {
    const cards = cheapestStraight(ranks, minKey, suit);
    if (!cards) continue;
    const key = comboOf(cards)!.key;
    if (key < bestKey) {
      best = cards;
      bestKey = key;
    }
  }
  return best;
}

/** The cheapest play of `previous`'s type that beats it, ignoring bombs unless that is the type. */
export function cheapestBeat(hand: readonly number[], ranks: readonly (readonly number[])[], previous: FastCombo): number[] | null {
  switch (previous.type) {
    case SINGLE: {
      // A card that is not part of a pair goes first; otherwise the lowest card that beats.
      let fallback = -1;
      for (const card of hand) {
        if (card <= previous.key) continue;
        if (ranks[rankOf(card)].length === 1) return [card];
        if (fallback < 0) fallback = card;
      }
      return fallback < 0 ? null : [fallback];
    }
    case PAIR: {
      const minRank = rankOf(previous.key);
      let fallback: number[] | null = null;
      for (let rank = minRank; rank < 13; rank++) {
        const cards = ranks[rank];
        if (cards.length < 2) continue;
        let pair: number[] | null = null;
        if (rank > minRank) pair = [cards[0], cards[1]];
        else {
          const high = cards.find((card) => card > previous.key);
          if (high !== undefined) pair = [cards[0] === high ? cards[1] : cards[0], high].sort((a, b) => a - b);
        }
        if (!pair) continue;
        if (cards.length === 2) return pair;
        fallback ??= pair;
      }
      return fallback;
    }
    case STRAIGHT: return cheapestStraight(ranks, previous.key, -1);
    case FULL_HOUSE: return cheapestFullHouse(ranks, previous.key);
    case FOUR: return cheapestFour(ranks, previous.key, hand);
    default: return anyStraightFlush(ranks, previous.key);
  }
}

/** The cheapest bomb that beats `previous`, or null. */
export function cheapestBomb(hand: readonly number[], ranks: readonly (readonly number[])[], previous: FastCombo): number[] | null {
  if (previous.type === STRAIGHT_FLUSH) return anyStraightFlush(ranks, previous.key);
  const four = cheapestFour(ranks, previous.type === FOUR ? previous.key : -1, hand);
  return four ?? anyStraightFlush(ranks, -1);
}

/** Whether the single highest-ranked combination of the hand plays it out in one go. */
export function wholeHand(hand: readonly number[]): FastCombo | null {
  return hand.length === 1 || hand.length === 2 || hand.length === 5 ? comboOf(hand) : null;
}

/** A lead that sheds the lowest card in the largest combination containing it. */
export function sheddingLead(hand: readonly number[], ranks: readonly (readonly number[])[]): number[] {
  const low = hand[0];
  const lowRank = rankOf(low);
  // A straight through the lowest card, taking the lowest card of each rank, unless it breaks a pair of 2s.
  for (let index = 0; index < STRAIGHT_RANKS.length; index++) {
    const window = STRAIGHT_RANKS[index];
    if (!window.includes(lowRank) || !window.every((rank) => ranks[rank].length > 0)) continue;
    if (window.some((rank) => rank >= ACE && ranks[rank].length === 1 && rank !== lowRank)) continue;
    const cards = window.map((rank) => (rank === lowRank ? low : ranks[rank][0]));
    if (comboOf(cards)?.type === STRAIGHT) return cards.sort((a, b) => a - b);
  }
  const lowCards = ranks[lowRank];
  if (lowCards.length === 3) {
    for (let rank = 0; rank < 13; rank++) {
      if (rank !== lowRank && ranks[rank].length === 2 && rank < ACE) return [...lowCards, ...ranks[rank]].sort((a, b) => a - b);
    }
  }
  if (lowCards.length === 2) {
    for (let rank = 0; rank < ACE; rank++) {
      if (rank !== lowRank && ranks[rank].length === 3) return [...lowCards, ...ranks[rank]].sort((a, b) => a - b);
    }
  }
  if (lowCards.length >= 2) return [lowCards[0], lowCards[1]];
  return [low];
}

/** A lead that avoids leaving a one-card opponent a single to beat: pairs and five-card plays first, then the top single. */
export function blockingLead(hand: readonly number[], ranks: readonly (readonly number[])[]): number[] {
  const five = cheapestStraight(ranks, -1, -1) ?? cheapestFullHouse(ranks, -1);
  if (five) return five;
  for (let rank = 0; rank < 13; rank++) if (ranks[rank].length >= 2) return [ranks[rank][0], ranks[rank][1]];
  return [hand[hand.length - 1]];
}

// ─── Public knowledge from the log ───

/** One pass by another seat, with the play it declined and the cards that seat has played since. */
export interface PassEvidence {
  readonly seat: number;
  readonly declined: FastCombo;
  readonly playedLater: readonly number[];
}

export interface BigTwoKnowledge {
  /** Cards nobody has played and the seat does not hold. */
  readonly unseen: readonly number[];
  readonly played: ReadonlySet<number>;
  readonly passes: readonly PassEvidence[];
  /**
   * Per clockwise seat index: the highest single the seat still might hold given its passes on singles
   * (51 when unknown). Soft: a seat may pass while holding a higher card.
   */
  readonly singleCeiling: readonly number[];
}

export function readKnowledge(visible: BigTwoVisibleState): BigTwoKnowledge {
  const played = new Set<number>();
  const mine = new Set(visible.myHand.map(cardIndex));
  const me = seatIndex(visible.mySeat);
  const pending: { seat: number; declined: FastCombo; playedLater: number[] }[] = [];
  const singleCeiling = [51, 51, 51, 51];
  let last: FastCombo | null = null;
  for (const entry of visible.log) {
    if (entry.type === 'play') {
      const cards = entry.cards.map(cardIndex);
      for (const card of cards) played.add(card);
      const seat = seatIndex(entry.seat);
      for (const evidence of pending) if (evidence.seat === seat) evidence.playedLater.push(...cards);
      last = comboOf(cards);
    } else if (entry.type === 'pass') {
      const seat = seatIndex(entry.seat);
      if (last && seat !== me) {
        pending.push({ seat, declined: last, playedLater: [] });
        if (last.type === SINGLE) singleCeiling[seat] = Math.min(singleCeiling[seat], last.key);
      }
    } else if (entry.type === 'round_end') last = null;
  }
  // A seat that later played a single above its ceiling had passed by choice; the ceiling no longer holds.
  for (const evidence of pending) {
    const top = Math.max(-1, ...evidence.playedLater);
    if (evidence.declined.type === SINGLE && top > evidence.declined.key) singleCeiling[evidence.seat] = 51;
  }
  const unseen: number[] = [];
  for (let card = 0; card < 52; card++) if (!played.has(card) && !mine.has(card)) unseen.push(card);
  return { unseen, played, passes: pending, singleCeiling };
}

/**
 * Answers whether some unseen holding could beat a play when held by a seat with `maxCards` cards. Card
 * counting only: who holds which unseen card is not assumed.
 */
export function unseenBeatChecker(unseen: readonly number[], maxCards: number): (combo: FastCombo) => boolean {
  const ranks = byRank(unseen);
  const top = unseen.length > 0 ? Math.max(...unseen) : -1;
  const bombs = maxCards >= 5 && (ranks.some((cards) => cards.length === 4) || anyStraightFlush(ranks, -1) !== null);
  const straightFlush = maxCards >= 5 && anyStraightFlush(ranks, -1) !== null;
  return (combo) => {
    if (bombs && !isBombType(combo.type)) return true;
    if (maxCards < combo.cards.length) return false;
    switch (combo.type) {
      case SINGLE: return top > combo.key;
      case PAIR: return ranks.some((cards) => cards.length >= 2 && cards[cards.length - 1] > combo.key);
      case STRAIGHT: return cheapestStraight(ranks, combo.key, -1) !== null;
      case FULL_HOUSE: {
        for (let rank = combo.key + 1; rank < 13; rank++) {
          if (ranks[rank].length >= 3 && ranks.some((cards, other) => other !== rank && cards.length >= 2)) return true;
        }
        return false;
      }
      case FOUR: return straightFlush || ranks.some((cards, rank) => cards.length === 4 && rank > combo.key);
      default: return anyStraightFlush(ranks, combo.key) !== null;
    }
  };
}

/**
 * How the hand could have answered a declined play: 0 not at all, 1 only with a 2, a bomb, or by splitting a
 * pair or triple, 2 with ordinary cards.
 */
export function answerKind(hand: readonly number[], declined: FastCombo): number {
  const sorted = [...hand].sort((a, b) => a - b);
  const ranks = byRank(sorted);
  const beat = cheapestBeat(sorted, ranks, declined);
  if (beat) {
    // Breaking a pair or triple for a single, or a triple for a pair, is a reason to pass as good as a 2.
    const splits = beat.length <= 2 && ranks[rankOf(beat[0])].length > beat.length;
    return splits || beat.some((card) => rankOf(card) === TWO) ? 1 : 2;
  }
  return cheapestBomb(sorted, ranks, declined) ? 1 : 0;
}
