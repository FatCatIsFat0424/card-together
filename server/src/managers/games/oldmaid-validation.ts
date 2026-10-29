import {
  OM_DEALS, omDeck, omNextHolder, omPlacePoints, omStarter, omWinners,
} from '@shared/rules/oldmaid';
import { cardKey, isCardOrJoker } from '@shared/rules/cards';
import { gameSeatMap, occupiedSeats } from '@shared/rules/seats';
import type { Card, GameSeat, OldMaidGameState } from '@shared/types';
import {
  object, number, oneOf, gameSeats, gameSeatCounts, gameSeatList, gameSeatValues, flexibleSeatGame, distinctPlayers,
  sameJson, card,
} from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';

/** The deck holds 52 cards and one joker. */
const DECK_SIZE = 53;

function cardList(value: unknown, max: number): boolean {
  return Array.isArray(value) && value.length <= max && value.every(card);
}

function handList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= DECK_SIZE && value.every(isCardOrJoker);
}

function seatOrder(value: unknown): boolean {
  return gameSeatList(value) && value.length >= 2;
}

/** Old Maid result: placement points of every deal, the winners holding the most. */
export function isOldMaidResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'oldmaid' || !seatOrder(value.seats) || value.deals !== OM_DEALS
    || !gameSeatCounts(value.totals, DECK_SIZE * OM_DEALS) || !Array.isArray(value.dealOrders)
    || value.dealOrders.length !== OM_DEALS || !gameSeatList(value.winners)) return false;
  const seats = value.seats as GameSeat[];
  const totals = value.totals;
  const orders = value.dealOrders as unknown[];
  if (!sameJson(seats, gameSeats.filter((seat) => seats.includes(seat)))) return false;
  const expected = gameSeatMap(() => 0);
  for (const order of orders) {
    if (!gameSeatList(order) || order.length !== seats.length || !order.every((seat) => seats.includes(seat))) return false;
    order.forEach((seat, index) => { expected[seat] += omPlacePoints(seats.length, index + 1); });
  }
  return sameJson(totals, expected) && sameJson(value.winners, omWinners(expected, seats));
}

function oldMaidLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'deal':
      return number(value.deal) && value.deal >= 1 && value.deal <= OM_DEALS && oneOf(value.starter, gameSeats)
        && gameSeatValues(value.discards, (entry) => cardList(entry, DECK_SIZE))
        && gameSeatCounts(value.counts, DECK_SIZE) && gameSeatList(value.finished);
    case 'draw':
      return oneOf(value.seat, gameSeats) && oneOf(value.from, gameSeats) && value.seat !== value.from
        && number(value.index) && value.index < DECK_SIZE && cardList(value.discarded, 2)
        && gameSeatList(value.finished) && value.finished.length <= 2;
    case 'settle':
      return number(value.deal) && value.deal >= 1 && value.deal <= OM_DEALS && gameSeatList(value.order)
        && oneOf(value.loser, gameSeats) && gameSeatCounts(value.points, DECK_SIZE)
        && gameSeatCounts(value.totals, DECK_SIZE * OM_DEALS);
    default: return false;
  }
}

export function oldMaidGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    number(value.deal) && value.deal >= 1 && value.deal <= OM_DEALS &&
    gameSeatValues(value.hands, handList) &&
    gameSeatList(value.finished) &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    gameSeatCounts(value.totals, DECK_SIZE * OM_DEALS) &&
    Array.isArray(value.dealOrders) && value.dealOrders.length < OM_DEALS + 1 && value.dealOrders.every(gameSeatList) &&
    Array.isArray(value.log) &&
    value.log.every(oldMaidLog) &&
    (value.result === null || isOldMaidResult(value.result));
}

/** Cards a seat is dealt: 53 split one at a time starting with the first seat. */
function dealtCount(seatIndex: number, players: number): number {
  return Math.floor(DECK_SIZE / players) + (seatIndex < DECK_SIZE % players ? 1 : 0);
}

/**
 * Replaying the public log reproduces each deal's starter and discards, every draw's source and resulting counts,
 * who finished and when, and each deal's placement; the cards still held plus every pair discarded in the current
 * deal make up the whole deck exactly once.
 */
export function coherentOldMaidGame(state: OldMaidGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  const counts = gameSeatMap(() => 0);
  const totals = gameSeatMap(() => 0);
  const orders: GameSeat[][] = [];
  const discarded: Card[] = [];
  let deal = 0;
  let finished: GameSeat[] = [];
  let current: GameSeat | null = null;
  const holders = (): GameSeat[] => seats.filter((seat) => counts[seat] > 0);

  for (const entry of state.log) {
    if (entry.type === 'deal') {
      if (entry.deal !== deal + 1 || current !== null || entry.starter !== omStarter(entry.deal, seats)) return false;
      discarded.length = 0;
      for (const [index, seat] of seats.entries()) {
        const pairs = entry.discards[seat];
        if (pairs.length % 2 !== 0 || entry.counts[seat] + pairs.length !== dealtCount(index, seats.length)) return false;
        counts[seat] = entry.counts[seat];
        discarded.push(...pairs);
      }
      if (gameSeats.some((seat) => !seats.includes(seat) && (entry.counts[seat] !== 0 || entry.discards[seat].length > 0))) {
        return false;
      }
      const rotated = [...seats.slice(seats.indexOf(entry.starter)), ...seats.slice(0, seats.indexOf(entry.starter))];
      finished = rotated.filter((seat) => counts[seat] === 0);
      if (!sameJson(entry.finished, finished)) return false;
      deal = entry.deal;
      current = counts[entry.starter] > 0 ? entry.starter : omNextHolder(entry.starter, seats, counts);
    } else if (entry.type === 'draw') {
      if (current === null || entry.seat !== current || entry.from !== omNextHolder(entry.seat, seats, counts)
        || entry.index >= counts[entry.from] || entry.discarded.length % 2 !== 0) return false;
      counts[entry.from] -= 1;
      counts[entry.seat] += 1 - entry.discarded.length;
      if (counts[entry.seat] < 0) return false;
      discarded.push(...entry.discarded);
      const emptied = [entry.from, entry.seat].filter((seat) => counts[seat] === 0);
      if (!sameJson(entry.finished, emptied)) return false;
      finished = [...finished, ...emptied];
      current = holders().length <= 1 ? null : omNextHolder(entry.seat, seats, counts);
    } else {
      const left = holders();
      if (current !== null || deal === 0 || left.length !== 1 || entry.deal !== deal || entry.loser !== left[0]) return false;
      const order = [...finished, entry.loser];
      if (!sameJson(entry.order, order) || order.length !== seats.length) return false;
      const points = gameSeatMap((seat) => (order.includes(seat) ? omPlacePoints(seats.length, order.indexOf(seat) + 1) : 0));
      for (const seat of seats) totals[seat] += points[seat];
      if (!sameJson(entry.points, points) || !sameJson(entry.totals, totals)) return false;
      orders.push(order);
      current = null;
    }
  }
  if (deal === 0) return false;

  const finalSettled = orders.length === OM_DEALS;
  if (state.phase === 'playing') {
    if (finalSettled || state.result !== null || current === null || state.currentTurnSeat !== current) return false;
  } else if (!finalSettled || state.result === null) return false;
  if (state.deal !== deal || !sameJson(state.dealOrders, orders) || !sameJson(state.totals, totals)
    || !sameJson(state.finished, finished) || gameSeats.some((seat) => state.hands[seat].length !== counts[seat])) return false;
  if (state.phase === 'scoring' && !sameJson(state.result, {
    gameType: 'oldmaid', seats, deals: OM_DEALS, totals, dealOrders: orders, winners: omWinners(totals, seats),
  })) return false;

  const held = state.hands;
  const keys = [...gameSeats.flatMap((seat) => held[seat].map(cardKey)), ...discarded.map(cardKey)];
  return keys.length === DECK_SIZE && sameJson([...keys].sort(), omDeck().map(cardKey).sort());
}
