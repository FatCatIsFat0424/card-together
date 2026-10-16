import type {
  BidSuit, Card, GameSeat, NapoleonBidAction, NapoleonBidLevel, NapoleonBiddingState, NapoleonCard, Suit,
} from '@shared/types';
import { BID_SUIT_ORDER, RANK_ORDER_DESC } from '@shared/constants';
import {
  compareNapoleonBids, hasNapoleonCard, isNapoleonJoker, isNapoleonPointCard, napoleonBidError, napoleonCardKey,
  napoleonJoker, NAPOLEON_MAX_LEVEL, NAPOLEON_MIN_LEVEL,
} from '@shared/rules/napoleon';

const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

function suitCards(hand: readonly NapoleonCard[], suit: Suit): Card[] {
  return hand.filter((card): card is Card => !isNapoleonJoker(card) && card.suit === suit);
}

function holds(hand: readonly NapoleonCard[], suit: Suit, rank: number): number {
  return Number(hand.some((card) => !isNapoleonJoker(card) && card.suit === suit && card.rank === rank));
}

/** Hand features for one strain, before the exchange. */
function features(hand: readonly NapoleonCard[], strain: BidSuit): number[] {
  const big = Number(hasNapoleonCard(hand, napoleonJoker('big')));
  const small = Number(hasNapoleonCard(hand, napoleonJoker('small')));
  const sides = SUITS.filter((suit) => suit !== strain);
  const sideCount = (rank: number): number => sides.reduce((sum, suit) => sum + holds(hand, suit, rank), 0);
  const lengths = sides.map((suit) => suitCards(hand, suit).length);
  if (strain === 'nt') {
    const longest = Math.max(...lengths);
    return [1, big, small, sideCount(14), sideCount(13), sideCount(12) + sideCount(11), longest];
  }
  const trumps = suitCards(hand, strain).length;
  return [
    1, big, small, trumps, holds(hand, strain, 14), holds(hand, strain, 13), holds(hand, strain, 12),
    holds(hand, strain, 11), sideCount(14), sideCount(13), sideCount(12) + sideCount(11),
    lengths.filter((length) => length === 0).length, lengths.filter((length) => length === 1).length,
  ];
}

/**
 * Linear estimates of the point cards the Napoleon's side takes, by player count, fitted to Hard
 * self-play of random hands in every strain (exchange, call, and play included).
 * Trump weights: constant, big joker, small joker, trump length, trump A K Q J, side A, side K,
 * side Q/J, voids, singletons. No-trump weights: constant, big joker, small joker, A, K, Q/J, longest suit.
 */
const ESTIMATES: Readonly<Record<number, { readonly trump: readonly number[]; readonly nt: readonly number[] }>> = {
  4: {
    trump: [6.20, 0.88, 0.89, 0.56, 0.82, 0.60, 0.26, 0.26, 0.64, 0.29, 0.05, 0.09, 0.10],
    nt: [7.06, 0.98, 1.11, 0.90, 0.49, 0.24, 0.08],
  },
  5: {
    trump: [5.87, 1.05, 1.10, 0.67, 1.02, 0.68, 0.44, 0.41, 0.64, 0.24, 0.03, 0.34, 0.13],
    nt: [6.35, 0.99, 1.22, 0.96, 0.68, 0.20, 0.19],
  },
  6: {
    trump: [6.36, 1.14, 1.44, 0.83, 0.99, 0.84, 0.44, 0.24, 0.52, 0.01, -0.15, -0.01, -0.04],
    nt: [6.32, 1.72, 1.93, 1.31, 0.56, 0.06, 0.17],
  },
};

/** Expected point cards for the Napoleon's side if this hand declares the strain. */
export function estimateNapoleonPoints(hand: readonly NapoleonCard[], strain: BidSuit, playerCount: number): number {
  const weights = ESTIMATES[playerCount]?.[strain === 'nt' ? 'nt' : 'trump'];
  if (!weights) throw new RangeError(`Napoleon needs four to six players, not ${playerCount}.`);
  return features(hand, strain).reduce((sum, value, index) => sum + value * weights[index], 0);
}

/** Bids reach slightly past the estimate; the auction winner's hand still makes most contracts. */
const BID_SLACK = 0.3;

/** The lowest level at which `strain` outbids the current highest bid. */
function lowestLevel(bidding: NapoleonBiddingState, strain: BidSuit): number {
  const highest = bidding.highestBid;
  if (!highest) return NAPOLEON_MIN_LEVEL;
  return compareNapoleonBids({ level: highest.level, suit: strain }, highest) > 0 ? highest.level : highest.level + 1;
}

/** Bids the strain with the most spare strength at the lowest level that wins the auction so far. */
export function chooseHardBid(
  bidding: NapoleonBiddingState, seat: GameSeat, hand: readonly NapoleonCard[], playerCount: number,
): NapoleonBidAction {
  let best: { readonly action: NapoleonBidAction; readonly spare: number } | null = null;
  for (const strain of BID_SUIT_ORDER) {
    const estimate = estimateNapoleonPoints(hand, strain, playerCount);
    const level = lowestLevel(bidding, strain);
    const spare = estimate + BID_SLACK - level;
    if (level > NAPOLEON_MAX_LEVEL || spare < 0 || (best && best.spare >= spare)) continue;
    const action: NapoleonBidAction = { type: 'bid', level: level as NapoleonBidLevel, suit: strain };
    if (napoleonBidError(bidding, seat, action) === null) best = { action, spare };
  }
  return best?.action ?? { type: 'pass' };
}

/** Easy bids only an obviously strong hand, and only to open the auction. */
export function chooseEasyBid(bidding: NapoleonBiddingState, hand: readonly NapoleonCard[], playerCount: number): NapoleonBidAction {
  if (bidding.highestBid) return { type: 'pass' };
  const strength = hand.filter(isNapoleonJoker).length * 2 + hand.filter(isNapoleonPointCard).length;
  const threshold = playerCount === 4 ? 7 : playerCount === 5 ? 6 : 5;
  if (strength < threshold) return { type: 'pass' };
  const length = (suit: Suit): number => suitCards(hand, suit).length;
  const longest = [...SUITS].reverse().reduce((top, suit) => length(suit) > length(top) ? suit : top);
  return { type: 'bid', level: NAPOLEON_MIN_LEVEL, suit: longest };
}

/** How much the Napoleon wants to keep a card, given what remains of its suit. */
function keepValue(card: NapoleonCard, kept: readonly NapoleonCard[], trump: Suit | null): number {
  if (isNapoleonJoker(card)) return 1000;
  if (card.suit === trump) return 200 + card.rank;
  // Short side suits go first so the Napoleon can ruff them; long suits and honors stay.
  const length = suitCards(kept, card.suit).length;
  const honor = card.rank === 14 ? 30 : isNapoleonPointCard(card) ? 12 : 0;
  return card.rank + honor + (length - 1) * (trump ? 1.5 : 2.5);
}

/** Discards the least useful cards, emptying short side suits and keeping jokers, trumps, and points. */
export function chooseHardDiscards(cards: readonly NapoleonCard[], count: number, strain: BidSuit): NapoleonCard[] {
  const trump = strain === 'nt' ? null : strain;
  let kept = [...cards];
  const discards: NapoleonCard[] = [];
  while (discards.length < count && kept.length > 0) {
    const worst = kept.reduce((low, card) => keepValue(card, kept, trump) < keepValue(low, kept, trump) ? card : low);
    discards.push(worst);
    kept = kept.filter((card) => napoleonCardKey(card) !== napoleonCardKey(worst));
  }
  return discards;
}

/** Cards from strongest to weakest for this strain: jokers, trumps from A down, then side cards by rank. */
export function callOrder(strain: BidSuit): NapoleonCard[] {
  const jokers = [napoleonJoker('big'), napoleonJoker('small')];
  const trump = strain === 'nt' ? null : strain;
  const sides = SUITS.filter((suit) => suit !== trump).reverse();
  const trumps = trump ? RANK_ORDER_DESC.map((rank): NapoleonCard => ({ suit: trump, rank })) : [];
  const rest = RANK_ORDER_DESC.flatMap((rank) => sides.map((suit): NapoleonCard => ({ suit, rank })));
  return [...jokers, ...trumps, ...rest];
}

/** Calls the strongest card the Napoleon neither holds nor discarded, so a partner surely exists. */
export function chooseCall(strain: BidSuit, hand: readonly NapoleonCard[], discards: readonly NapoleonCard[]): NapoleonCard {
  const order = callOrder(strain);
  return order.find((card) => !hasNapoleonCard(hand, card) && !hasNapoleonCard(discards, card)) ?? order[0];
}
