import { distinctPlayers, flexibleSeatGame, gameSeatList, gameSeats, number, object, oneOf, sameJson } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { ReversiGameState, ReversiMatchResult } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  RV_CELLS, isRvDiscs, rvCell, rvCounts, rvInitialDiscs, rvLeader, rvNextSide, rvNode, rvOpponent, rvPlace,
} from '@shared/rules/reversi';
import type { RvDiscs, RvSide } from '@shared/rules/reversi';
import { isBoardOutcome } from '@shared/rules/board/board-result';
import { isDrawOfferState } from '@shared/rules/board/match-controls';

/** Placements fill at most the 60 empty cells. */
const MAX_PLACEMENTS = RV_CELLS - 4;

/** Every placement is followed by at most one skipped turn. */
const MAX_LOG = MAX_PLACEMENTS * 2;

/** The reasons a Reversi match can end for. */
const REASONS = ['disc-count', 'resign', 'agreed-draw'];

function validResultFields(value: ObjectValue, seats: readonly string[]): boolean {
  const counts = value.discs;
  if (!object(counts) || Object.keys(counts).length !== seats.length) return false;
  const totals = seats.map((seat) => counts[seat]);
  if (!totals.every((total) => number(total) && total <= RV_CELLS) || (totals[0] as number) + (totals[1] as number) > RV_CELLS) {
    return false;
  }
  const winners = value.winners as string[];
  switch (value.reason) {
    case 'disc-count': {
      const [dark, light] = totals as number[];
      return sameJson(winners, dark === light ? [] : [seats[dark > light ? 0 : 1]]);
    }
    case 'resign': return winners.length === 1;
    case 'agreed-draw': return winners.length === 0;
    default: return false;
  }
}

/** Reversi result: both seats with their final disc totals, and a reason that agrees with the winners. */
export function isReversiResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'reversi' || !gameSeatList(value.seats) || value.seats.length !== 2
    || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as string[]).includes(seat)))
    || !number(value.moves) || value.moves > MAX_PLACEMENTS || !oneOf(value.reason, REASONS)) return false;
  return isBoardOutcome(value, value.seats) && validResultFields(value, value.seats);
}

function reversiLog(value: unknown): boolean {
  if (!object(value) || !oneOf(value.seat, gameSeats) || !number(value.timestamp)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => !['seat', 'to', 'flips', 'timestamp'].includes(key))) return false;
  if (!Array.isArray(value.flips) || value.flips.length > 25 || !value.flips.every((flip: unknown) => rvCell(flip) !== null)) return false;
  return value.to === undefined ? value.flips.length === 0 : rvCell(value.to) !== null && value.flips.length > 0;
}

export function reversiGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) && Object.keys(value.players as ObjectValue).length === 2 &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    isRvDiscs(value.discs) &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    isDrawOfferState(value.drawOffer, occupiedSeats(value.players as ObjectValue)) &&
    Array.isArray(value.log) && value.log.length <= MAX_LOG && value.log.every(reversiLog) &&
    (value.result === null || isReversiResult(value.result));
}

/**
 * Replaying the public log from the standard start reproduces the board, the turn, and the result: every
 * placement is legal for the seat on turn and lists exactly the discs it flipped, a skipped turn appears
 * only for a seat with no legal move, and a match ends by count only when neither side can move.
 */
export function coherentReversiGame(state: ReversiGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (seats.length !== 2) return false;
  let discs: RvDiscs = rvInitialDiscs();
  let side: RvSide = 0;
  let skipped: RvSide | null = null;
  let over = false;
  let placements = 0;
  for (const entry of state.log) {
    if (over) return false;
    if (skipped !== null) {
      if (entry.seat !== seats[skipped] || entry.to !== undefined) return false;
      skipped = null;
      continue;
    }
    const index = rvCell(entry.to);
    const placed = index === null ? null : rvPlace(discs, index, side);
    if (entry.seat !== seats[side] || index === null || !placed || !sameJson(entry.flips, placed.flips.map(rvNode))) return false;
    discs = placed.discs;
    placements++;
    const next = rvNextSide(discs, side);
    if (next === null) over = true;
    else if (next === side) skipped = rvOpponent(side);
    else side = next;
  }
  if (skipped !== null || !sameJson(state.discs, discs) || state.currentTurnSeat !== seats[side]) return false;
  if ((state.phase === 'scoring') !== (state.result !== null)) return false;
  if (over && state.result === null) return false;
  if (state.result === null) return true;
  const [dark, light] = rvCounts(discs);
  const result: ReversiMatchResult = state.result;
  const leader = rvLeader(discs);
  const natural = over ? sameJson(result.winners, leader === null ? [] : [seats[leader]]) && result.reason === 'disc-count'
    : result.reason !== 'disc-count';
  return natural && sameJson(result.seats, seats) && result.moves === placements
    && sameJson(result.discs, { [seats[0]]: dark, [seats[1]]: light });
}
