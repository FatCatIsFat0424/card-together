import { distinctPlayers, flexibleSeatGame, gameSeatList, gameSeats, number, object, oneOf, sameJson } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { BattleshipGameState, GameSeat } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import { BS_CELLS, BS_SHIPS, bsCell, bsFleetError, bsFleetSunk, isBattleshipOptions, isBsShip } from '@shared/rules/battleship';
import type { BsFleet } from '@shared/rules/battleship';
import { isBoardOutcome } from '@shared/rules/board/board-result';
import { isDrawOfferState } from '@shared/rules/board/match-controls';
import { nextShooter, shotEntry, shotTotals } from './battleship-game';

/** Each seat shoots every cell of the other sea at most once. */
const MAX_LOG = 2 * BS_CELLS;

/** The reasons a Battleship match can end for. */
const REASONS = ['fleet-sunk', 'resign'];

const LOG_KEYS = ['seat', 'to', 'result', 'ship', 'sunkCells', 'timestamp'];

function logShape(value: unknown): boolean {
  if (!object(value) || !oneOf(value.seat, gameSeats) || !number(value.timestamp) || bsCell(value.to) === null) return false;
  if (Object.keys(value).some((key) => !LOG_KEYS.includes(key)) || !oneOf(value.result, ['miss', 'hit', 'sunk'])) return false;
  if (value.result !== 'sunk') return value.ship === undefined && value.sunkCells === undefined;
  return isBsShip(value.ship) && Array.isArray(value.sunkCells) && value.sunkCells.length >= 2 && value.sunkCells.length <= 5
    && value.sunkCells.every((node: unknown) => bsCell(node) !== null);
}

function totalsShape(value: unknown, seats: readonly string[], max: number): boolean {
  return object(value) && Object.keys(value).length === 2 && seats.every((seat) => number(value[seat]) && value[seat] <= max);
}

/** Battleship result: both seats with their shot totals, and a reason that agrees with the winners. */
export function isBattleshipResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'battleship' || !gameSeatList(value.seats) || value.seats.length !== 2
    || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as string[]).includes(seat)))
    || !oneOf(value.reason, REASONS)) return false;
  const seats = value.seats;
  if (!totalsShape(value.shots, seats, BS_CELLS) || !totalsShape(value.hits, seats, BS_CELLS)
    || !totalsShape(value.sunk, seats, BS_SHIPS.length)) return false;
  return isBoardOutcome(value, seats) && (value.winners as string[]).length === 1;
}

export function battleshipGame(value: ObjectValue, player: PlayerValidator): boolean {
  if (!flexibleSeatGame(value, player) || Object.keys(value.players as ObjectValue).length !== 2) return false;
  if (!isBattleshipOptions(value.options)) return false;
  const seats = occupiedSeats(value.players as ObjectValue);
  const fleets = value.fleets;
  const options = value.options;
  return oneOf(value.phase, ['placing', 'playing', 'scoring']) && number(value.placeDeadline)
    && object(fleets) && Object.keys(fleets).length === 2
    && seats.every((seat) => fleets[seat] === null || bsFleetError(fleets[seat], options) === null)
    && gameSeatList(value.autoPlaced) && value.autoPlaced.every((seat) => seats.includes(seat))
    && oneOf(value.currentTurnSeat, seats)
    && isDrawOfferState(value.drawOffer, seats)
    && Array.isArray(value.log) && value.log.length <= MAX_LOG && value.log.every(logShape)
    && (value.result === null || isBattleshipResult(value.result));
}

/**
 * Replaying the public log against both fleets reproduces every shot result, the turn, and the result: each
 * shot is the seat's own on turn at a cell it never shot, and the match ends only when a fleet sinks or a
 * seat resigns.
 */
export function coherentBattleshipGame(state: BattleshipGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (seats.length !== 2 || (state.phase === 'scoring') !== (state.result !== null)) return false;
  if (!sameJson(state.autoPlaced, seats.filter((seat) => state.autoPlaced.includes(seat)))) return false;
  const fleets = seats.map((seat) => state.fleets[seat] ?? null);
  if (!fleets[0] || !fleets[1]) {
    // Before both fleets only a resignation can end the match, and nobody has shot.
    return state.log.length === 0 && state.currentTurnSeat === seats[0] && (state.result === null
      ? state.phase === 'placing' : state.result.reason === 'resign' && sameJson(state.result, {
        ...state.result, ...shotTotals(seats, []),
      }));
  }
  if (state.phase === 'placing') return false;

  const fleetOf = (seat: GameSeat): BsFleet => fleets[seats.indexOf(seat) === 0 ? 1 : 0]!;
  const shots: Record<string, number[]> = Object.fromEntries(seats.map((seat) => [seat, []]));
  let turn = seats[0];
  let sunkFleet: GameSeat | null = null;
  for (const entry of state.log) {
    if (sunkFleet || entry.seat !== turn) return false;
    const cell = bsCell(entry.to)!;
    const previous = shots[entry.seat];
    if (previous.includes(cell)) return false;
    // The shooter aims at the other seat's fleet.
    const target = fleetOf(entry.seat);
    if (!sameJson(entry, shotEntry(entry.seat, target, previous, cell, entry.timestamp))) return false;
    previous.push(cell);
    if (entry.result === 'sunk' && bsFleetSunk(target, previous)) sunkFleet = entry.seat;
    else turn = nextShooter(seats, entry, state.options);
  }
  if (state.currentTurnSeat !== turn) return false;
  const result = state.result;
  if (sunkFleet && !result) return false;
  if (!result) return true;
  const natural = sunkFleet ? sameJson(result.winners, [sunkFleet]) && result.reason === 'fleet-sunk' : result.reason === 'resign';
  return natural && sameJson(result.seats, seats) && sameJson(result, { ...result, ...shotTotals(seats, state.log) });
}
