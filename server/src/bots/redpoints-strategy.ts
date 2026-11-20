import type { RedPointsVisibleState } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import type { BotAction } from './bot-decisions';
import { nextSeatIndex, pairs, POINTS, readKnowledge, rpCard, rpIndex, seatIndex } from './redpoints-model';
import type { RedPointsKnowledge } from './redpoints-model';
import { selectNearBest } from './selection';

/** Share of a capture the bot can make on its next turn that counts now; other seats act first. */
const NEXT_TURN = 0.7;
/** Weight of an opponent's gain far behind the leaders, rising to 1 for the leader. */
const TRAILING_WEIGHT = 0.6;
/** Points behind the leader over which an opponent's weight decays. */
const STANDING_SCALE = 40;

/** A decision in the compact model: `card` is -1 when resolving the pending flip; `target` is -1 for no capture. */
export interface RedPointsMove {
  readonly card: number;
  readonly target: number;
}

export interface RedPointsOption {
  readonly value: BotAction;
  readonly score: number;
  readonly move: RedPointsMove;
}

/** Probability that `drawn` cards from `pool` include none of `matches` (hypergeometric). */
function noneDrawn(pool: number, matches: number, drawn: number): number {
  if (matches === 0 || drawn <= 0) return 1;
  if (pool - matches < drawn) return 0;
  let chance = 1;
  for (let index = 0; index < drawn; index++) chance *= (pool - matches - index) / (pool - index);
  return chance;
}

interface Outlook {
  /** Opponents after the seat in turn order, with their hand sizes and standing weights. */
  readonly opponents: readonly { readonly cards: number; readonly weight: number }[];
}

/**
 * What a table is worth to the seat once its own turn is over: opponents in turn order capture what their
 * hands or flips can pair (counted exactly over the unseen cards, one hand capture per turn, most valuable
 * first, weighted by their standing), then the seat may take the best surviving card with its remaining hand.
 */
function tableOutlook(
  table: readonly number[], unseen: readonly number[], stockLeft: number, hand: readonly number[], outlook: Outlook,
): number {
  const pool = unseen.length;
  if (table.length === 0) return 0;
  const alive = table.map(() => 1);
  const value: number[] = [];
  const matches: number[] = [];
  for (const target of table) {
    let count = 0;
    let points = 0;
    for (const card of unseen) {
      if (!pairs(card, target)) continue;
      count++;
      points += POINTS[card];
    }
    matches.push(count);
    value.push(POINTS[target] + (count > 0 ? points / count : 0));
  }
  const order = table.map((_, index) => index).sort((a, b) => value[b] - value[a]);
  let loss = 0;
  let flips = stockLeft;
  for (const opponent of outlook.opponents) {
    if (opponent.cards === 0 || pool === 0) continue;
    let gain = 0;
    let open = 1;
    for (const index of order) {
      const holds = 1 - noneDrawn(pool, matches[index], opponent.cards);
      const taken = alive[index] * holds * open;
      gain += value[index] * taken;
      open *= 1 - alive[index] * holds;
      alive[index] -= taken;
    }
    if (flips > 0) {
      flips--;
      for (const index of order) {
        const taken = alive[index] * matches[index] / pool;
        gain += value[index] * taken;
        alive[index] -= taken;
      }
    }
    loss += gain * opponent.weight;
  }
  let next = 0;
  for (const card of hand) {
    table.forEach((target, index) => {
      if (pairs(card, target)) next = Math.max(next, alive[index] * (POINTS[card] + POINTS[target]));
    });
  }
  return NEXT_TURN * next - loss;
}

function evaluate(
  move: RedPointsMove, flipped: number, knowledge: RedPointsKnowledge, stockCount: number, outlook: Outlook,
): number {
  const card = move.card >= 0 ? move.card : flipped;
  const immediate = move.target >= 0 ? POINTS[card] + POINTS[move.target] : 0;
  const table = move.target >= 0 ? knowledge.table.filter((entry) => entry !== move.target) : [...knowledge.table, card];
  const hand = move.card >= 0 ? knowledge.hand.filter((entry) => entry !== move.card) : knowledge.hand;
  // A hand play is followed by the seat's own flip from the stock: every unseen card is equally likely.
  if (move.card < 0 || stockCount === 0 || knowledge.unseen.length === 0) {
    return immediate + tableOutlook(table, knowledge.unseen, stockCount, hand, outlook);
  }
  let total = 0;
  for (const flip of knowledge.unseen) {
    const rest = knowledge.unseen.filter((entry) => entry !== flip);
    let best = -1;
    for (const target of table) if (pairs(flip, target) && (best < 0 || POINTS[target] > POINTS[best])) best = target;
    if (best >= 0) {
      total += POINTS[flip] + POINTS[best] + tableOutlook(table.filter((entry) => entry !== best), rest, stockCount - 1, hand, outlook);
    } else total += tableOutlook([...table, flip], rest, stockCount - 1, hand, outlook);
  }
  return immediate + total / knowledge.unseen.length;
}

/** Opponents' weights grow with their standing: points taken by a leader cost more than points taken by a trailer. */
function outlookFor(visible: RedPointsVisibleState, knowledge: RedPointsKnowledge): Outlook {
  const me = seatIndex(visible.mySeat);
  const best = Math.max(...knowledge.scores);
  const opponents: { cards: number; weight: number }[] = [];
  for (let seat = nextSeatIndex(me); seat !== me; seat = nextSeatIndex(seat)) {
    const behind = best - knowledge.scores[seat];
    opponents.push({
      cards: visible.handCounts[SEAT_ORDER_CLOCKWISE[seat]],
      weight: TRAILING_WEIGHT + (1 - TRAILING_WEIGHT) * Math.exp(-behind / STANDING_SCALE),
    });
  }
  return { opponents };
}

/** Every legal decision with the heuristic's expected point balance, larger is better. */
export function scoreRedPointsOptions(visible: RedPointsVisibleState): RedPointsOption[] {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return [];
  const knowledge = readKnowledge(visible);
  const outlook = outlookFor(visible, knowledge);
  const moves: RedPointsMove[] = [];
  let flipped = -1;
  if (visible.step === 'flip-choose') {
    if (!visible.pendingFlip) return [];
    flipped = rpIndex(visible.pendingFlip);
    for (const target of knowledge.table) if (pairs(flipped, target)) moves.push({ card: -1, target });
  } else {
    for (const card of knowledge.hand) {
      const targets = knowledge.table.filter((target) => pairs(card, target));
      if (targets.length === 0) moves.push({ card, target: -1 });
      else for (const target of targets) moves.push({ card, target });
    }
  }
  return moves.map((move) => {
    const value: BotAction = move.card < 0
      ? { type: 'redpoints-flip', capture: rpCard(move.target) }
      : { type: 'redpoints-play', card: rpCard(move.card), ...(move.target >= 0 ? { capture: rpCard(move.target) } : {}) };
    return { value, move, score: evaluate(move, flipped, knowledge, visible.stockCount, outlook) };
  });
}

/** Expected point balance over the unseen cards, including the bot's own flip and the opponents' turns before its next. */
export function getRedPointsBotAction(visible: RedPointsVisibleState, random: () => number): BotAction | null {
  return selectNearBest(scoreRedPointsOptions(visible), random, 0.5);
}
