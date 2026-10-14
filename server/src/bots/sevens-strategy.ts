import type { Card, Seat, SevensTable, SevensVisibleState, Suit } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { nextSeatCounterClockwise } from '@shared/rules/seats';
import { svApply, svIsRowClosed, svLegalPlays, svOrder } from '@shared/rules/sevens';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';
import {
  buildSevensKnowledge, sevensLiveProbability, sevensLiveProbabilityAt,
  type SevensKnowledge,
} from './sevens-knowledge';

const SEVEN = 7;
const LOW_END = 1;
const HIGH_END = 13;
const PROGRESS_VALUE = 0.3;
const END_CARD_VALUE = 0.5;
const OUTER_CARD_VALUE = 0.1;
const OPEN_BASE_PENALTY = 1;
const BLOCK_BONUS = 0.15;
const PLAY_MARGIN = 0.3;
const COVER_MARGIN = 0.2;

type Direction = 1 | -1;

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const sameCard = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;
const atOrder = (suit: Suit, order: number): Card => ({ suit, rank: (order === LOW_END ? 14 : order) as Card['rank'] });

function ordersBeyond(from: number, direction: Direction): number[] {
  const orders: number[] = [];
  for (let order = from + direction; order >= LOW_END && order <= HIGH_END; order += direction) orders.push(order);
  return orders;
}

/** Gate availability is an approximation, not an independent-card posterior. */
function reachableProbability(
  visible: SevensVisibleState,
  knowledge: SevensKnowledge,
  card: Card,
  table: SevensTable = visible.table,
  covered: readonly Card[] = visible.myCovered,
): number {
  const row = table[card.suit];
  const order = svOrder(card);
  if (svIsRowClosed(row, visible.options?.closeOnEnd ?? false)) return 0;
  if (row && order >= row.low && order <= row.high) return 0;
  const direction: Direction = order < SEVEN ? -1 : 1;
  const start = row ? (direction === -1 ? row.low - 1 : row.high + 1) : SEVEN;
  let probability = 1;
  for (let entry = start; direction === -1 ? entry >= order : entry <= order; entry += direction) {
    const gate = atOrder(card.suit, entry);
    if (covered.some((other) => sameCard(other, gate))) return 0;
    probability *= sevensLiveProbability(knowledge, gate);
  }
  return probability;
}

function directionValue(visible: SevensVisibleState, knowledge: SevensKnowledge, card: Card, direction: Direction): number {
  const beyond = ordersBeyond(svOrder(card), direction);
  if (beyond.length === 0) return END_CARD_VALUE;
  const own = new Set(visible.myHand.filter((entry) => entry.suit === card.suit).map(svOrder));
  let availability = 1;
  let saved = 0;
  // A gap's live probability already prices the wait; discounting it again undervalued long chains.
  for (const order of beyond) {
    availability *= sevensLiveProbability(knowledge, atOrder(card.suit, order));
    if (own.has(order)) saved += order * availability;
  }
  const next = atOrder(card.suit, beyond[0]);
  if (own.has(beyond[0])) return PROGRESS_VALUE * saved;
  const available = sevensLiveProbability(knowledge, next);
  const heaviness = sum(beyond) / beyond.length / HIGH_END;
  return PROGRESS_VALUE * saved - available * (OPEN_BASE_PENALTY + heaviness);
}

function activeOpponents(visible: SevensVisibleState): Seat[] {
  return SEAT_ORDER_CLOCKWISE.filter((seat) => seat !== visible.mySeat && visible.handCounts[seat] > 0);
}

function scoreClosure(visible: SevensVisibleState, knowledge: SevensKnowledge, card: Card): number {
  const row = visible.table[card.suit];
  if (!row) return 0;
  const opposite = svOrder(card) === LOW_END ? ordersBeyond(row.high, 1) : ordersBeyond(row.low, -1);
  const own = new Set(visible.myHand.filter((entry) => entry.suit === card.suit).map(svOrder));
  let sacrificed = 0;
  let blocked = 0;
  for (const order of opposite) {
    const value = order * reachableProbability(visible, knowledge, atOrder(card.suit, order));
    if (own.has(order)) sacrificed += value;
    else blocked += value;
  }
  return BLOCK_BONUS * blocked / Math.max(1, activeOpponents(visible).length) - sacrificed;
}

/** Each opponent gets at most one play before the bot acts again. */
function endpointExposure(knowledge: SevensKnowledge, gates: readonly Card[], seats: readonly Seat[]): number {
  if (gates.length === 0 || gates.length > seats.length) return 0;
  function assign(gateIndex: number, seatIndex: number): number {
    if (gateIndex === gates.length) return 1;
    let probability = 0;
    for (let index = seatIndex; index <= seats.length - (gates.length - gateIndex); index++) {
      probability += sevensLiveProbabilityAt(knowledge, gates[gateIndex], seats[index]) * assign(gateIndex + 1, index + 1);
    }
    return probability;
  }
  return Math.min(1, assign(0, 0));
}

function scoreExposure(visible: SevensVisibleState, knowledge: SevensKnowledge, played: Card, table: SevensTable): number {
  if (!visible.options?.closeOnEnd) return 0;
  const seats: Seat[] = [];
  let seat = visible.mySeat;
  for (let index = 0; index < 3; index++) {
    seat = nextSeatCounterClockwise(seat);
    if (visible.handCounts[seat] > 0) seats.push(seat);
  }
  let risk = 0;
  for (const suit of Object.keys(table) as Suit[]) {
    const row = table[suit];
    if (!row || svIsRowClosed(row, true)) continue;
    const low = ordersBeyond(row.low, -1).map((order) => atOrder(suit, order));
    const high = ordersBeyond(row.high, 1).map((order) => atOrder(suit, order));
    // Assume a holder uses the exposed gate; this deliberately favors preserving vulnerable cards.
    const exposure = Math.min(1, endpointExposure(knowledge, low, seats) + endpointExposure(knowledge, high, seats));
    const vulnerable = sum(visible.myHand.filter((entry) => entry.suit === suit && !sameCard(entry, played))
      .map((entry) => svOrder(entry) * reachableProbability(visible, knowledge, entry, table)));
    risk += exposure * vulnerable;
  }
  return risk;
}

function scorePlay(visible: SevensVisibleState, knowledge: SevensKnowledge, card: Card): number {
  const order = svOrder(card);
  const directions: Direction[] = order === SEVEN ? [1, -1] : [order > SEVEN ? 1 : -1];
  const total = sum(directions.map((direction) => directionValue(visible, knowledge, card, direction)));
  const closure = visible.options?.closeOnEnd && (order === LOW_END || order === HIGH_END)
    ? scoreClosure(visible, knowledge, card) : 0;
  const next = svApply(visible.table, card, visible.options?.closeOnEnd);
  const remaining = visible.myHand.filter((entry) => !sameCard(entry, card));
  const options = svLegalPlays(remaining, next, false, visible.options?.closeOnEnd).length;
  return total + OUTER_CARD_VALUE * Math.abs(order - SEVEN) + closure
    + 0.1 * Math.min(3, options) - scoreExposure(visible, knowledge, card, next);
}

function scoreCover(visible: SevensVisibleState, knowledge: SevensKnowledge, card: Card): number {
  if (reachableProbability(visible, knowledge, card) === 0) return 0;
  const covered = [...visible.myCovered, card];
  const loss = sum(visible.myHand.map((entry) => svOrder(entry) * (
    reachableProbability(visible, knowledge, entry) - reachableProbability(visible, knowledge, entry, visible.table, covered)
  )));
  const order = svOrder(card);
  const beyond = order === SEVEN ? [...ordersBeyond(order, -1), ...ordersBeyond(order, 1)]
    : ordersBeyond(order, order > SEVEN ? 1 : -1);
  const own = new Set(visible.myHand.filter((entry) => entry.suit === card.suit).map(svOrder));
  const blocked = sum(beyond.filter((entry) => !own.has(entry))
    .map((entry) => entry * reachableProbability(visible, knowledge, atOrder(card.suit, entry))));
  return -loss + BLOCK_BONUS * blocked / Math.max(1, activeOpponents(visible).length);
}

export function getSevensBotAction(visible: SevensVisibleState, random: () => number): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  if (visible.validCards.length === 1) return { type: 'sevens-play', card: visible.validCards[0] };
  const knowledge = buildSevensKnowledge(visible);
  if (visible.validCards.length > 0) {
    const card = selectNearBest(
      visible.validCards.map((entry) => ({ value: entry, score: scorePlay(visible, knowledge, entry) })), random, PLAY_MARGIN,
    );
    return card ? { type: 'sevens-play', card } : null;
  }
  const options = visible.myHand.map((entry) => ({ value: entry, score: scoreCover(visible, knowledge, entry) }));
  const dead = options.filter((entry) => reachableProbability(visible, knowledge, entry.value) === 0);
  // Preserve live cards when a forced cover can consume a known dead card, unless blocking has a clear benefit.
  const candidates = dead.length > 0 ? options.filter((entry) => dead.includes(entry) || entry.score > COVER_MARGIN) : options;
  const card = selectNearBest(candidates, random, COVER_MARGIN);
  return card ? { type: 'sevens-cover', card } : null;
}
