import type { BigTwoVisibleState, Card } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
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

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
/** Once an opponent holds this many cards or fewer, the bot stops saving 2s and bombs and stops passing by choice. */
const ENDGAME_CARDS = 5;

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
  const currentGroups = plan.groups(full);
  const opponents = SEAT_ORDER_CLOCKWISE.filter((seat) => seat !== visible.mySeat);
  const fewestOpponentCards = Math.min(...opponents.map((seat) => visible.handCounts[seat]));
  // Seats that passed stay locked until the round ends, so their last card cannot take this round.
  const urgent = opponents.some((seat) => visible.handCounts[seat] === 1 && !visible.lockedSeats.includes(seat));
  const endgame = fewestOpponentCards <= ENDGAME_CARDS;
  const distance = clamp01((fewestOpponentCards - 2) / 8);
  // Bombs and 2s win rounds later anyway, so spending them early trades lasting control for one group.
  // Near the end each 2 still in hand doubles the losing penalty instead, so conservation fades out.
  const conserve = endgame ? 0
    : Math.min(clamp01((fewestOpponentCards - ENDGAME_CARDS) / 5), clamp01((currentGroups - 1) / 4));
  let ordinaryAvailable = false;
  const candidates: { value: BotAction; score: number }[] = options.map((combo) => {
    const remainingGroups = plan.groups(full ^ plan.maskOf(combo.cards));
    const spent = combo.cards.reduce((sum, card) => sum + strength(card), 0);
    const twos = combo.cards.filter((card) => card.rank === 2).length;
    // An ordinary play spends no bomb or 2 and leaves the rest of the hand in a minimal plan.
    if (!isBomb(combo) && twos === 0 && remainingGroups < currentGroups) ordinaryAvailable = true;
    let score = -18 * remainingGroups + combo.cards.length * 0.8 - spent * 1.5 - 25 * conserve * twos;
    // Save control cards unless the table is close to ending; avoid feeding a last-card opponent.
    if (isBomb(combo) && !urgent) score -= 3 + 30 * conserve;
    if (urgent && combo.type === 'single') score += 60 * strength(combo.cards[0]);
    if (urgent && combo.type !== 'single') score += 30;
    return { value: { type: 'bigtwo-play', cards: combo.cards }, score };
  });
  // Passing is a choice only when every play spends a bomb or 2 or splits a planned combination.
  // It keeps the plan intact but gives up tempo, which grows costly as opponents near the end;
  // in the endgame holding cards costs more than any split, so the bot always plays.
  if (previous && !endgame && !ordinaryAvailable) {
    candidates.push({ value: { type: 'bigtwo-pass' }, score: -18 * currentGroups - 3 - 40 * (1 - distance) });
  }
  return selectNearBest(candidates, random, urgent ? 0.5 : 2);
}
