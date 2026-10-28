import {
  object, number, gameSeatList, resultSeats, sameJson, oneOf, gameSeats, card, text, flexibleSeatGame,
  gameSeatValues, cards, distinctPlayers, cardId,
} from '../../runtime/validation-helpers';
import { NN_MAX, nnDeckSize, NN_HAND_SIZE, nnHasPlayable } from '@shared/rules/ninetynine';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import { isNinetyNineOptions } from '@shared/ninetynine-options';
import type { NinetyNineGameState } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { isDeepStrictEqual } from 'node:util';

/**
 * 99 result: either a single `winnerSeat` after three eliminations (the legacy shape), or two or
 * more tied `winners` in seat order when a two-deck stock ran out; together with the distinct
 * eliminated seats they cover all four seats.
 */
export function isNinetyNineResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'ninetynine' || !number(value.finalTotal) || value.finalTotal > NN_MAX
    || !gameSeatList(value.eliminationOrder) || ('winnerSeat' in value) === ('winners' in value)) return false;
  const participants = resultSeats(value);
  const tied = 'winners' in value;
  const winners: unknown = tied ? value.winners : [value.winnerSeat];
  if (!participants || !gameSeatList(winners) || winners.length + value.eliminationOrder.length !== participants.length) return false;
  return new Set([...value.eliminationOrder, ...winners]).size === participants.length
    && [...value.eliminationOrder, ...winners].every((seat) => participants.includes(seat))
    && (!tied || (winners.length >= 2 && sameJson(winners, participants.filter((seat) => winners.includes(seat)))));
}

function ninetyNineLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp) || !oneOf(value.seat, gameSeats)) return false;
  if (value.type === 'eliminated') return true;
  return value.type === 'play' && card(value.card) &&
    (value.choice === null || oneOf(value.choice, ['plus', 'minus'])) &&
    (value.target === null || oneOf(value.target, gameSeats)) &&
    number(value.total) && value.total <= NN_MAX;
}

export function ninetyNineGame(value: ObjectValue, player: PlayerValidator): boolean {
  if (value.options !== undefined && !isNinetyNineOptions(value.options)) return false;
  const deckSize = nnDeckSize(value.options);
  return (
    text(value.id) &&
    text(value.roomCode) &&
    number(value.startedAt) &&
    flexibleSeatGame(value, player) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    gameSeatValues(value.hands, (hand) => cards(hand, NN_HAND_SIZE)) &&
    cards(value.stock, deckSize) &&
    cards(value.discard, deckSize) &&
    number(value.total) &&
    value.total <= NN_MAX &&
    oneOf(value.direction, ['ccw', 'cw']) &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    Array.isArray(value.eliminated) &&
    value.eliminated.every((seat: unknown) => oneOf(seat, gameSeats)) &&
    new Set(value.eliminated).size === value.eliminated.length &&
    Array.isArray(value.log) &&
    value.log.every(ninetyNineLog) &&
    (value.result === null || isNinetyNineResult(value.result))
  );
}

/** Every deck card is accounted for, eliminations match the log, and the current seat can play. */
export function coherentNinetyNineGame(state: NinetyNineGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (!seats.includes(state.currentTurnSeat) || state.eliminated.some((seat) => !seats.includes(seat))
    || state.log.some((entry) => !seats.includes(entry.seat)
      || (entry.type === 'play' && entry.target !== null && !seats.includes(entry.target)))) return false;
  if (state.result && !sameJson(resultSeats(state.result as unknown as ObjectValue), seats)) return false;
  if (GAME_SEAT_ORDER.some((seat) => !state.players[seat] && state.hands[seat].length > 0)) return false;
  const { eliminated, result } = state;
  const twoDecks = state.options?.twoDecks === true;
  const all = [...seats.flatMap((seat) => state.hands[seat]), ...state.stock, ...state.discard];
  const copies = new Map<string, number>();
  for (const entry of all) copies.set(cardId(entry), (copies.get(cardId(entry)) ?? 0) + 1);
  if (all.length !== nnDeckSize(state.options) || copies.size !== 52
    || [...copies.values()].some((count) => count !== (twoDecks ? 2 : 1))) return false;
  const logged = state.log.flatMap((entry) => (entry.type === 'eliminated' ? [entry.seat] : []));
  if (!isDeepStrictEqual(logged, eliminated) || eliminated.some((seat) => state.hands[seat].length > 0)) return false;
  const lastPlay = state.log.filter((entry) => entry.type === 'play').at(-1);
  if (lastPlay?.type === 'play'
    ? lastPlay.total !== state.total || !isDeepStrictEqual(state.discard.at(-1), lastPlay.card)
    : state.total !== 0 || state.discard.length > 0) return false;
  // A two-deck stock is never refilled, so it is empty exactly when the match settled by running out.
  if (state.phase === 'playing') {
    return result === null && eliminated.length < seats.length - 1 && !eliminated.includes(state.currentTurnSeat) &&
      (!twoDecks || state.stock.length > 0) && nnHasPlayable(state.total, state.hands[state.currentTurnSeat]);
  }
  if (result === null || !isDeepStrictEqual(result.eliminationOrder, eliminated) || result.finalTotal !== state.total) {
    return false;
  }
  if ('winners' in result) {
    return twoDecks && state.stock.length === 0 && lastPlay?.seat === state.currentTurnSeat &&
      isDeepStrictEqual(result.winners, seats.filter((seat) => !eliminated.includes(seat)));
  }
  return eliminated.length === seats.length - 1 && result.winnerSeat === state.currentTurnSeat && (!twoDecks || state.stock.length > 0);
}
