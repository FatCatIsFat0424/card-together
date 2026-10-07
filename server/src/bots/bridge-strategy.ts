import type { BidAction, BidLevel, BridgeVisibleState, Card, Seat } from '@shared/types';
import { HIGH_CARD_POINTS, SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { getValidBids } from '../engine/bidding';
import { compareCards } from '../engine/playing';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

const SUITS: readonly Card['suit'][] = ['clubs', 'diamonds', 'hearts', 'spades'];

function isPartner(a: Seat, b: Seat): boolean {
  return (SEAT_ORDER_CLOCKWISE.indexOf(a) + 2) % 4 === SEAT_ORDER_CLOCKWISE.indexOf(b);
}

function handPoints(hand: readonly Card[]): number {
  return hand.reduce((sum, card) => sum + HIGH_CARD_POINTS[card.rank], 0);
}

function bid(visible: BridgeVisibleState, random: () => number): BidAction {
  const bidding = visible.bidding;
  if (!bidding) return { type: 'pass' };
  const points = handPoints(visible.myHand);
  const counts = SUITS.map((suit) => visible.myHand.filter((card) => card.suit === suit).length);
  const balanced = counts.every((count) => count >= 2 && count <= 5);
  const highest = bidding.highestBid;
  const hasBid = bidding.bids.some((entry) => entry.seat === visible.mySeat && entry.action.type === 'bid');
  if (hasBid) return { type: 'pass' };

  if (highest && isPartner(visible.mySeat, highest.seat)) {
    // Raise only a known fit, once, rather than competing against our partner.
    const support = highest.suit !== 'nt' && counts[SUITS.indexOf(highest.suit)] >= 4;
    const limit = points >= 16 ? 3 : points >= 10 ? 2 : 1;
    if (support && highest.level < limit) {
      return { type: 'bid', level: (highest.level + 1) as BidLevel, suit: highest.suit };
    }
    return { type: 'pass' };
  }

  // A fourth-seat low opening prevents an all-bot practice table from repeatedly redealing.
  const mustOpen = !highest && bidding.consecutivePassCount >= 3;
  if (!highest && points < 12 && !mustOpen) return { type: 'pass' };
  if (highest && points < 12) return { type: 'pass' };
  const candidates: { value: BidAction; score: number }[] = [];
  for (const action of getValidBids(bidding)) {
    if (action.type !== 'bid') continue;
    if (action.suit === 'nt') {
      const level = highest ? 1 : points >= 20 ? 2 : 1;
      const qualified = highest ? points >= 18 : points >= 15;
      if (balanced && qualified && action.level === level) {
        candidates.push({ value: action, score: 17 });
      }
      continue;
    }
    const length = counts[SUITS.indexOf(action.suit)];
    const limit = highest ? points >= 23 ? 3 : points >= 14 ? 2 : 1 : 1;
    if (action.level > limit || (highest && length < 5)) continue;
    const suitPoints = handPoints(visible.myHand.filter((card) => card.suit === action.suit));
    const major = action.suit === 'hearts' || action.suit === 'spades';
    candidates.push({ value: action, score: length * 2 + suitPoints * 0.6 + Number(major) * 0.4 - (action.level - 1) * 6 });
  }
  return selectNearBest(candidates, random, 0.8) ?? { type: 'pass' };
}

function publicCards(visible: BridgeVisibleState): Card[] {
  if (!visible.playing) return [];
  return [
    ...visible.playing.completedTricks.flatMap((trick) => Object.values(trick.cards)),
    ...Object.values(visible.playing.currentTrick),
  ];
}

function outstandingHigher(card: Card, visible: BridgeVisibleState, played: readonly Card[]): number {
  const known = [...visible.myHand, ...played];
  let count = 0;
  for (let rank = card.rank + 1; rank <= 14; rank++) {
    if (!known.some((other) => other.suit === card.suit && other.rank === rank)) count++;
  }
  return count;
}

function play(visible: BridgeVisibleState, random: () => number): Card | null {
  const playing = visible.playing;
  const contract = visible.contract;
  if (!playing || !contract || visible.validCards.length === 0) return null;
  const played = publicCards(visible);
  const lead = playing.currentTrick[playing.trickLeadSeat];
  if (!lead) {
    const unseenTrump = contract.suit !== 'nt'
      ? 13 - [...visible.myHand, ...played].filter((card) => card.suit === contract.suit).length
      : 0;
    const declarerTeam = visible.mySeat === contract.declarer || isPartner(visible.mySeat, contract.declarer);
    const trumpCount = visible.myHand.filter((card) => card.suit === contract.suit).length;
    const options = visible.validCards.map((card) => {
      const length = visible.myHand.filter((other) => other.suit === card.suit).length;
      const higher = outstandingHigher(card, visible, played);
      const master = higher === 0;
      const trump = card.suit === contract.suit;
      // Cash established winners; otherwise build long suits without throwing away unsupported honors.
      let score = length * 1.5 - card.rank * 0.22 + (master ? 12 : 0);
      if (trump) score += declarerTeam && trumpCount >= 4 && unseenTrump > 0 ? 7 : -5;
      if (!master && card.rank >= 11) score -= 3;
      const knownRuff = playing.completedTricks.some((trick) => {
        const suit = trick.cards[trick.leadSeat].suit;
        return suit === card.suit && SEAT_ORDER_CLOCKWISE.some((seat) =>
          seat !== visible.mySeat && !isPartner(seat, visible.mySeat) && trick.cards[seat].suit !== suit);
      });
      if (knownRuff && contract.suit !== 'nt' && !trump && unseenTrump > 0) score -= 7;
      return { value: card, score };
    });
    return selectNearBest(options, random, 0.6);
  }

  let winnerSeat = playing.trickLeadSeat;
  let winnerCard = lead;
  for (const seat of SEAT_ORDER_CLOCKWISE) {
    const card = playing.currentTrick[seat];
    if (card && compareCards(card, winnerCard, lead.suit, contract.suit) > 0) {
      winnerSeat = seat;
      winnerCard = card;
    }
  }
  const partnerWinning = isPartner(visible.mySeat, winnerSeat);
  const lastToPlay = Object.keys(playing.currentTrick).length === 3;
  const options = visible.validCards.map((card) => {
    const trump = card.suit === contract.suit;
    const wins = compareCards(card, winnerCard, lead.suit, contract.suit) > 0;
    const higher = outstandingHigher(card, visible, played);
    let score = -card.rank * 0.8 - Number(trump) * 5;
    if (!partnerWinning && wins) {
      score += 24;
      // Account for remaining higher cards while still preferring an economical winning card.
      if (!lastToPlay) score -= higher * 0.35;
    }
    return { value: card, score };
  });
  return selectNearBest(options, random, 0.5);
}

export function getBridgeBotAction(visible: BridgeVisibleState, random: () => number): BotAction | null {
  if (visible.phase === 'redeal_pending' && visible.redealPendingSeat === visible.mySeat) {
    return { type: 'bridge-redeal', accept: false };
  }
  if (visible.phase === 'bidding' && visible.bidding?.currentBidderSeat === visible.mySeat) {
    return { type: 'bridge-bid', action: bid(visible, random) };
  }
  if (visible.phase === 'playing' && visible.playing?.currentTurnSeat === visible.mySeat) {
    const card = play(visible, random);
    return card ? { type: 'bridge-play', card } : null;
  }
  return null;
}
