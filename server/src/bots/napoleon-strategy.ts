import type { NapoleonAction, NapoleonCard, NapoleonVisibleState } from '@shared/types';
import { hasNapoleonCard, napoleonBidError, napoleonDealSize, napoleonDiscardError } from '@shared/rules/napoleon';
import { chooseCall, chooseHardBid, chooseHardDiscards } from './napoleon-hand';
import { chooseHardPlay } from './napoleon-play';

/** The Napoleon's hand plus the table cards it picked up, whether or not the view already merges them. */
function exchangeCards(visible: NapoleonVisibleState): NapoleonCard[] {
  const cards = [...visible.myHand];
  for (const card of visible.pickedUp ?? []) if (!hasNapoleonCard(cards, card)) cards.push(card);
  return cards;
}

function discardAction(visible: NapoleonVisibleState): NapoleonAction | null {
  const contract = visible.contract;
  if (!contract) return null;
  const cards = exchangeCards(visible);
  const { kitty } = napoleonDealSize(visible.seats.length);
  const chosen = chooseHardDiscards(cards, kitty, contract.suit);
  return { type: 'discard', cards: napoleonDiscardError(cards, chosen, kitty) === null ? chosen : cards.slice(-kitty) };
}

function callAction(visible: NapoleonVisibleState): NapoleonAction | null {
  const contract = visible.contract;
  if (!contract) return null;
  return { type: 'call', card: chooseCall(contract.suit, visible.myHand, visible.discards ?? []) };
}

/**
 * Decides from the seat's filtered view only, never observer hands; null when the seat has nothing
 * to do. It estimates contracts and plays by public inference.
 */
export function getNapoleonBotAction(visible: NapoleonVisibleState, random: () => number): NapoleonAction | null {
  const seat = visible.mySeat;
  switch (visible.phase) {
    case 'bidding': {
      const bidding = visible.bidding;
      if (!bidding || bidding.currentBidderSeat !== seat) return null;
      const action = chooseHardBid(bidding, seat, visible.myHand, visible.seats.length);
      return { type: 'bid', action: napoleonBidError(bidding, seat, action) === null ? action : { type: 'pass' } };
    }
    case 'exchanging':
      return visible.contract?.napoleon === seat ? discardAction(visible) : null;
    case 'reviewing':
      return visible.contract?.napoleon !== seat && !visible.reviewed.includes(seat) ? { type: 'review' } : null;
    case 'calling':
      return visible.contract?.napoleon === seat ? callAction(visible) : null;
    case 'playing': {
      if (visible.currentTurnSeat !== seat) return null;
      const choice = chooseHardPlay(visible, random);
      return choice ? { type: 'play', ...choice } : null;
    }
    default:
      return null;
  }
}
