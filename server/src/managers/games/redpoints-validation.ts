import {
  object, seatCounts, seats, number, oneOf, card, text, seatCards, cards, cardId,
} from '../../runtime/validation-helpers';
import { isDeepStrictEqual } from 'node:util';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import { RP_HAND_SIZE, RP_TABLE_SIZE, rpPairOptions, rpScore } from '@shared/rules/redpoints';
import type { RedPointsGameState } from '@shared/types';

/** Red Points result: winners are exactly the top-scoring seats; all red points are 208. */
export function isRedPointsResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'redpoints' || !seatCounts(value.points, 208) ||
    !Array.isArray(value.winners)) return false;
  const points = value.points;
  const best = Math.max(...seats.map((seat) => points[seat]));
  return seats.reduce((sum, seat) => sum + points[seat], 0) === 208 &&
    isDeepStrictEqual(value.winners, seats.filter((seat) => points[seat] === best));
}

function redPointsLog(value: unknown): boolean {
  return object(value) && number(value.timestamp) && oneOf(value.type, ['play', 'flip']) &&
    oneOf(value.seat, seats) && card(value.card) && (value.captured === null || card(value.captured));
}

export function redPointsGame(value: ObjectValue, player: PlayerValidator): boolean {
  return (
    text(value.id) &&
    text(value.roomCode) &&
    number(value.startedAt) &&
    object(value.players) &&
    Object.keys(value.players).length === 4 &&
    seats.every((seat) => player((value.players as ObjectValue)[seat])) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    seatCards(value.hands, RP_HAND_SIZE) &&
    cards(value.table, 52) &&
    cards(value.stock, 52 - RP_HAND_SIZE * 4 - RP_TABLE_SIZE) &&
    seatCards(value.captured, 52) &&
    oneOf(value.currentTurnSeat, seats) &&
    oneOf(value.step, ['play', 'flip-choose']) &&
    (value.pendingFlip === null || card(value.pendingFlip)) &&
    Array.isArray(value.log) &&
    value.log.every(redPointsLog) &&
    (value.result === null || isRedPointsResult(value.result))
  );
}

/** All 52 cards are accounted for, piles match the log, and the pending step can resume. */
export function coherentRedPointsGame(state: RedPointsGameState): boolean {
  if (new Set(seats.map((seat) => state.players[seat].id)).size !== 4) return false;
  const { pendingFlip, result } = state;
  const all = [
    ...seats.flatMap((seat) => [...state.hands[seat], ...state.captured[seat]]),
    ...state.table, ...state.stock, ...(pendingFlip ? [pendingFlip] : []),
  ];
  if (all.length !== 52 || new Set(all.map(cardId)).size !== 52) return false;
  const plays = state.log.filter((entry) => entry.type === 'play');
  const flips = state.log.length - plays.length;
  if (
    !seats.every((seat) =>
      state.hands[seat].length === RP_HAND_SIZE - plays.filter((entry) => entry.seat === seat).length &&
      state.captured[seat].length === 2 * state.log.filter((entry) => entry.seat === seat && entry.captured).length) ||
    state.stock.length !== 52 - RP_HAND_SIZE * 4 - RP_TABLE_SIZE - flips - (pendingFlip ? 1 : 0) ||
    (state.step === 'flip-choose') !== (pendingFlip !== null) ||
    (pendingFlip !== null && rpPairOptions(pendingFlip, state.table).length < 2)
  )
    return false;
  if (state.phase === 'playing') {
    return result === null && (pendingFlip !== null || state.stock.length > 0 ||
      seats.some((seat) => state.hands[seat].length > 0));
  }
  return (
    result !== null && state.step === 'play' && state.stock.length === 0 && state.table.length === 0 &&
    seats.every((seat) => state.hands[seat].length === 0 && result.points[seat] === rpScore(state.captured[seat]))
  );
}
