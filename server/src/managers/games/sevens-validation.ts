import type { SevensTable, Seat, Card, SevensGameState } from '@shared/types';
import {
  object, suits, number, seatCounts, seatCards, seats, cardId, oneOf, card, commonGame, sameJson,
} from '../../runtime/validation-helpers';
import {
  SV_HAND_SIZE, svPenalty, svWinners, svEmptyTable, svIsPlayable, svApply, svLegalPlays, svAllClosed,
} from '@shared/rules/sevens';
import { isDeepStrictEqual } from 'node:util';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import { isSevensOptions } from '@shared/sevens-options';
import { nextSeatCounterClockwise } from '@shared/rules/seats';

function sevensTable(value: unknown): value is SevensTable {
  return object(value) && Object.keys(value).length === 4 && suits.every((suit) => {
    const row = value[suit];
    return row === null || (object(row) && Object.keys(row).length === 2 && number(row.low) && number(row.high)
      && row.low >= 1 && row.low <= 7 && row.high >= 7 && row.high <= 13);
  });
}

/** Sevens result: penalties and winners follow from the covered cards. */
export function isSevensResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'sevens') return false;
  const penalties = value.penalties;
  if (!seatCounts(penalties, 364) || !seatCards(value.covered, SV_HAND_SIZE) || !Array.isArray(value.winners)) return false;
  const covered = value.covered as Record<Seat, Card[]>;
  const all = seats.flatMap((seat) => covered[seat]);
  return new Set(all.map(cardId)).size === all.length &&
    seats.every((seat) => penalties[seat] === svPenalty(covered[seat])) &&
    isDeepStrictEqual(value.winners, svWinners(penalties));
}

function sevensLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp) || !oneOf(value.seat, seats)) return false;
  if (value.type === 'cover') {
    return Object.keys(value).length === 3 || (Object.keys(value).length === 4 && value.auto === true);
  }
  return value.type === 'play' && card(value.card);
}

export function sevensGame(value: ObjectValue, player: PlayerValidator): boolean {
  return commonGame(value, player) &&
    (value.options === undefined || isSevensOptions(value.options)) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    seatCards(value.hands, SV_HAND_SIZE) &&
    seatCards(value.covered, SV_HAND_SIZE) &&
    sevensTable(value.table) &&
    oneOf(value.currentTurnSeat, seats) &&
    Array.isArray(value.log) &&
    value.log.every(sevensLog) &&
    (value.result === null || isSevensResult(value.result));
}

/** Replaying the public log in counterclockwise turns reproduces the table and every pile. */
export function coherentSevensGame(state: SevensGameState): boolean {
  if (new Set(seats.map((seat) => state.players[seat].id)).size !== 4) return false;
  const played = state.log.flatMap((entry) => (entry.type === 'play' ? [entry.card] : []));
  const all = [...seats.flatMap((seat) => [...state.hands[seat], ...state.covered[seat]]), ...played];
  if (all.length !== 52 || new Set(all.map(cardId)).size !== 52 || state.log.length > 52) return false;
  // Covers are stored in order, so each seat's hand can be rebuilt at every action.
  const held = Object.fromEntries(seats.map((seat) => [seat, [...state.hands[seat], ...state.covered[seat],
    ...state.log.flatMap((entry) => (entry.type === 'play' && entry.seat === seat ? [entry.card] : []))]])) as
    Record<Seat, Card[]>;
  const coversMade = { N: 0, E: 0, S: 0, W: 0 };
  let table = svEmptyTable();
  let previous: Seat | null = null;
  for (const entry of state.log) {
    if (previous && entry.seat !== nextSeatCounterClockwise(previous)) return false;
    const card = entry.type === 'play' ? entry.card : state.covered[entry.seat][coversMade[entry.seat]++];
    if (entry.type === 'play') {
      if (!svIsPlayable(table, entry.card, previous === null, state.options?.closeOnEnd)) return false;
      table = svApply(table, entry.card, state.options?.closeOnEnd);
    } else if (previous === null || !card
      || svLegalPlays(held[entry.seat], table, false, state.options?.closeOnEnd).length > 0
      // Automatic covers only follow Dragon Slaying closing every suit.
      || (entry.auto && !svAllClosed(table, state.options?.closeOnEnd ?? false))) return false;
    held[entry.seat] = held[entry.seat].filter((own) => cardId(own) !== cardId(card));
    previous = entry.seat;
  }
  if (!isDeepStrictEqual(table, state.table) || !seats.every((seat) => {
    const actions = state.log.filter((entry) => entry.seat === seat);
    return state.covered[seat].length === actions.filter((entry) => entry.type === 'cover').length
      && state.hands[seat].length === SV_HAND_SIZE - actions.length;
  })) return false;
  if (state.phase === 'playing') {
    const spadeSeven = seats.find((seat) => state.hands[seat].some((entry) => entry.suit === 'spades' && entry.rank === 7));
    return state.result === null && state.log.length < 52 &&
      state.currentTurnSeat === (previous ? nextSeatCounterClockwise(previous) : spadeSeven);
  }
  const penalties = { N: svPenalty(state.covered.N), E: svPenalty(state.covered.E),
    S: svPenalty(state.covered.S), W: svPenalty(state.covered.W) };
  return state.log.length === 52 && state.currentTurnSeat === previous &&
    sameJson(state.result, { gameType: 'sevens', penalties, covered: state.covered, winners: svWinners(penalties) });
}
