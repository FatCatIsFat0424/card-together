import type { BridgeVisibleState, Card, Seat } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { getNaturalBridgeBid } from './bridge-bidding';
import { compareCards } from '../engine/playing';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

function isPartner(a: Seat, b: Seat): boolean {
  return (SEAT_ORDER_CLOCKWISE.indexOf(a) + 2) % 4 === SEAT_ORDER_CLOCKWISE.indexOf(b);
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
    return { type: 'bridge-bid', action: getNaturalBridgeBid(visible) };
  }
  if (visible.phase === 'playing' && visible.playing?.currentTurnSeat === visible.mySeat) {
    const card = play(visible, random);
    return card ? { type: 'bridge-play', card } : null;
  }
  return null;
}
