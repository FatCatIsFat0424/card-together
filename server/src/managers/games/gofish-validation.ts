import {
  object, number, gameSeatList, resultSeats, sameJson, oneOf, gameSeats, text, flexibleSeatGame, gameSeatValues,
  cards, distinctPlayers, cardId, gameSeatCounts,
} from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { GoFishGameState } from '@shared/games/gofish/types';
import { GOFISH_MAX_PLAYERS } from '@shared/games/gofish/definition';
import { GF_BOOKS_PER_HAND, GF_BOOK_SIZE, GF_HANDS, gfLeaders } from '@shared/rules/gofish';
import { occupiedSeats } from '@shared/rules/seats';
import { GAME_SEAT_ORDER } from '@shared/constants';

const DECK_SIZE = 52;
const MAX_TOTAL_BOOKS = GF_BOOKS_PER_HAND * GF_HANDS;

function rank(value: unknown): boolean {
  return number(value) && value >= 2 && value <= 14;
}

function bookCounts(value: unknown): boolean {
  return gameSeatCounts(value, GF_BOOKS_PER_HAND);
}

/** Go Fish result: the most books win, and every hand's books add up to the totals. */
export function isGoFishResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'gofish' || !gameSeatCounts(value.scores, MAX_TOTAL_BOOKS)
    || !gameSeatList(value.winners) || !number(value.hands) || value.hands < 1 || value.hands > GF_HANDS
    || !Array.isArray(value.handBooks) || value.handBooks.length !== value.hands
    || !value.handBooks.every(bookCounts)) return false;
  const participants = resultSeats(value);
  if (!participants || participants.length > GOFISH_MAX_PLAYERS) return false;
  const scores = value.scores as Record<string, number>;
  const handBooks = value.handBooks as Record<string, number>[];
  return gameSeats.every((seat) => scores[seat] === handBooks.reduce((sum, books) => sum + books[seat], 0)
      && (participants.includes(seat) || scores[seat] === 0))
    && handBooks.every((books) => participants.reduce((sum, seat) => sum + books[seat], 0) <= GF_BOOKS_PER_HAND)
    && sameJson(value.winners, gfLeaders(participants, value.scores as never));
}

function goFishLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'hand':
      return number(value.hand) && oneOf(value.first, gameSeats);
    case 'ask':
      return oneOf(value.seat, gameSeats) && oneOf(value.target, gameSeats) && value.seat !== value.target
        && rank(value.rank) && number(value.given) && value.given <= GF_BOOK_SIZE
        && (value.given > 0 ? value.fished === null : oneOf(value.fished, ['lucky', 'miss', 'empty']));
    case 'book':
      return oneOf(value.seat, gameSeats) && rank(value.rank);
    case 'refill':
      return oneOf(value.seat, gameSeats);
    case 'handEnd':
      return number(value.hand) && bookCounts(value.books);
    default:
      return false;
  }
}

export function goFishGame(value: ObjectValue, player: PlayerValidator): boolean {
  return (
    text(value.id) &&
    text(value.roomCode) &&
    number(value.startedAt) &&
    flexibleSeatGame(value, player) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    number(value.hand) && value.hand >= 1 && value.hand <= GF_HANDS &&
    gameSeatValues(value.hands, (hand) => cards(hand, DECK_SIZE)) &&
    cards(value.stock, DECK_SIZE) &&
    gameSeatValues(value.books, (books) => Array.isArray(books) && books.length <= GF_BOOKS_PER_HAND && books.every(rank)) &&
    gameSeatCounts(value.scores, MAX_TOTAL_BOOKS) &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    Array.isArray(value.log) &&
    value.log.every(goFishLog) &&
    (value.result === null || isGoFishResult(value.result))
  );
}

/** Every card is in exactly one place, and books, scores and the turn agree with the public log. */
export function coherentGoFishGame(state: GoFishGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (seats.length > GOFISH_MAX_PLAYERS || !seats.includes(state.currentTurnSeat)
    || GAME_SEAT_ORDER.some((seat) => !state.players[seat] && (state.hands[seat].length > 0 || state.books[seat].length > 0))) {
    return false;
  }
  const logSeats = state.log.every((entry) => {
    switch (entry.type) {
      case 'hand': return seats.includes(entry.first);
      case 'ask': return seats.includes(entry.seat) && seats.includes(entry.target);
      case 'book': case 'refill': return seats.includes(entry.seat);
      case 'handEnd': return true;
    }
  });
  if (!logSeats) return false;

  // Booked ranks are gone from play; every other card is in one hand or the stock.
  const booked = seats.flatMap((seat) => state.books[seat]);
  if (new Set(booked).size !== booked.length) return false;
  const loose = [...seats.flatMap((seat) => state.hands[seat]), ...state.stock];
  const ids = new Set(loose.map(cardId));
  if (ids.size !== loose.length || loose.length !== DECK_SIZE - booked.length * GF_BOOK_SIZE
    || loose.some((entry) => booked.includes(entry.rank))) return false;

  const hands = state.log.filter((entry) => entry.type === 'hand');
  const ends = state.log.filter((entry) => entry.type === 'handEnd');
  if (hands.length !== state.hand || hands.some((entry, index) => entry.hand !== index + 1)
    || ends.some((entry, index) => entry.hand !== index + 1)) return false;
  const finished = state.phase === 'scoring';
  if (ends.length !== (finished ? state.hand : state.hand - 1) || (finished && state.hand !== GF_HANDS)) return false;
  const summed = GAME_SEAT_ORDER.map((seat) => ends.reduce((sum, entry) => sum + entry.books[seat], 0));
  if (!sameJson(summed, GAME_SEAT_ORDER.map((seat) => state.scores[seat]))) return false;

  // The books of the hand in play match the book entries since its deal.
  if (!finished) {
    const lastDeal = state.log.map((entry) => entry.type).lastIndexOf('hand');
    const laid = state.log.slice(lastDeal).flatMap((entry) => (entry.type === 'book' ? [entry] : []));
    if (!GAME_SEAT_ORDER.every((seat) => sameJson(state.books[seat], laid.filter((entry) => entry.seat === seat).map((entry) => entry.rank)))
      || state.hands[state.currentTurnSeat].length === 0) return false;
    return state.result === null;
  }
  const { result } = state;
  return result !== null && sameJson(result.scores, state.scores)
    && sameJson(result.seats, seats) && result.hands === state.hand
    && sameJson(result.handBooks, ends.map((entry) => entry.books));
}
