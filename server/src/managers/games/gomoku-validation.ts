import { distinctPlayers, flexibleSeatGame, gameSeatList, gameSeats, number, object, oneOf, sameJson } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { GomokuGameState, GomokuMove } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  GM_CELLS, gmBlackSeat, gmCell, gmHasMove, gmInitialStones, gmIsLegal, gmPlacements, gmSeatToAct, gmSideOfStone, gmStage,
  gmStoneCount, gmWins, isGmStones, isGomokuOptions,
} from '@shared/rules/gomoku';
import { isBoardOutcome } from '@shared/rules/board/board-result';
import { isDrawOfferState } from '@shared/rules/board/match-controls';

/** Every stone is one entry, plus the second seat's colour choice. */
const MAX_LOG = GM_CELLS + 1;

/** The reasons a Gomoku match can end for. */
const REASONS = ['five-in-row', 'board-full', 'resign', 'agreed-draw'];

/** The fewest stones that make a five: black's fifth stone is the ninth on the board. */
const MIN_FIVE_STONES = 9;

/** Gomoku result: the seats, who played black, the stone count, the room rules, and a reason that agrees with the winners. */
export function isGomokuResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'gomoku' || !gameSeatList(value.seats) || value.seats.length !== 2
    || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as string[]).includes(seat)))
    || !oneOf(value.blackSeat, value.seats) || !number(value.moves) || value.moves > GM_CELLS
    || !isGomokuOptions(value.options) || !oneOf(value.reason, REASONS)) return false;
  if (!isBoardOutcome(value, value.seats)) return false;
  const winners = value.winners as string[];
  switch (value.reason) {
    case 'five-in-row': return winners.length === 1 && value.moves >= MIN_FIVE_STONES;
    case 'board-full': return winners.length === 0 && (value.options.renju || value.moves === GM_CELLS);
    case 'resign': return winners.length === 1;
    default: return winners.length === 0;
  }
}

function gomokuLog(value: unknown): boolean {
  if (!object(value) || !oneOf(value.seat, gameSeats) || !number(value.timestamp)) return false;
  if (Object.keys(value).some((key) => !['seat', 'to', 'swap', 'timestamp'].includes(key))) return false;
  // A move is either a stone or the colour choice.
  return value.to === undefined ? typeof value.swap === 'boolean' : gmCell(value.to) !== null && value.swap === undefined;
}

export function gomokuGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) && Object.keys(value.players as ObjectValue).length === 2 &&
    isGomokuOptions(value.options) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    isGmStones(value.stones) &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    isDrawOfferState(value.drawOffer, occupiedSeats(value.players as ObjectValue)) &&
    Array.isArray(value.log) && value.log.length <= MAX_LOG && value.log.every(gomokuLog) &&
    (value.result === null || isGomokuResult(value.result));
}

/**
 * Replaying the public log from an empty board reproduces the stones, the turn, and the result: every entry is
 * made by the seat that had to act, every stone is legal for its colour, the colour choice comes only after the
 * opening stones, and a match ends by itself only on a winning line or when the next player has no legal point.
 */
export function coherentGomokuGame(state: GomokuGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (seats.length !== 2) return false;
  const stones = gmInitialStones();
  const seen: GomokuMove[] = [];
  let ended: 'five-in-row' | 'board-full' | null = null;
  for (const entry of state.log) {
    if (ended !== null || entry.seat !== gmSeatToAct(seats, state.options, seen)) return false;
    const stage = gmStage(state.options, seen);
    let side: 0 | 1 | null = null;
    let index = 0;
    if (entry.to === undefined) {
      if (stage !== 'choosing') return false;
    } else {
      const target = gmCell(entry.to);
      side = gmSideOfStone(gmPlacements(seen));
      if (stage === 'choosing' || target === null || !gmIsLegal(stones, target, side, state.options.renju)) return false;
      index = target;
      stones[index] = side;
    }
    seen.push(entry);
    if (side !== null && gmWins(stones, index, side, state.options.renju)) ended = 'five-in-row';
    else if (gmStage(state.options, seen) === 'playing'
      && !gmHasMove(stones, gmSideOfStone(gmPlacements(seen)), state.options.renju)) ended = 'board-full';
  }
  if (!sameJson(state.stones, stones)) return false;
  if ((state.phase === 'scoring') !== (state.result !== null)) return false;
  // A finished match leaves the turn with its last mover; an unfinished one waits for the seat to act.
  const last = state.log.at(-1);
  if (state.result === null) {
    return ended === null && state.currentTurnSeat === gmSeatToAct(seats, state.options, state.log);
  }
  const result = state.result;
  const naturalEnd = ended !== null
    ? result.reason === ended && sameJson(result.winners, ended === 'five-in-row' ? [last!.seat] : [])
    : result.reason === 'resign' || result.reason === 'agreed-draw';
  const turn = ended !== null ? last!.seat : gmSeatToAct(seats, state.options, state.log);
  return naturalEnd && state.currentTurnSeat === turn && sameJson(result.seats, seats)
    && result.blackSeat === gmBlackSeat(seats, state.log) && result.moves === gmStoneCount(stones)
    && sameJson(result.options, state.options);
}
