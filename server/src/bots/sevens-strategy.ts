import type { Card, SevensVisibleState, Suit } from '@shared/types';
import { svOrder } from '@shared/rules/sevens';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

// Heuristic summary:
// - Playing: reward cards whose row continues into the bot's own cards (they unlock its next turns), treat a row end as a
//   free play, and penalize extending a direction the bot cannot follow up (it only gives opponents a move), more so when
//   heavy cards remain beyond because keeping that direction blocked would make opponents cover them. A 7 is good when
//   the bot holds much of that suit and bad when it holds none.
// - Covering: a covered card permanently blocks every card beyond it in its direction. Cost is the card's own penalty plus
//   the bot's other cards stranded beyond it; blocking cards the bot does not hold is a small bonus; cards already
//   unreachable because of an earlier cover cost nothing extra and go first.

const SEVEN = 7;
const LOW_END = 1;
const HIGH_END = 13;
const CHAIN_VALUE = 3;
const BROKEN_CHAIN_VALUE = 0.5;
const END_CARD_VALUE = 0.5;
const OUTER_CARD_VALUE = 0.1;
const OPEN_BASE_PENALTY = 1;
const BLOCK_BONUS = 0.15;
const DEAD_CARD_SCORE = -0.1;
const PLAY_MARGIN = 0.3;
const COVER_MARGIN = 0.2;

type Direction = 1 | -1;


/** Orders the bot holds per suit. */
function ownOrders(hand: readonly Card[], suit: Suit): Set<number> {
  return new Set(hand.filter((card) => card.suit === suit).map(svOrder));
}

function chainLength(own: ReadonlySet<number>, from: number, direction: Direction): number {
  let length = 0;
  for (let order = from + direction; own.has(order); order += direction) length++;
  return length;
}

/** Orders strictly beyond `from` toward the row end. */
function ordersBeyond(from: number, direction: Direction): number[] {
  const orders: number[] = [];
  for (let order = from + direction; order >= LOW_END && order <= HIGH_END; order += direction) orders.push(order);
  return orders;
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

function directionValue(own: ReadonlySet<number>, from: number, direction: Direction): number {
  const beyond = ordersBeyond(from, direction);
  if (beyond.length === 0) return END_CARD_VALUE;
  const chain = chainLength(own, from, direction);
  const detached = beyond.filter((order) => own.has(order)).length - chain;
  if (chain > 0) return CHAIN_VALUE * chain + BROKEN_CHAIN_VALUE * detached;
  const heaviness = sum(beyond) / beyond.length / HIGH_END;
  return BROKEN_CHAIN_VALUE * detached - (OPEN_BASE_PENALTY + heaviness);
}

function scorePlay(visible: SevensVisibleState, card: Card): number {
  const order = svOrder(card);
  const own = ownOrders(visible.myHand, card.suit);
  const directions: Direction[] = order === SEVEN ? [1, -1] : [order > SEVEN ? 1 : -1];
  const total = sum(directions.map((direction) => directionValue(own, order, direction)));
  return total + OUTER_CARD_VALUE * Math.abs(order - SEVEN);
}

/** True when an earlier cover already cut this card off from its row. */
function isUnreachable(covered: readonly Card[], card: Card): boolean {
  const order = svOrder(card);
  return covered.some((entry) => {
    if (entry.suit !== card.suit) return false;
    const other = svOrder(entry);
    return order > SEVEN ? other > SEVEN && other < order : other < SEVEN && other > order;
  });
}

function scoreCover(visible: SevensVisibleState, card: Card): number {
  if (isUnreachable(visible.myCovered, card)) return DEAD_CARD_SCORE;
  const order = svOrder(card);
  const own = ownOrders(visible.myHand, card.suit);
  const beyond = ordersBeyond(order, order > SEVEN ? 1 : -1);
  const stranded = sum(beyond.filter((entry) => own.has(entry)));
  const blockedForOthers = sum(beyond.filter((entry) => !own.has(entry)));
  return -svOrder(card) - stranded + BLOCK_BONUS * blockedForOthers;
}

export function getSevensBotAction(visible: SevensVisibleState, random: () => number): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  if (visible.validCards.length > 0) {
    const card = selectNearBest(
      visible.validCards.map((entry) => ({ value: entry, score: scorePlay(visible, entry) })),
      random,
      PLAY_MARGIN,
    );
    return card ? { type: 'sevens-play', card } : null;
  }
  const card = selectNearBest(
    visible.myHand.map((entry) => ({ value: entry, score: scoreCover(visible, entry) })),
    random,
    COVER_MARGIN,
  );
  return card ? { type: 'sevens-cover', card } : null;
}

