import type { BigTwoVisibleState, Card } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { identifyCombo, isBomb, legalPlays } from '@shared/rules/bigtwo';
import type { BigTwoCombo } from '@shared/rules/bigtwo';
import type { BotAction } from './bot-decisions';
import { cardIndex, fastCombo, PAIR, readKnowledge, seatIndex, unseenBeatChecker } from './bigtwo-model';
import type { FastCombo } from './bigtwo-model';
import { selectNearBest } from './selection';

const cardId = (card: Card): string => `${card.suit}:${card.rank}`;
const strength = (card: Card): number => cardIndex(card) / 51;

/** Share of a group's cost saved when nothing unseen can beat it: it wins its round and leads again. */
const CONTROL_DISCOUNT = 0.55;
/** Bonus for answering with a play nobody can beat: the bot keeps the lead for its next group. */
const TEMPO_BONUS = 7;
/** Bonus for a play nobody can beat that leaves at most one beatable group: the rest can then go out in order. */
const SURE_WIN_BONUS = 50;
/** Once an opponent holds this many cards or fewer, the bot stops saving 2s and bombs and stops passing by choice. */
const ENDGAME_CARDS = 5;

/**
 * Plans for any sub-hand. `cost`: each group of the best plan costs 1, less `CONTROL_DISCOUNT` when no unseen
 * holding can beat it. `losers`: the fewest groups that can be beaten. A 13-card bitmask bounds the search;
 * each subset is evaluated once per decision.
 */
function handPlan(hand: readonly Card[], unbeatable: (combo: FastCombo) => boolean): {
  maskOf: (cards: readonly Card[]) => number; cost: (mask: number) => number; losers: (mask: number) => number;
} {
  const indexes = new Map(hand.map((card, index) => [cardId(card), index]));
  const maskOf = (cards: readonly Card[]): number => cards.reduce((mask, card) => mask | (1 << indexes.get(cardId(card))!), 0);
  const combinations = legalPlays(hand, null, false).map((combo) => ({ mask: maskOf(combo.cards), winner: unbeatable(fastCombo(combo)) }));
  const byCard = hand.map((_, index) => combinations.filter((entry) => entry.mask & (1 << index)));
  function minimize(weight: (winner: boolean) => number): (mask: number) => number {
    const memo = new Map<number, number>([[0, 0]]);
    const best = (mask: number): number => {
      const cached = memo.get(mask);
      if (cached !== undefined) return cached;
      const first = 31 - Math.clz32(mask & -mask);
      let value = Infinity;
      for (const entry of byCard[first]) {
        if ((mask & entry.mask) === entry.mask) value = Math.min(value, weight(entry.winner) + best(mask ^ entry.mask));
      }
      memo.set(mask, value);
      return value;
    };
    return best;
  }
  return {
    maskOf,
    cost: minimize((winner) => (winner ? 1 - CONTROL_DISCOUNT : 1)),
    losers: minimize((winner) => (winner ? 0 : 1)),
  };
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** A scored decision; `combo` is null for a pass. */
export interface BigTwoOption {
  readonly value: BotAction;
  readonly score: number;
  readonly combo: BigTwoCombo | null;
}

/**
 * Every legal decision with the heuristic's score, larger is better. Reads the log for card counting (plays
 * nobody can beat keep the lead) and pass inference (a seat that declined a single likely holds no higher one).
 */
export function scoreBigTwoOptions(visible: BigTwoVisibleState): BigTwoOption[] {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat
    || visible.lockedSeats.includes(visible.mySeat)) return [];
  const previous = visible.lastPlay ? identifyCombo(visible.lastPlay.cards) : null;
  const options = legalPlays(visible.myHand, previous, visible.firstPlay);
  const finish = options.find((option) => option.cards.length === visible.myHand.length);
  if (finish) return [{ value: { type: 'bigtwo-play', cards: finish.cards }, score: 1000, combo: finish }];
  if (options.length === 0) return previous ? [{ value: { type: 'bigtwo-pass' }, score: 0, combo: null }] : [];

  const knowledge = readKnowledge(visible);
  const opponents = SEAT_ORDER_CLOCKWISE.filter((seat) => seat !== visible.mySeat);
  // Seats that passed stay locked until the round ends, so they cannot answer this play.
  const active = opponents.filter((seat) => !visible.lockedSeats.includes(seat));
  const mostCards = Math.max(...opponents.map((seat) => visible.handCounts[seat]));
  const futureBeat = unseenBeatChecker(knowledge.unseen, mostCards);
  const nowBeat = unseenBeatChecker(knowledge.unseen, Math.max(0, ...active.map((seat) => visible.handCounts[seat])));
  const plan = handPlan(visible.myHand, (combo) => !futureBeat(combo));
  const full = (1 << visible.myHand.length) - 1;
  const currentCost = plan.cost(full);
  const fewestOpponentCards = Math.min(...opponents.map((seat) => visible.handCounts[seat]));
  const lastCard = active.filter((seat) => visible.handCounts[seat] === 1);
  const urgent = lastCard.length > 0;
  // Pass inference: a one-card seat that declined a single at least this high cannot beat a single above it.
  const lastCardCeiling = Math.max(-1, ...lastCard.map((seat) => knowledge.singleCeiling[seatIndex(seat)]));
  const twoCards = active.some((seat) => visible.handCounts[seat] === 2);
  const endgame = fewestOpponentCards <= ENDGAME_CARDS;
  const distance = clamp01((fewestOpponentCards - 2) / 8);
  // Bombs and 2s win rounds later anyway, so spending them early trades lasting control for one group.
  // Near the end each 2 still in hand doubles the losing penalty instead, so conservation fades out.
  const conserve = endgame ? 0 : Math.min(clamp01((fewestOpponentCards - ENDGAME_CARDS) / 5), clamp01((currentCost - 1) / 4));
  let ordinaryAvailable = false;
  const candidates: BigTwoOption[] = options.map((combo) => {
    const fast = fastCombo(combo);
    const remaining = full ^ plan.maskOf(combo.cards);
    const remainingCost = plan.cost(remaining);
    const spent = combo.cards.reduce((sum, card) => sum + strength(card), 0);
    const twos = combo.cards.filter((card) => card.rank === 2).length;
    const keepsLead = !nowBeat(fast);
    // An ordinary play spends no bomb or 2 and does not split a planned combination.
    if (!isBomb(combo) && twos === 0 && remainingCost < currentCost) ordinaryAvailable = true;
    let score = -18 * remainingCost + combo.cards.length * 0.8 - spent * 1.5 - 25 * conserve * twos;
    if (previous && keepsLead) score += TEMPO_BONUS;
    if (keepsLead && plan.losers(remaining) <= 1) score += SURE_WIN_BONUS;
    if (isBomb(combo) && !urgent) score -= 3 + 30 * conserve;
    if (urgent) {
      const single = combo.type === 'single';
      const safe = single && (keepsLead || fast.key > lastCardCeiling);
      if (!single) score += previous ? 30 : 70;
      else if (safe) score += 65;
      else score += 60 * strength(combo.cards[0]);
    } else if (twoCards && fast.type === PAIR && !keepsLead) score -= 8;
    return { value: { type: 'bigtwo-play', cards: combo.cards }, score, combo };
  });
  // Passing is a choice only when every play spends a bomb or 2 or splits a planned combination.
  // It keeps the plan intact but gives up tempo, which grows costly as opponents near the end;
  // in the endgame holding cards costs more than any split, so the bot always plays.
  if (previous && !endgame && !ordinaryAvailable) {
    candidates.push({ value: { type: 'bigtwo-pass' }, score: -18 * currentCost - 3 - 40 * (1 - distance), combo: null });
  }
  return candidates;
}

export function getBigTwoBotAction(visible: BigTwoVisibleState, random: () => number): BotAction | null {
  const options = scoreBigTwoOptions(visible);
  if (options.length === 0) return null;
  if (options.length === 1) return options[0].value;
  const urgent = SEAT_ORDER_CLOCKWISE.some((seat) => seat !== visible.mySeat && visible.handCounts[seat] === 1
    && !visible.lockedSeats.includes(seat));
  // A rank step is worth about 0.12 points, so only adjacent-rank alternatives stay in the random pool.
  return selectNearBest(options, random, urgent ? 0.5 : 0.2);
}
