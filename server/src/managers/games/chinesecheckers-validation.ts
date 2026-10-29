import {
  distinctPlayers, flexibleSeatGame, gameSeatList, gameSeats, number, object, oneOf, sameJson,
} from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { ChineseCheckersGameState, ChineseCheckersMove, GameSeat } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import { CC_HOLES, CC_PLAYER_COUNTS, CC_TURN_LIMIT, ccCorners, ccIndex, isCcHoles } from '@shared/rules/chinesecheckers';
import { isBoardOutcome } from '@shared/rules/board/board-result';
import { isDrawOfferState } from '@shared/rules/board/match-controls';
import { applyMove, applyResignation, finish, newChineseCheckersGame } from './chinesecheckers-game';

/** Every seat takes at most the turn limit, plus one resignation each. */
const MAX_LOG = CC_TURN_LIMIT * 6 + 6;

/** The most rows ten marbles can still have to travel: all of them in the far corner. */
const MAX_REMAINING = 16 * 10;

/** The reasons a Chinese checkers match can end for. */
const REASONS = ['all-home', 'move-limit', 'no-moves', 'resign', 'agreed-draw'];

const playerCount = (count: number): boolean => CC_PLAYER_COUNTS.includes(count);

function seatNumbers(value: unknown, seats: readonly string[], valid: (entry: number) => boolean, all: boolean): boolean {
  if (!object(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => seats.includes(key) && number(value[key]) && valid(value[key] as number))
    && (!all || keys.length === seats.length);
}

/** Chinese checkers result: every seat's corner and place, and a reason that agrees with the winners. */
export function isChineseCheckersResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'chinesecheckers' || !gameSeatList(value.seats) || !playerCount(value.seats.length)
    || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as string[]).includes(seat)))
    || !number(value.moves) || value.moves > CC_TURN_LIMIT * 6 || !oneOf(value.reason, REASONS)) return false;
  const seats = value.seats as GameSeat[];
  if (!isBoardOutcome(value, seats)) return false;
  const corners = ccCorners(seats.length)!;
  if (!sameJson(value.corners, Object.fromEntries(seats.map((seat, index) => [seat, corners[index]])))) return false;
  if (!seatNumbers(value.remaining, seats, (entry) => entry <= MAX_REMAINING, false)
    || !seatNumbers(value.arrived, seats, (entry) => entry <= 10, false)
    || !sameJson(Object.keys(value.remaining as ObjectValue), Object.keys(value.arrived as ObjectValue))
    || !seatNumbers(value.ranks, seats, (entry) => entry >= 1 && entry <= seats.length, true)) return false;
  const winners = value.winners as GameSeat[];
  const ranks = value.ranks as Record<GameSeat, number>;
  if (!winners.every((seat) => ranks[seat] === 1)) return false;
  switch (value.reason) {
    case 'all-home': return winners.length === 1;
    case 'agreed-draw': return winners.length === 0 && seats.length === 2;
    case 'resign': return winners.length >= 1;
    default: return true;
  }
}

function logEntry(value: unknown): value is ChineseCheckersMove {
  if (!object(value) || !oneOf(value.seat, gameSeats) || !number(value.timestamp)) return false;
  if (Object.keys(value).some((key) => !['seat', 'from', 'to', 'path', 'jump', 'resigned', 'timestamp'].includes(key))) return false;
  if (value.resigned !== undefined) return value.resigned === true && Object.keys(value).length === 3;
  if (value.to === undefined) return Object.keys(value).length === 2;
  return ccIndex(value.from) !== null && ccIndex(value.to) !== null
    && (value.path === undefined || (Array.isArray(value.path) && value.path.length > 0 && value.path.length < CC_HOLES
      && value.path.every((node: unknown) => ccIndex(node) !== null)))
    && (value.jump === undefined || value.jump === true);
}

export function chineseCheckersGame(value: ObjectValue, player: PlayerValidator): boolean {
  if (!flexibleSeatGame(value, player)) return false;
  const seats = occupiedSeats(value.players as ObjectValue);
  return playerCount(seats.length) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    isCcHoles(value.holes) &&
    oneOf(value.currentTurnSeat, seats) &&
    isDrawOfferState(value.drawOffer, seats) &&
    gameSeatList(value.resigned) && value.resigned.every((seat) => seats.includes(seat)) &&
    Array.isArray(value.log) && value.log.length <= MAX_LOG && value.log.every(logEntry) &&
    (value.result === null || isChineseCheckersResult(value.result));
}

/**
 * Replaying the public log from the starting corners reproduces the board, the turn, the automatic passes,
 * the resignations, and the result. Two-player resignations and agreed draws leave no log entry, so they are
 * accepted only while the replayed match is still running and must close it exactly as stored.
 */
export function coherentChineseCheckersGame(state: ChineseCheckersGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const replay = newChineseCheckersGame(state.roomCode, state.players, state.startedAt, state.id);
  if (!replay) return false;
  const seats = occupiedSeats(state.players);
  for (const entry of state.log) {
    // Passes are recorded by the moves before them, so the replay writes them itself.
    if (entry.to === undefined && !entry.resigned) continue;
    if (replay.phase !== 'playing') return false;
    if (entry.resigned) {
      if (seats.length <= 2 || replay.resigned.includes(entry.seat)) return false;
      applyResignation(replay, entry.seat, entry.timestamp);
    } else if (!applyMove(replay, entry.seat, entry.from ?? '', entry.to ?? '', entry.timestamp).success) {
      return false;
    }
  }
  if (!sameJson(replay.log, state.log) || !sameJson(replay.holes, state.holes) || !sameJson(replay.resigned, state.resigned)
    || replay.currentTurnSeat !== state.currentTurnSeat) return false;
  if ((state.phase === 'scoring') !== (state.result !== null)) return false;
  if (replay.phase === 'scoring') return sameJson(replay.result, state.result);
  if (state.result === null) return true;
  if (seats.length !== 2 || !['resign', 'agreed-draw'].includes(state.result.reason)) return false;
  finish(replay, { winners: state.result.winners, reason: state.result.reason });
  return sameJson(replay.result, state.result);
}
