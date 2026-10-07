import type { BigTwoVisibleState, Card } from '@shared/types';
import {
  BIGTWO_RANK_ORDER, BIGTWO_SUIT_ORDER, identifyCombo, isBomb, legalPlays,
} from '@shared/rules/bigtwo';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

const cardId = (card: Card): string => `${card.suit}:${card.rank}`;
const strength = (card: Card): number =>
  (BIGTWO_RANK_ORDER.indexOf(card.rank) * 4 + BIGTWO_SUIT_ORDER.indexOf(card.suit)) / 51;

/** A 13-card bitmask bounds the search; each subset is evaluated once per decision. */
function handPlan(hand: readonly Card[]): { maskOf: (cards: readonly Card[]) => number; groups: (mask: number) => number } {
  const indexes = new Map(hand.map((card, index) => [cardId(card), index]));
  const maskOf = (cards: readonly Card[]): number => cards.reduce((mask, card) => mask | (1 << indexes.get(cardId(card))!), 0);
  const combinations = legalPlays(hand, null, false).map((combo) => maskOf(combo.cards));
  const byCard = hand.map((_, index) => combinations.filter((mask) => mask & (1 << index)));
  const memo = new Map<number, number>([[0, 0]]);
  function groups(mask: number): number {
    const cached = memo.get(mask);
    if (cached !== undefined) return cached;
    const first = 31 - Math.clz32(mask & -mask);
    let best = hand.length;
    for (const combo of byCard[first]) {
      if ((mask & combo) !== combo) continue;
      best = Math.min(best, 1 + groups(mask ^ combo));
      if (best === 1) break;
    }
    memo.set(mask, best);
    return best;
  }
  return { maskOf, groups };
}

export function getBigTwoBotAction(visible: BigTwoVisibleState, random: () => number): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat
    || visible.lockedSeats.includes(visible.mySeat)) return null;
  const previous = visible.lastPlay ? identifyCombo(visible.lastPlay.cards) : null;
  const options = legalPlays(visible.myHand, previous, visible.firstPlay);
  const finish = options.find((option) => option.cards.length === visible.myHand.length);
  if (finish) return { type: 'bigtwo-play', cards: finish.cards };
  if (options.length === 0) return previous ? { type: 'bigtwo-pass' } : null;

  const plan = handPlan(visible.myHand);
  const full = (1 << visible.myHand.length) - 1;
  const urgent = Object.entries(visible.handCounts).some(([seat, count]) =>
    seat !== visible.mySeat && count === 1);
  const scored = options.map((combo) => {
    const remaining = full ^ plan.maskOf(combo.cards);
    const spent = combo.cards.reduce((sum, card) => sum + strength(card), 0);
    let score = -18 * plan.groups(remaining) + combo.cards.length * 0.8 - spent * 1.5;
    // Save control cards unless the table is close to ending; avoid feeding a last-card opponent.
    if (isBomb(combo) && !urgent) score -= 3;
    if (urgent && combo.type === 'single') score += 60 * strength(combo.cards[0]);
    if (urgent && combo.type !== 'single') score += 30;
    return { value: { type: 'bigtwo-play' as const, cards: combo.cards }, score };
  });
  return selectNearBest(scored, random, urgent ? 0.5 : 2);
}
