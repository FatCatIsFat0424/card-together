import { distinctPlayers, flexibleSeatGame, gameSeatList, gameSeats, number, object, oneOf, sameJson } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { JungleGameState, JungleMatchResult, JungleMove } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  JG_NO_CAPTURE_LIMIT, isJgCells, jgApply, jgBoardOutcome, jgCell, jgInitialCells, jgIsLegal, jgNode, jgOutcome, jgPieceCount,
  jgQuietPlies, jgRankOf,
} from '@shared/rules/jungle';
import type { JgSide } from '@shared/rules/jungle';
import { isBoardOutcome } from '@shared/rules/board/board-result';
import type { BoardOutcome } from '@shared/rules/board/board-result';
import { isDrawOfferState } from '@shared/rules/board/match-controls';

/** Every capture restarts the no-capture count, and the sixteen pieces allow at most fifteen of them. */
const MAX_LOG = JG_NO_CAPTURE_LIMIT * 16 + 16;

const RULE_REASONS = ['den-entered', 'all-captured', 'no-moves', 'no-capture-limit'];
const REASONS = [...RULE_REASONS, 'resign', 'agreed-draw'];

const rank = (value: unknown): boolean => number(value) && value >= 1 && value <= 8;

function validResultFields(value: ObjectValue, seats: readonly string[]): boolean {
  const pieces = value.pieces;
  if (!object(pieces) || Object.keys(pieces).length !== seats.length) return false;
  if (!seats.every((seat) => number(pieces[seat]) && pieces[seat] <= 8)) return false;
  const winners = value.winners as string[];
  switch (value.reason) {
    case 'den-entered': case 'all-captured': case 'no-moves': case 'resign': return winners.length === 1;
    case 'no-capture-limit': case 'agreed-draw': return winners.length === 0;
    default: return false;
  }
}

/** Jungle result: both seats with the pieces they had left, and a reason that agrees with the winners. */
export function isJungleResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'jungle' || !gameSeatList(value.seats) || value.seats.length !== 2
    || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as string[]).includes(seat)))
    || !number(value.moves) || value.moves > MAX_LOG || !oneOf(value.reason, REASONS)) return false;
  return isBoardOutcome(value, value.seats) && validResultFields(value, value.seats);
}

function jungleLog(value: unknown): boolean {
  if (!object(value) || !oneOf(value.seat, gameSeats) || !number(value.timestamp)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => !['seat', 'from', 'to', 'piece', 'capture', 'captured', 'timestamp'].includes(key))) return false;
  if (jgCell(value.from) === null || jgCell(value.to) === null || !rank(value.piece) || typeof value.capture !== 'boolean') return false;
  return value.capture ? rank(value.captured) : value.captured === undefined;
}

export function jungleGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) && Object.keys(value.players as ObjectValue).length === 2 &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    isJgCells(value.cells) &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    isDrawOfferState(value.drawOffer, occupiedSeats(value.players as ObjectValue)) &&
    Array.isArray(value.log) && value.log.length <= MAX_LOG && value.log.every(jungleLog) &&
    (value.result === null || isJungleResult(value.result));
}

/**
 * Replaying the public log from the standard start reproduces the board, the turn, and the result: every move
 * is legal for the seat on turn and names the animals it moved and took, and a match ends by rule only where the
 * rules end it.
 */
export function coherentJungleGame(state: JungleGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (seats.length !== 2) return false;
  let cells = jgInitialCells();
  let side: JgSide = 0;
  let ended: BoardOutcome | null = null;
  const played: JungleMove[] = [];
  for (const entry of state.log) {
    const from = jgCell(entry.from);
    const to = jgCell(entry.to);
    if (ended || from === null || to === null || entry.seat !== seats[side] || !jgIsLegal(cells, from, to, side)) return false;
    const captured = cells[to] === 0 ? null : jgRankOf(cells[to]);
    if (entry.piece !== jgRankOf(cells[from]) || entry.capture !== (captured !== null) || entry.captured !== (captured ?? undefined)
      || entry.from !== jgNode(from) || entry.to !== jgNode(to)) return false;
    cells = jgApply(cells, { from, to });
    played.push(entry);
    const outcome = jgOutcome(cells, side, to, jgQuietPlies(played));
    if (outcome) ended = jgBoardOutcome(outcome, seats);
    else side = side === 0 ? 1 : 0;
  }
  if (!sameJson(state.cells, cells) || state.currentTurnSeat !== seats[side]) return false;
  if ((state.phase === 'scoring') !== (state.result !== null)) return false;
  if (ended && state.result === null) return false;
  if (state.result === null) return true;
  const result: JungleMatchResult = state.result;
  const natural = ended ? sameJson(result.winners, ended.winners) && result.reason === ended.reason
    : !RULE_REASONS.includes(result.reason);
  return natural && sameJson(result.seats, seats) && result.moves === state.log.length
    && sameJson(result.pieces, { [seats[0]]: jgPieceCount(cells, 0), [seats[1]]: jgPieceCount(cells, 1) });
}
