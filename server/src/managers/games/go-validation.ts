import { distinctPlayers, flexibleSeatGame, gameSeatList, gameSeats, number, object, oneOf, sameJson } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { GameSeat, GoGameState } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  GO_HANDICAP_KOMI, GO_KOMI, goMoveLimit, goPlay, goPlayEnd, goPointOfNode, goScore, goStart, isGoOptions, isGoStones,
} from '@shared/rules/go';
import type { GoOptions, GoPosition } from '@shared/rules/go';
import { isBoardOutcome } from '@shared/rules/board/board-result';
import { isDrawOfferState } from '@shared/rules/board/match-controls';

/** The reasons a Go match can end for. */
const REASONS = ['score', 'move-limit', 'resign'];

const MAX_POINTS = 361;

/** A sorted list of distinct intersections of a board of `points` points. */
function sortedPoints(value: unknown, points: number): value is number[] {
  return Array.isArray(value) && value.every((point, index) => Number.isInteger(point) && point >= 0 && point < points
    && (index === 0 || point > value[index - 1]));
}

/** Margins are whole or half points: komi ends in .5. */
const halfPoints = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value * 2) && value >= 0;

/** Go result: shape and arithmetic that agree with the winners; the stones behind it are checked against the game. */
export function isGoResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'go' || !gameSeatList(value.seats) || value.seats.length !== 2
    || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as string[]).includes(seat)))
    || !isGoOptions(value.options) || !number(value.moves) || value.moves > goMoveLimit(value.options.size)
    || !oneOf(value.reason, REASONS) || value.komi !== (value.options.handicap > 0 ? GO_HANDICAP_KOMI : GO_KOMI)
    || !halfPoints(value.margin)
    || !object(value.captured) || !object(value.area) || !sortedPoints(value.dead, value.options.size ** 2)) return false;
  if (!isBoardOutcome(value, value.seats)) return false;
  const seats = value.seats;
  const winners = value.winners as string[];
  const captures = Object.entries(value.captured);
  if (captures.length !== 2 || !seats.every((seat) => number((value.captured as ObjectValue)[seat]))) return false;
  if (value.reason === 'resign') {
    return winners.length === 1 && value.dead.length === 0 && Object.keys(value.area).length === 0 && value.margin === 0;
  }
  const areas = seats.map((seat) => (value.area as ObjectValue)[seat]);
  return winners.length === 1 && Object.keys(value.area).length === 2 && areas.every(number)
    && (areas as number[]).reduce((sum, area) => sum + area, 0) <= value.options.size ** 2 && (value.margin as number) > 0;
}

/** Moves of the log are bounded by the cap. */
const maxLog = (options: GoOptions): number => goMoveLimit(options.size);

function goLog(value: unknown): boolean {
  if (!object(value) || !oneOf(value.seat, gameSeats) || !number(value.timestamp)) return false;
  if (Object.keys(value).some((key) => !['seat', 'to', 'capture', 'captured', 'timestamp'].includes(key))) return false;
  if (value.captured === undefined) return value.capture === undefined;
  return value.capture === true && Number.isInteger(value.captured) && (value.captured as number) > 0 && value.to !== undefined;
}

export function goGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) && Object.keys(value.players as ObjectValue).length === 2 &&
    isGoOptions(value.options) &&
    oneOf(value.phase, ['playing', 'marking', 'scoring']) &&
    isGoStones(value.stones, (value.options as GoOptions).size) &&
    Array.isArray(value.captures) && value.captures.length === 2 && value.captures.every(number) &&
    number(value.passes) && Array.isArray(value.resumes) && value.resumes.every(number) &&
    oneOf(value.currentTurnSeat, gameSeats) && number(value.markDeadline) &&
    Array.isArray(value.dead) && value.dead.length <= MAX_POINTS &&
    Array.isArray(value.confirmed) && value.confirmed.every((seat) => oneOf(seat, gameSeats)) &&
    isDrawOfferState(value.drawOffer, occupiedSeats(value.players as ObjectValue)) &&
    Array.isArray(value.log) && value.log.length <= maxLog(value.options as GoOptions) && value.log.every(goLog) &&
    (value.result === null || isGoResult(value.result));
}

/**
 * Replaying the public log from the opening reproduces the stones, captures, passes, and turn: every entry is
 * made by the seat to move, every move is legal (suicide and superko included), a captured count matches, and
 * play resumed only where two passes had ended it. The phase, the marking fields, and a counted result then
 * have to agree with that position.
 */
export function coherentGoGame(state: GoGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (seats.length !== 2) return false;
  const { size } = state.options;
  const start = goStart(state.options);
  let position = start.position;
  const history = [...start.history];
  if (!state.resumes.every((at, index) => Number.isInteger(at) && at >= 2 && at <= state.log.length
    && (index === 0 || at > state.resumes[index - 1]))) return false;
  for (let index = 0; index <= state.log.length; index++) {
    if (state.resumes.includes(index)) {
      // Marking can only be abandoned after two passes, before the move cap.
      if (goPlayEnd(position) !== 'passes' || position.moves >= goMoveLimit(size)) return false;
      position = { ...position, passes: 0 };
    }
    const entry = state.log[index];
    if (!entry) break;
    if (entry.seat !== seats[position.toMove]) return false;
    const move = entry.to === undefined ? 'pass' : goPointOfNode(size, entry.to);
    if (move === null) return false;
    const played = goPlay(position, move, history);
    if (!played || (played.captured.length || undefined) !== entry.captured) return false;
    position = played.position;
    if (move !== 'pass') history.push(played.hash);
  }
  if (!sameJson(state.stones, position.stones) || !sameJson(state.captures, position.captures)
    || state.passes !== position.passes || state.currentTurnSeat !== seats[position.toMove]) return false;
  return phaseMatches(state, seats, position);
}

/** The phase follows from the position, and a counted result from the stones it was counted on. */
function phaseMatches(state: GoGameState, seats: readonly GameSeat[], position: GoPosition): boolean {
  const { result } = state;
  const ended = goPlayEnd(position);
  const live = result === null;
  if (state.phase !== (live ? (ended === null ? 'playing' : 'marking') : 'scoring')) return false;
  const marking = state.phase === 'marking';
  if (marking ? state.markDeadline <= 0 : state.markDeadline !== 0) return false;
  if (!marking && (state.dead.length > 0 || state.confirmed.length > 0)) return false;
  if (marking) {
    const stoneAt = (point: number): boolean => state.stones[point] !== null;
    if (!sortedPoints(state.dead, state.stones.length) || !state.dead.every(stoneAt)
      || new Set(state.confirmed).size !== state.confirmed.length || !state.confirmed.every((seat) => seats.includes(seat))) return false;
  }
  if (result === null) return true;
  if (!sameJson(result.seats, seats) || !sameJson(result.options, state.options) || result.moves !== state.log.length
    || result.captured[seats[0]] !== state.captures[0] || result.captured[seats[1]] !== state.captures[1]
    || result.komi !== position.komi) return false;
  if (result.reason === 'resign') return true;
  if (result.reason !== (ended === 'move-limit' ? 'move-limit' : 'score') || ended === null
    || !result.dead.every((point) => state.stones[point] !== null)) return false;
  const scored = goScore(state.options.size, state.stones, result.dead, position.komi);
  return result.area[seats[0]] === scored.area[0] && result.area[seats[1]] === scored.area[1]
    && result.margin === scored.margin && sameJson(result.winners, [seats[scored.winner]]);
}
