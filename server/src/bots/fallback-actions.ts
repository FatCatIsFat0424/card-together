// Deliberately simple legal moves for automated turns: after a strategy keeps failing, and for
// players whose time runs out.

import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { legalPlays } from '@shared/rules/bigtwo';
import { NN_MAX, nnApply, nnIsPlayable, nnRequiresChoice } from '@shared/rules/ninetynine';
import type { NnChoice } from '@shared/rules/ninetynine';
import { rpPairOptions } from '@shared/rules/redpoints';
import { cpGreedyArrangement } from '@shared/rules/chinesepoker-arrange';
import { ldMustChallenge } from '@shared/rules/liarsdeck';
import { BJ_MIN_BET, bjDealerHits, bjSitsIn } from '@shared/rules/blackjack';
import { heLegalActions } from '@shared/rules/holdem';
import { createNapoleonDeck, hasNapoleonCard, isNapoleonFreeCard, napoleonDealSize } from '@shared/rules/napoleon';
import type {
  BigTwoVisibleState, BlackjackVisibleState, BridgeVisibleState, ChinesePokerVisibleState, HoldemVisibleState,
  LiarsDeckVisibleState, NapoleonVisibleState, NinetyNineVisibleState, RedPointsVisibleState, SevensVisibleState,
  StudVisibleState,
} from '@shared/types';
import type { BotAction } from './bot-decisions';

export function bridgeFirstLegalAction(visible: BridgeVisibleState): BotAction | null {
  if (visible.phase === 'redeal_pending') return { type: 'bridge-redeal', accept: false };
  if (visible.phase === 'bidding') return { type: 'bridge-bid', action: { type: 'pass' } };
  return visible.validCards[0] ? { type: 'bridge-play', card: visible.validCards[0] } : null;
}

export function bigTwoFirstLegalAction(visible: BigTwoVisibleState): BotAction | null {
  if (visible.lastPlay) return { type: 'bigtwo-pass' };
  const lead = legalPlays(visible.myHand, null, visible.firstPlay)[0];
  return lead ? { type: 'bigtwo-play', cards: lead.cards } : null;
}

export function redPointsFirstLegalAction(visible: RedPointsVisibleState): BotAction | null {
  if (visible.step === 'flip-choose') {
    const capture = visible.pendingFlip && rpPairOptions(visible.pendingFlip, visible.table)[0];
    return capture ? { type: 'redpoints-flip', capture } : null;
  }
  const card = visible.myHand[0];
  if (!card) return null;
  const capture = rpPairOptions(card, visible.table)[0];
  return { type: 'redpoints-play', card, ...(capture ? { capture } : {}) };
}

export function ninetyNineFirstLegalAction(visible: NinetyNineVisibleState): BotAction | null {
  const card = visible.myHand.find((own) => nnIsPlayable(visible.total, own));
  if (!card) return null;
  const choice = nnRequiresChoice(card)
    ? (['minus', 'plus'] as const).find((option: NnChoice) => nnApply(visible.total, card, option).total <= NN_MAX)
    : undefined;
  const effect = nnApply(visible.total, card, choice);
  const target = effect.designate
    ? (visible.seats ?? SEAT_ORDER_CLOCKWISE).find((seat) => seat !== visible.mySeat && !visible.eliminated.includes(seat))
    : undefined;
  return { type: 'ninetynine-play', card, ...(choice ? { choice } : {}), ...(target ? { target } : {}) };
}

export function sevensFirstLegalAction(visible: SevensVisibleState): BotAction | null {
  if (visible.validCards[0]) return { type: 'sevens-play', card: visible.validCards[0] };
  return visible.myHand[0] ? { type: 'sevens-cover', card: visible.myHand[0] } : null;
}

export function chinesePokerFirstLegalAction(visible: ChinesePokerVisibleState): BotAction | null {
  return visible.myArrangement || visible.submitted[visible.mySeat] ? null
    : { type: 'chinesepoker-arrange', arrangement: cpGreedyArrangement(visible.myHand) };
}

export function liarsDeckFirstLegalAction(visible: LiarsDeckVisibleState): BotAction | null {
  if (ldMustChallenge(visible.mySeat, visible.handCounts, visible.lastPlay)) return { type: 'liarsdeck-challenge' };
  return visible.myHand[0] ? { type: 'liarsdeck-play', cardIds: [visible.myHand[0].id] } : null;
}

/** A player dealer who runs out of time follows the house rule: hit below 17, otherwise stand. */
export function blackjackDealerDefault(visible: BlackjackVisibleState): BotAction | null {
  if (visible.phase !== 'playing' || visible.dealerSeat !== visible.mySeat || visible.currentTurnSeat !== visible.mySeat
    || visible.holeHidden) return null;
  return { type: 'blackjack-dealer', action: bjDealerHits(visible.dealer) ? 'hit' : 'stand' };
}

export function blackjackFirstLegalAction(visible: BlackjackVisibleState): BotAction | null {
  if (visible.phase === 'betting') {
    return visible.myBet === null && visible.dealerSeat !== visible.mySeat && bjSitsIn(visible.chips[visible.mySeat])
      ? { type: 'blackjack-bet', amount: BJ_MIN_BET } : null;
  }
  if (visible.dealerSeat === visible.mySeat) return blackjackDealerDefault(visible);
  return visible.currentTurnSeat === visible.mySeat ? { type: 'blackjack-action', action: 'stand' } : null;
}

/** Check when free, otherwise fold: the conventional poker default for a player who does not act. */
export function holdemPassiveAction(visible: HoldemVisibleState): BotAction | null {
  if (visible.currentTurnSeat !== visible.mySeat) return null;
  const legal = heLegalActions(visible, visible.mySeat);
  if (!legal) return null;
  return { type: 'holdem-action', action: legal.check ? { type: 'check' } : { type: 'fold' } };
}

/** Check when free, otherwise fold, as in Hold'em. */
export function studPassiveAction(visible: StudVisibleState): BotAction | null {
  if (visible.currentTurnSeat !== visible.mySeat) return null;
  const legal = heLegalActions(visible, visible.mySeat);
  if (!legal) return null;
  return { type: 'game-action', request: { gameType: 'stud', action: legal.check ? { type: 'check' } : { type: 'fold' } } };
}

/** Pass, discard the last cards, acknowledge, call the first card outside the hand, or play the first legal card. */
export function napoleonFirstLegalAction(visible: NapoleonVisibleState): BotAction | null {
  const seat = visible.mySeat;
  const napoleon = visible.contract?.napoleon;
  switch (visible.phase) {
    case 'bidding':
      return visible.bidding?.currentBidderSeat === seat ? { type: 'napoleon-action', action: { type: 'bid', action: { type: 'pass' } } } : null;
    case 'exchanging':
      return napoleon === seat ? { type: 'napoleon-action',
        action: { type: 'discard', cards: visible.myHand.slice(-napoleonDealSize(visible.seats.length).kitty) } } : null;
    case 'reviewing':
      return napoleon !== seat && !visible.reviewed.includes(seat) ? { type: 'napoleon-action', action: { type: 'review' } } : null;
    case 'calling': {
      const card = createNapoleonDeck().find((candidate) => !hasNapoleonCard(visible.myHand, candidate));
      return napoleon === seat && card ? { type: 'napoleon-action', action: { type: 'call', card } } : null;
    }
    case 'playing': {
      const card = visible.currentTurnSeat === seat ? visible.validCards[0] : undefined;
      if (!card) return null;
      const leading = (visible.trick?.plays.length ?? 0) === 0;
      return { type: 'napoleon-action',
        action: leading && isNapoleonFreeCard(visible, card) ? { type: 'play', card, leadSuit: 'spades' } : { type: 'play', card } };
    }
    default: return null;
  }
}
