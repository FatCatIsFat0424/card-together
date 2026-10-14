import type {
  BlackjackVisibleState, BridgeVisibleState, Card, LiarsDeckVisibleState, NinetyNineVisibleState,
  PlayerVisibleGameState,
} from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { identifyCombo, legalPlays } from '@shared/rules/bigtwo';
import { BJ_DEALER_STANDS, BJ_MIN_BET, bjDealerActions, bjLegalActions, bjSitsIn, bjTotal } from '@shared/rules/blackjack';
import { cpGreedyArrangement } from '@shared/rules/chinesepoker-arrange';
import { heLegalActions } from '@shared/rules/holdem';
import { LD_MAX_PLAY, ldCanChallenge, ldMustChallenge } from '@shared/rules/liarsdeck';
import { NN_MAX, nnApply, nnRequiresChoice } from '@shared/rules/ninetynine';
import type { NnChoice } from '@shared/rules/ninetynine';
import { rpPairOptions } from '@shared/rules/redpoints';
import type { BotAction } from './bot-decisions';

function pick<T>(options: readonly T[], random: () => number): T | null {
  return options.length === 0 ? null : options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

function bridgeAction(visible: BridgeVisibleState, random: () => number): BotAction | null {
  if (visible.phase === 'redeal_pending' && visible.redealPendingSeat === visible.mySeat) {
    return { type: 'bridge-redeal', accept: false };
  }
  if (visible.phase === 'bidding' && visible.bidding?.currentBidderSeat === visible.mySeat) {
    const bidding = visible.bidding;
    const points = visible.myHand.reduce((sum, card) => sum + Math.max(0, card.rank - 10), 0);
    if (bidding.highestBid || (points < 12 && bidding.consecutivePassCount < 3)) {
      return { type: 'bridge-bid', action: { type: 'pass' } };
    }
    const suits: readonly Card['suit'][] = ['clubs', 'diamonds', 'hearts', 'spades'];
    const longest = suits.reduce((best, suit) => visible.myHand.filter((card) => card.suit === suit).length
      > visible.myHand.filter((card) => card.suit === best).length ? suit : best, suits[0]);
    // The fourth opener prevents an all-easy table from repeatedly passing and redealing.
    return { type: 'bridge-bid', action: { type: 'bid', level: 1, suit: longest } };
  }
  if (visible.phase !== 'playing' || visible.playing?.currentTurnSeat !== visible.mySeat) return null;
  const card = pick(visible.validCards, random);
  return card ? { type: 'bridge-play', card } : null;
}

function ninetyNineAction(visible: NinetyNineVisibleState, random: () => number): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat
    || visible.eliminated.includes(visible.mySeat)) return null;
  const opponents = (visible.seats ?? SEAT_ORDER_CLOCKWISE)
    .filter((seat) => seat !== visible.mySeat && !visible.eliminated.includes(seat));
  const options: BotAction[] = [];
  for (const card of visible.myHand) {
    const choices: readonly (NnChoice | undefined)[] = nnRequiresChoice(card) ? ['plus', 'minus'] : [undefined];
    for (const choice of choices) {
      const effect = nnApply(visible.total, card, choice);
      if (effect.total > NN_MAX) continue;
      if (effect.designate) {
        for (const target of opponents) {
          options.push({ type: 'ninetynine-play', card, ...(choice ? { choice } : {}), target });
        }
      } else {
        options.push({ type: 'ninetynine-play', card, ...(choice ? { choice } : {}) });
      }
    }
  }
  return pick(options, random);
}

function liarsDeckAction(visible: LiarsDeckVisibleState, random: () => number): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat
    || visible.eliminated.includes(visible.mySeat)) return null;
  if (ldMustChallenge(visible.mySeat, visible.handCounts, visible.lastPlay)
    || (ldCanChallenge(visible.mySeat, visible.lastPlay) && random() < 0.2)) {
    return { type: 'liarsdeck-challenge' };
  }
  if (visible.myHand.length === 0) return null;
  const count = 1 + Math.floor(random() * Math.min(LD_MAX_PLAY, visible.myHand.length));
  const remaining = [...visible.myHand];
  const cardIds: number[] = [];
  while (cardIds.length < count) {
    const card = pick(remaining, random)!;
    cardIds.push(card.id);
    remaining.splice(remaining.indexOf(card), 1);
  }
  return { type: 'liarsdeck-play', cardIds };
}

function blackjackAction(visible: BlackjackVisibleState): BotAction | null {
  const dealing = visible.dealerSeat === visible.mySeat;
  if (visible.phase === 'betting') {
    return !dealing && visible.myBet === null && bjSitsIn(visible.chips[visible.mySeat])
      ? { type: 'blackjack-bet', amount: BJ_MIN_BET } : null;
  }
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  if (dealing) {
    if (visible.holeHidden) return null;
    const legal = bjDealerActions(visible.dealer);
    return legal.length > 0 ? { type: 'blackjack-dealer', action: legal.includes('stand') ? 'stand' : 'hit' } : null;
  }
  const hands = visible.hands[visible.mySeat];
  const legal = bjLegalActions(hands, visible.activeHand, visible.chips[visible.mySeat]);
  if (legal.length === 0) return null;
  const action = bjTotal(hands[visible.activeHand].cards).total < BJ_DEALER_STANDS ? 'hit' : 'stand';
  return { type: 'blackjack-action', action };
}

/** Basic decisions use only the current legal choices, without opponent inference or lookahead. */
export function getEasyBotAction(
  visible: PlayerVisibleGameState, random: () => number = Math.random,
): BotAction | null {
  if (visible.phase === 'scoring') return null;
  switch (visible.gameType) {
    case 'bridge': return bridgeAction(visible, random);
    case 'bigtwo': {
      if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat
        || visible.lockedSeats.includes(visible.mySeat)) return null;
      const previous = visible.lastPlay ? identifyCombo(visible.lastPlay.cards) : null;
      const play = pick(legalPlays(visible.myHand, previous, visible.firstPlay), random);
      return play ? { type: 'bigtwo-play', cards: play.cards } : previous ? { type: 'bigtwo-pass' } : null;
    }
    case 'redpoints': {
      if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
      if (visible.step === 'flip-choose') {
        const capture = visible.pendingFlip ? pick(rpPairOptions(visible.pendingFlip, visible.table), random) : null;
        return capture ? { type: 'redpoints-flip', capture } : null;
      }
      const card = pick(visible.myHand, random);
      if (!card) return null;
      const capture = pick(rpPairOptions(card, visible.table), random);
      return { type: 'redpoints-play', card, ...(capture ? { capture } : {}) };
    }
    case 'ninetynine': return ninetyNineAction(visible, random);
    case 'sevens': {
      if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
      const card = pick(visible.validCards.length > 0 ? visible.validCards : visible.myHand, random);
      return card ? { type: visible.validCards.length > 0 ? 'sevens-play' : 'sevens-cover', card } : null;
    }
    case 'chinesepoker': {
      if (visible.phase !== 'arranging' || visible.submitted[visible.mySeat] || visible.myArrangement) return null;
      return { type: 'chinesepoker-arrange', arrangement: cpGreedyArrangement(visible.myHand) };
    }
    case 'liarsdeck': return liarsDeckAction(visible, random);
    case 'blackjack': return blackjackAction(visible);
    case 'holdem': {
      if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
      const legal = heLegalActions(visible, visible.mySeat);
      if (!legal) return null;
      if (legal.check) return { type: 'holdem-action', action: { type: 'check' } };
      const choice = random();
      if (legal.raise && choice < 0.1) return { type: 'holdem-action', action: { type: 'raise', to: legal.raise.min } };
      return { type: 'holdem-action', action: { type: legal.call > 0 && choice < 0.8 ? 'call' : 'fold' } };
    }
  }
}
