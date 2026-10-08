import type { BidAction, BidLevel, BidSuit, BridgeVisibleState, Card, Seat } from '@shared/types';
import { HIGH_CARD_POINTS, SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { getValidBids } from '../engine/bidding';

const SUITS: readonly Card['suit'][] = ['clubs', 'diamonds', 'hearts', 'spades'];
type NaturalBid = Extract<BidAction, { type: 'bid' }>;
interface PartnerDescription {
  minimumPoints: number;
  lengths: Partial<Record<BidSuit, number>>;
  balanced: boolean;
}

function points(hand: readonly Card[]): number {
  return hand.reduce((sum, card) => sum + HIGH_CARD_POINTS[card.rank], 0);
}

function isBalanced(counts: readonly number[]): boolean {
  return ['4333', '4432', '5332'].includes([...counts].sort((a, b) => b - a).join(''));
}

function partnerSeat(seat: Seat): Seat {
  return SEAT_ORDER_CLOCKWISE[(SEAT_ORDER_CLOCKWISE.indexOf(seat) + 2) % 4];
}

function describePartner(visible: BridgeVisibleState): PartnerDescription {
  const description: PartnerDescription = { minimumPoints: 0, lengths: {}, balanced: false };
  const history = visible.bidding!.bids;
  const partner = partnerSeat(visible.mySeat);
  let previous: NaturalBid | undefined;
  for (let index = 0; index < history.length; index++) {
    const entry = history[index];
    if (entry.seat !== partner || entry.action.type !== 'bid') continue;
    const action = entry.action;
    const ownEarlier = history.slice(0, index).filter((item) => item.seat === visible.mySeat && item.action.type === 'bid');
    const ownLast = ownEarlier.at(-1)?.action;
    const opening = !history.slice(0, index).some((item) => item.action.type === 'bid');
    if (!previous && ownEarlier.length === 0) {
      // Fourth-seat forced practice openings can contain no high-card points.
      const weakFourthOpening = opening && index >= 3;
      description.minimumPoints = weakFourthOpening ? 0 : 12;
      if (action.suit === 'nt') {
        description.minimumPoints = action.level === 2 ? 20 : 15;
        description.balanced = true;
      } else {
        description.lengths[action.suit] = action.suit === 'hearts' || action.suit === 'spades' || !opening ? 5 : 3;
      }
    } else if (ownLast?.type === 'bid' && ownLast.suit === action.suit && action.suit !== 'nt') {
      description.lengths[action.suit] = Math.max(description.lengths[action.suit] ?? 0, 3);
      const minimum = action.level >= 4 ? 13 : action.level === 3 ? 10 : 6;
      description.minimumPoints = Math.max(description.minimumPoints, minimum);
    } else if (action.suit === 'nt') {
      description.balanced = true;
      const minimum = ownLast?.type === 'bid' && ownLast.suit === 'nt'
        ? action.level >= 3 ? 10 : action.level === 2 ? 8 : 6
        : action.level >= 3 ? 13 : action.level === 2 ? 10 : 6;
      description.minimumPoints = Math.max(description.minimumPoints, minimum);
    } else {
      description.lengths[action.suit] = Math.max(description.lengths[action.suit] ?? 0, previous?.suit === action.suit ? 6 : 4);
      description.minimumPoints = Math.max(description.minimumPoints, action.level >= 2 ? 10 : 6);
    }
    previous = action;
  }
  return description;
}

function contractLimit(combined: number, suit: BidSuit): BidLevel {
  if (suit === 'nt') return combined >= 25 ? 3 : combined >= 23 ? 2 : 1;
  if (suit === 'hearts' || suit === 'spades') return combined >= 25 ? 4 : combined >= 23 ? 3 : combined >= 18 ? 2 : 1;
  return combined >= 29 ? 5 : combined >= 26 ? 4 : combined >= 23 ? 3 : combined >= 18 ? 2 : 1;
}

export function getNaturalBridgeBid(visible: BridgeVisibleState): BidAction {
  const bidding = visible.bidding;
  if (!bidding) return { type: 'pass' };
  const strength = points(visible.myHand);
  const counts = SUITS.map((suit) => visible.myHand.filter((card) => card.suit === suit).length);
  const balanced = isBalanced(counts);
  const valid = getValidBids(bidding).filter((action): action is NaturalBid => action.type === 'bid');
  const ownBids = bidding.bids.filter((entry) => entry.seat === visible.mySeat && entry.action.type === 'bid');
  const partnerBids = bidding.bids.filter((entry) => entry.seat === partnerSeat(visible.mySeat) && entry.action.type === 'bid');
  const choose = (suit: BidSuit, level: number): NaturalBid | undefined => valid.find((action) => action.suit === suit && action.level === level);
  const length = (suit: BidSuit): number => suit === 'nt' ? 0 : counts[SUITS.indexOf(suit)];
  const suits = [...SUITS].sort((a, b) => length(b) - length(a) || SUITS.indexOf(b) - SUITS.indexOf(a));

  if (partnerBids.length === 0) {
    if (ownBids.length > 0) return { type: 'pass' };
    const opening = !bidding.highestBid;
    if (strength < 12 && !(opening && bidding.consecutivePassCount >= 3)) return { type: 'pass' };
    if (balanced && strength >= 15 && strength <= 17) {
      const nt = choose('nt', 1);
      // An overcall needs a stopper in the opponents' announced suit.
      const enemySuit = bidding.highestBid?.suit;
      const stopped = !enemySuit || enemySuit === 'nt' || visible.myHand.some((card) => card.suit === enemySuit && (card.rank === 14 || (card.rank === 13 && length(enemySuit) >= 2) || (card.rank === 12 && length(enemySuit) >= 3)));
      if (nt && stopped) return nt;
    }
    if (opening && balanced && strength >= 20 && strength <= 21) return choose('nt', 2) ?? { type: 'pass' };
    for (const suit of suits) {
      if (!opening && length(suit) < 5) continue;
      if (opening && strength >= 12 && (suit === 'hearts' || suit === 'spades') && length(suit) < 5) continue;
      const candidate = valid.find((action) => action.suit === suit && action.level <= (opening ? 1 : strength >= 14 ? 2 : 1));
      if (candidate) return candidate;
    }
    return { type: 'pass' };
  }

  const partner = describePartner(visible);
  const combined = strength + partner.minimumPoints;
  const fits = suits.filter((suit) => length(suit) + (partner.lengths[suit] ?? 0) >= 8 && partner.lengths[suit] !== undefined)
    .sort((a, b) => Number(b === 'hearts' || b === 'spades') - Number(a === 'hearts' || a === 'spades') || length(b) + (partner.lengths[b] ?? 0) - length(a) - (partner.lengths[a] ?? 0));
  for (const suit of fits) {
    const candidate = choose(suit, contractLimit(combined, suit));
    if (candidate && strength >= 6) return candidate;
  }
  if (balanced && (partner.balanced || ownBids.length > 0) && combined >= 20) {
    const candidate = choose('nt', contractLimit(combined, 'nt'));
    if (candidate) return candidate;
  }
  // Describe a new four-card suit once; do not repeat a description to keep bidding alive.
  if (ownBids.length === 0 && strength >= 6) {
    for (const suit of suits) {
      if (length(suit) < 4 || partner.lengths[suit] !== undefined) continue;
      const candidate = valid.find((action) => action.suit === suit && action.level <= (strength >= 10 ? 2 : 1));
      if (candidate) return candidate;
    }
    if (balanced) return choose('nt', 1) ?? { type: 'pass' };
  }
  return { type: 'pass' };
}
