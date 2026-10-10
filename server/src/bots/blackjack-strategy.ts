import type { BlackjackAction, BlackjackHand, BlackjackVisibleState, Card } from '@shared/types';
import {
  BJ_BET_STEP, BJ_MIN_BET, bjCardValue, bjLegalActions, bjMaxBet, bjSitsIn, bjTotal,
} from '@shared/rules/blackjack';
import type { BotAction } from './bot-decisions';

// Heuristic summary: plays follow the standard basic strategy for a dealer who stands on soft 17, peeks for
// blackjack, and allows doubling after a split; there is no surrender or insurance. The table is indexed by the
// dealer's up card (2–11, ace = 11). Bets stake a random 3–8% of the bot's chips in table steps.

const MIN_BET_SHARE = 0.03;
const MAX_BET_SHARE = 0.08;

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

export function blackjackBet(chips: number, random: () => number): number {
  const share = MIN_BET_SHARE + random() * (MAX_BET_SHARE - MIN_BET_SHARE);
  const stepped = Math.round((chips * share) / BJ_BET_STEP) * BJ_BET_STEP;
  return Math.max(BJ_MIN_BET, Math.min(bjMaxBet(chips), stepped));
}

export function getBlackjackBotAction(visible: BlackjackVisibleState, random: () => number): BotAction | null {
  const chips = visible.chips[visible.mySeat];
  if (visible.phase === 'betting') {
    return visible.myBet === null && bjSitsIn(chips) ? { type: 'blackjack-bet', amount: blackjackBet(chips, random) } : null;
  }
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat || !visible.dealer[0]) return null;
  const hands = visible.hands[visible.mySeat];
  const legal = bjLegalActions(hands, visible.activeHand, chips);
  if (legal.length === 0) return null;
  return { type: 'blackjack-action', action: blackjackBasicStrategy(hands[visible.activeHand], visible.dealer[0], legal) };
}
