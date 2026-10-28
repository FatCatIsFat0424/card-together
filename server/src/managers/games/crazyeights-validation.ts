import {
  object, number, gameSeatList, resultSeats, sameJson, oneOf, gameSeats, card, text, flexibleSeatGame,
  gameSeatValues, cards, distinctPlayers, cardId, gameSeatCounts, suits,
} from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import { isCrazyEightsOptions } from '@shared/crazyeights-options';
import type { CrazyEightsGameState } from '@shared/games/crazyeights/types';
import { CE_HANDS, ceDeckCount, ceDeckSize, ceIsPlayable, ceLowestSeats } from '@shared/rules/crazyeights';
import { occupiedSeats } from '@shared/rules/seats';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { isDeepStrictEqual } from 'node:util';

const MAX_POINTS = 52 * 2 * 50;

/** Crazy Eights result: lowest totals win, so `winners` lists exactly the seats on the lowest total. */
export function isCrazyEightsResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'crazyeights' || !gameSeatCounts(value.scores, MAX_POINTS * CE_HANDS)
    || !gameSeatList(value.winners) || !number(value.hands) || value.hands < 1 || value.hands > CE_HANDS
    || !Array.isArray(value.handWinners) || value.handWinners.length !== value.hands) return false;
  const participants = resultSeats(value);
  if (!participants) return false;
  const scores = value.scores as Record<string, number>;
  return value.handWinners.every((winner: unknown) => oneOf(winner, gameSeats) && participants.includes(winner as never))
    && gameSeats.every((seat) => participants.includes(seat) || scores[seat] === 0)
    && sameJson(value.winners, ceLowestSeats(participants, value.scores as never));
}

function pointsMap(value: unknown): boolean {
  return gameSeatCounts(value, MAX_POINTS);
}

function crazyEightsLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'hand':
      return number(value.hand) && oneOf(value.first, gameSeats) && card(value.starter);
    case 'play':
      return oneOf(value.seat, gameSeats) && card(value.card)
        && (value.suit === null || oneOf(value.suit, suits))
        && (value.effect === null || oneOf(value.effect, ['skip', 'reverse', 'draw']))
        && (value.target === null || oneOf(value.target, gameSeats))
        && number(value.drawn) && value.drawn <= 2;
    case 'draw':
    case 'pass':
      return oneOf(value.seat, gameSeats);
    case 'handEnd':
      return number(value.hand) && oneOf(value.winner, gameSeats) && pointsMap(value.points);
    default:
      return false;
  }
}

export function crazyEightsGame(value: ObjectValue, player: PlayerValidator): boolean {
  if (!isCrazyEightsOptions(value.options)) return false;
  const deckSize = 104;
  return (
    text(value.id) &&
    text(value.roomCode) &&
    number(value.startedAt) &&
    flexibleSeatGame(value, player) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    number(value.hand) && value.hand >= 1 && value.hand <= CE_HANDS &&
    gameSeatValues(value.hands, (hand) => cards(hand, deckSize)) &&
    cards(value.stock, deckSize) &&
    cards(value.discard, deckSize) &&
    oneOf(value.activeSuit, suits) &&
    oneOf(value.direction, ['ccw', 'cw']) &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    typeof value.drawn === 'boolean' &&
    gameSeatCounts(value.scores, MAX_POINTS * CE_HANDS) &&
    Array.isArray(value.log) &&
    value.log.every(crazyEightsLog) &&
    (value.result === null || isCrazyEightsResult(value.result))
  );
}

/** Both copies of every two-deck card are accounted for, and scores and the turn agree with the public log. */
export function coherentCrazyEightsGame(state: CrazyEightsGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (!seats.includes(state.currentTurnSeat)
    || GAME_SEAT_ORDER.some((seat) => !state.players[seat] && state.hands[seat].length > 0)) return false;
  const logSeats = state.log.every((entry) => {
    switch (entry.type) {
      case 'hand': return seats.includes(entry.first);
      case 'play': return seats.includes(entry.seat) && (entry.target === null || seats.includes(entry.target));
      case 'draw': case 'pass': return seats.includes(entry.seat);
      case 'handEnd': return seats.includes(entry.winner);
    }
  });
  if (!logSeats) return false;

  // Every card of the deck(s) is in exactly one place.
  const decks = ceDeckCount(seats.length);
  const all = [...seats.flatMap((seat) => state.hands[seat]), ...state.stock, ...state.discard];
  const copies = new Map<string, number>();
  for (const entry of all) copies.set(cardId(entry), (copies.get(cardId(entry)) ?? 0) + 1);
  if (all.length !== ceDeckSize(seats.length) || copies.size !== 52
    || [...copies.values()].some((count) => count !== decks)) return false;

  const hands = state.log.filter((entry) => entry.type === 'hand');
  const ends = state.log.filter((entry) => entry.type === 'handEnd');
  if (hands.length !== state.hand || hands.some((entry, index) => entry.hand !== index + 1)
    || ends.some((entry, index) => entry.hand !== index + 1)) return false;
  const finished = state.phase === 'scoring';
  if (ends.length !== (finished ? state.hand : state.hand - 1) || (finished && state.hand !== CE_HANDS)) return false;
  const summed = GAME_SEAT_ORDER.map((seat) => ends.reduce((sum, entry) => sum + entry.points[seat], 0));
  if (!isDeepStrictEqual(summed, GAME_SEAT_ORDER.map((seat) => state.scores[seat]))) return false;

  // The top discard and the suit in force follow the latest starter or play.
  const latest = [...state.log].reverse().find((entry) => entry.type === 'hand' || entry.type === 'play');
  if (!latest) return false;
  const top = state.discard.at(-1);
  if (latest.type === 'hand') {
    if (!isDeepStrictEqual(top, latest.starter) || state.activeSuit !== latest.starter.suit) return false;
  } else if (latest.type === 'play') {
    const suit = latest.card.rank === 8 ? latest.suit ?? latest.card.suit : latest.card.suit;
    if (!isDeepStrictEqual(top, latest.card) || state.activeSuit !== suit) return false;
  }

  const last = state.log.at(-1);
  if (state.drawn !== (last?.type === 'draw' && last.seat === state.currentTurnSeat)) return false;
  if (state.drawn && top && !state.hands[state.currentTurnSeat].some((own) => ceIsPlayable(own, top, state.activeSuit))) {
    return false;
  }
  if (!finished) return state.result === null;
  const { result } = state;
  return result !== null && sameJson(result.scores, state.scores)
    && sameJson(result.seats, seats) && result.hands === state.hand
    && sameJson(result.handWinners, ends.map((entry) => entry.winner));
}
