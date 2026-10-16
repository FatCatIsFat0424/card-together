import type { BotDifficulty, NapoleonAction, NapoleonCard, NapoleonVisibleState } from '@shared/types';
import {
  hasNapoleonCard, isNapoleonJoker, napoleonBidError, napoleonDealSize, napoleonDiscardError,
} from '@shared/rules/napoleon';
import { callOrder, chooseCall, chooseEasyBid, chooseHardBid, chooseHardDiscards } from './napoleon-hand';
import { chooseEasyPlay, chooseHardPlay } from './napoleon-play';

/** The Napoleon's hand plus the table cards it picked up, whether or not the view already merges them. */
function exchangeCards(visible: NapoleonVisibleState): NapoleonCard[] {
  const cards = [...visible.myHand];
  for (const card of visible.pickedUp ?? []) if (!hasNapoleonCard(cards, card)) cards.push(card);
  return cards;
}

function randomDiscards(cards: readonly NapoleonCard[], count: number, random: () => number): NapoleonCard[] {
  // Even Easy keeps its jokers when it has enough other cards to discard.
  const pool = cards.filter((card) => !isNapoleonJoker(card));
  const source = pool.length >= count ? pool : [...cards];
  const chosen: NapoleonCard[] = [];
  while (chosen.length < count && source.length > 0) {
    const index = Math.min(source.length - 1, Math.floor(random() * source.length));
    chosen.push(...source.splice(index, 1));
  }
  return chosen;
}

function discardAction(visible: NapoleonVisibleState, random: () => number, difficulty: BotDifficulty): NapoleonAction | null {
  const contract = visible.contract;
  if (!contract) return null;
  const cards = exchangeCards(visible);
  const { kitty } = napoleonDealSize(visible.seats.length);
  const chosen = difficulty === 'easy' ? randomDiscards(cards, kitty, random) : chooseHardDiscards(cards, kitty, contract.suit);
  return { type: 'discard', cards: napoleonDiscardError(cards, chosen, kitty) === null ? chosen : cards.slice(-kitty) };
}

function callAction(visible: NapoleonVisibleState, difficulty: BotDifficulty): NapoleonAction | null {
  const contract = visible.contract;
  if (!contract) return null;
  if (difficulty === 'easy') {
    const order = callOrder(contract.suit);
    return { type: 'call', card: order.find((card) => !hasNapoleonCard(visible.myHand, card)) ?? order[0] };
  }
  return { type: 'call', card: chooseCall(contract.suit, visible.myHand, visible.discards ?? []) };
}

/**
 * Decides from the seat's filtered view only, never observer hands; null when the seat has nothing
 * to do. Hard estimates contracts and plays by public inference; Easy bids rarely and plays at random.
 */
export function getNapoleonBotAction(
  visible: NapoleonVisibleState, random: () => number, difficulty: BotDifficulty,
): NapoleonAction | null {
  const seat = visible.mySeat;
  switch (visible.phase) {
    case 'bidding': {
      const bidding = visible.bidding;
      if (!bidding || bidding.currentBidderSeat !== seat) return null;
      const action = difficulty === 'easy'
        ? chooseEasyBid(bidding, visible.myHand, visible.seats.length)
        : chooseHardBid(bidding, seat, visible.myHand, visible.seats.length);
      return { type: 'bid', action: napoleonBidError(bidding, seat, action) === null ? action : { type: 'pass' } };
    }
    case 'exchanging':
      return visible.contract?.napoleon === seat ? discardAction(visible, random, difficulty) : null;
    case 'reviewing':
      return visible.contract?.napoleon !== seat && !visible.reviewed.includes(seat) ? { type: 'review' } : null;
    case 'calling':
      return visible.contract?.napoleon === seat ? callAction(visible, difficulty) : null;
    case 'playing': {
      if (visible.currentTurnSeat !== seat) return null;
      const choice = difficulty === 'easy' ? chooseEasyPlay(visible, random) : chooseHardPlay(visible, random);
      return choice ? { type: 'play', ...choice } : null;
    }
    default:
      return null;
  }
}
