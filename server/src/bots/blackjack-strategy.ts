import type {
  BlackjackAction, BlackjackDealerAction, BlackjackHand, BlackjackVisibleState, Card, Seat,
} from '@shared/types';
import {
  BJ_BET_STEP, BJ_DEALER_STANDS, BJ_MIN_BET, bjCardValue, bjDealerActions, bjIsBust, bjIsNatural, bjLegalActions,
  bjMaxBet, bjSitsIn, bjTotal,
} from '@shared/rules/blackjack';
import { createDeck } from '../engine/deck';
import type { BotAction } from './bot-decisions';

// Heuristic summary: plays follow the standard basic strategy for a dealer who stands on soft 17, peeks for
// blackjack, and allows doubling after a split; there is no surrender or insurance. The table is indexed by the
// dealer's up card (2–11, ace = 11). Bets stake a random 3–8% of the bot's chips in table steps; in the last two
// hands the bot bets for the standings instead, since only the largest final stack wins. As a player
// dealer the bot must hit below 17; from 17 it compares the chips standing wins or loses against every live
// player hand with the expected result of drawing, estimated from the cards not yet seen this hand and
// assuming it keeps choosing the better option after each draw. Short-bank proportional payouts are ignored.

const MIN_BET_SHARE = 0.03;
const MAX_BET_SHARE = 0.08;
/** Hands before the match end, including the current one, in which bets follow the standings. */
const STANDINGS_HANDS = 2;
/** Two hands from the end, a lead shrinks the bet by `lead / LEAD_SCALE`, at most by `MAX_LEAD_CUT`. */
const LEAD_SCALE = 400;
const MAX_LEAD_CUT = 0.6;

function between(value: number, low: number, high: number): boolean {
  return value >= low && value <= high;
}

/** Split decision for a pair, by the rank value of either card. */
function shouldSplit(value: number, up: number): boolean {
  if (value === 11 || value === 8) return true;
  if (value === 9) return between(up, 2, 6) || between(up, 8, 9);
  if (value === 7 || value === 3 || value === 2) return between(up, 2, 7);
  if (value === 6) return between(up, 2, 6);
  if (value === 4) return between(up, 5, 6);
  return false;
}

/** Hit, stand, or double for a total; `double` falls back to hit unless the table says otherwise. */
function totalDecision(total: number, soft: boolean, up: number): 'hit' | 'stand' | 'double' | 'doubleOrStand' {
  if (soft) {
    if (total >= 19) return 'stand';
    if (total === 18) return between(up, 3, 6) ? 'doubleOrStand' : up <= 8 ? 'stand' : 'hit';
    if (total === 17) return between(up, 3, 6) ? 'double' : 'hit';
    if (total >= 15) return between(up, 4, 6) ? 'double' : 'hit';
    return between(up, 5, 6) ? 'double' : 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return up <= 6 ? 'stand' : 'hit';
  if (total === 12) return between(up, 4, 6) ? 'stand' : 'hit';
  if (total === 11) return up <= 10 ? 'double' : 'hit';
  if (total === 10) return up <= 9 ? 'double' : 'hit';
  if (total === 9) return between(up, 3, 6) ? 'double' : 'hit';
  return 'hit';
}

export function blackjackBasicStrategy(
  hand: Pick<BlackjackHand, 'cards'>, upCard: Card, legal: readonly BlackjackAction[],
): BlackjackAction {
  const up = bjCardValue(upCard);
  if (legal.includes('split') && shouldSplit(bjCardValue(hand.cards[0]), up)) return 'split';
  // A pair of fives plays as hard 10; an unsplittable pair of aces as soft 12.
  const { total, soft } = bjTotal(hand.cards);
  const decision = totalDecision(total, soft, up);
  if (decision === 'stand') return 'stand';
  if (decision === 'hit') return 'hit';
  if (legal.includes('double')) return 'double';
  return decision === 'doubleOrStand' ? 'stand' : 'hit';
}

export function blackjackBet(visible: BlackjackVisibleState, random: () => number): number {
  const chips = visible.chips[visible.mySeat];
  const share = MIN_BET_SHARE + random() * (MAX_BET_SHARE - MIN_BET_SHARE);
  let amount = chips * share;
  const handsLeft = visible.totalHands - visible.hand;
  const rivals = visible.seats.filter((seat) => seat !== visible.mySeat).map((seat) => visible.chips[seat]);
  if (handsLeft <= STANDINGS_HANDS && rivals.length > 0) {
    const deficit = Math.max(...rivals) - chips;
    // Trailing needs variance to catch up; leading protects the stack.
    if (deficit > 0) amount = handsLeft <= 1 ? bjMaxBet(chips) : Math.max(amount, deficit / handsLeft);
    else amount = handsLeft <= 1 ? BJ_MIN_BET : amount * (1 - Math.min(MAX_LEAD_CUT, -deficit / LEAD_SCALE));
  }
  const stepped = Math.round(amount / BJ_BET_STEP) * BJ_BET_STEP;
  return Math.max(BJ_MIN_BET, Math.min(bjMaxBet(chips), stepped));
}

/** Chips the dealer wins (positive) or pays against live hands when it finishes on `total`. */
function dealerResult(total: number, live: readonly { total: number; bet: number }[]): number {
  if (total > 21) return -live.reduce((sum, hand) => sum + hand.bet, 0);
  return live.reduce((sum, hand) => sum + Math.sign(total - hand.total) * hand.bet, 0);
}

/**
 * A player dealer's choice against the visible player hands. Busted hands and naturals are already
 * decided, so only the remaining hands weigh on hitting or standing.
 */
export function blackjackDealerDecision(
  dealer: readonly Card[], hands: Readonly<Record<Seat, readonly BlackjackHand[]>>,
): BlackjackDealerAction {
  const legal = bjDealerActions(dealer);
  if (!legal.includes('stand')) return 'hit';
  const all = Object.values(hands).flat();
  const live = all.filter((hand) => !bjIsBust(hand.cards) && !bjIsNatural(hand))
    .map((hand) => ({ total: bjTotal(hand.cards).total, bet: hand.bet }));
  const seen = new Set([...dealer, ...all.flatMap((hand) => hand.cards)].map((card) => `${card.suit}${card.rank}`));
  const unseen = createDeck().filter((card) => !seen.has(`${card.suit}${card.rank}`));
  // Hard points per draw (ace = 1) and how often each appears among the unseen cards.
  const draws = new Map<number, number>();
  for (const card of unseen) {
    const points = card.rank === 14 ? 1 : bjCardValue(card);
    draws.set(points, (draws.get(points) ?? 0) + 1 / unseen.length);
  }
  const memo = new Map<string, number>();
  const best = (hard: number, ace: boolean): { stand: number; hit: number } => {
    const total = ace && hard + 10 <= 21 ? hard + 10 : hard;
    const stand = dealerResult(total, live);
    if (total >= 21) return { stand, hit: stand };
    let hit = 0;
    for (const [points, chance] of draws) {
      const next = hard + points;
      const key = `${next}:${ace || points === 1}`;
      let value = memo.get(key);
      if (value === undefined) {
        const options = best(next, ace || points === 1);
        const nextTotal = (ace || points === 1) && next + 10 <= 21 ? next + 10 : next;
        value = nextTotal < BJ_DEALER_STANDS ? options.hit : Math.max(options.stand, options.hit);
        memo.set(key, value);
      }
      hit += chance * value;
    }
    return { stand, hit };
  };
  const hard = dealer.reduce((sum, card) => sum + (card.rank === 14 ? 1 : bjCardValue(card)), 0);
  const { stand, hit } = best(hard, dealer.some((card) => card.rank === 14));
  return hit > stand ? 'hit' : 'stand';
}

export function getBlackjackBotAction(visible: BlackjackVisibleState, random: () => number): BotAction | null {
  const chips = visible.chips[visible.mySeat];
  const dealing = visible.dealerSeat === visible.mySeat;
  if (visible.phase === 'betting') {
    return visible.myBet === null && !dealing && bjSitsIn(chips)
      ? { type: 'blackjack-bet', amount: blackjackBet(visible, random) } : null;
  }
  if (dealing) {
    return visible.phase === 'playing' && visible.currentTurnSeat === visible.mySeat && !visible.holeHidden
      ? { type: 'blackjack-dealer', action: blackjackDealerDecision(visible.dealer, visible.hands) } : null;
  }
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat || !visible.dealer[0]) return null;
  const hands = visible.hands[visible.mySeat];
  const legal = bjLegalActions(hands, visible.activeHand, chips);
  if (legal.length === 0) return null;
  return { type: 'blackjack-action', action: blackjackBasicStrategy(hands[visible.activeHand], visible.dealer[0], legal) };
}
