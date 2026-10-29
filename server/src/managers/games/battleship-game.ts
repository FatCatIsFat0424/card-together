// ─── Battleship Game: simultaneous fleet placement, then alternating shots at hidden fleets ───

import { randomUUID } from 'node:crypto';
import type {
  BattleshipGameState, BattleshipMatchResult, BattleshipShot, BattleshipVisibleState, GameSeat, ObserverRole,
  PlayerInfo, RoomCode,
} from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import { bsCell, bsFleetError, bsFleetSunk, bsNode, bsResolveShot } from '@shared/rules/battleship';
import type { BattleshipOptions, BsFleet } from '@shared/rules/battleship';
import { resignationOutcome } from '@shared/rules/board/board-result';
import type { BoardOutcome } from '@shared/rules/board/board-result';
import { NO_DRAW_OFFER, afterBoardMove, applyMatchControl } from '@shared/rules/board/match-controls';
import type { MatchControlAction } from '@shared/rules/board/match-controls';
import { battleshipDefinition } from '@shared/games/battleship/definition';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → BattleshipGameState */
const games: Map<RoomCode, BattleshipGameState> = new Map();

/** The two seats in play order: the first shoots first. */
export function battleshipSeats(game: Pick<BattleshipGameState, 'players'>): GameSeat[] {
  return occupiedSeats(game.players);
}

/** The other seat of the match, or null for a seat outside it. */
export function battleshipOpponent(game: Pick<BattleshipGameState, 'players'>, seat: GameSeat): GameSeat | null {
  const seats = battleshipSeats(game);
  return seats.includes(seat) ? seats.find((other) => other !== seat) ?? null : null;
}

/** Cells shot so far by `shooter`, in order; they all lie in the opponent's sea. */
export function shotsBy(log: readonly BattleshipShot[], shooter: GameSeat): number[] {
  return log.filter((entry) => entry.seat === shooter).map((entry) => bsCell(entry.to)!);
}

export function startGame(
  roomCode: RoomCode, players: Partial<Record<GameSeat, PlayerInfo>>, options: BattleshipOptions, placeMs: number,
  now: number = Date.now(),
): void {
  const seats = occupiedSeats(players);
  games.set(roomCode, {
    gameType: 'battleship',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    options: { ...options },
    phase: 'placing',
    placeDeadline: now + placeMs,
    fleets: Object.fromEntries(seats.map((seat) => [seat, null])),
    autoPlaced: [],
    currentTurnSeat: seats[0],
    drawOffer: NO_DRAW_OFFER,
    log: [],
    result: null,
  });
}

/** Seats that have not placed their fleet yet, in play order. */
export function pendingSeats(game: BattleshipGameState): GameSeat[] {
  return game.phase === 'placing' ? battleshipSeats(game).filter((seat) => !game.fleets[seat]) : [];
}

/** Shots, hits, and sinkings per seat from the public log. */
export function shotTotals(seats: readonly GameSeat[], log: readonly BattleshipShot[]): Pick<BattleshipMatchResult, 'shots' | 'hits' | 'sunk'> {
  const count = (test: (entry: BattleshipShot) => boolean): Partial<Record<GameSeat, number>> =>
    Object.fromEntries(seats.map((seat) => [seat, log.filter((entry) => entry.seat === seat && test(entry)).length]));
  return {
    shots: count(() => true),
    hits: count((entry) => entry.result !== 'miss'),
    sunk: count((entry) => entry.result === 'sunk'),
  };
}

function finish(game: BattleshipGameState, outcome: BoardOutcome): void {
  const seats = battleshipSeats(game);
  game.phase = 'scoring';
  game.result = {
    gameType: 'battleship',
    seats,
    ...shotTotals(seats, game.log),
    winners: [...outcome.winners],
    reason: outcome.reason,
  };
}

/**
 * A fleet is final. `automatic` marks server-made fleets, which are accepted past the deadline. The last fleet
 * starts play with the first seat to shoot.
 */
export function placeFleet(
  roomCode: RoomCode, seat: GameSeat, fleet: BsFleet, automatic: boolean, now: number = Date.now(),
): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'placing') return { success: false, reason: 'Placement is over' };
  if (!battleshipSeats(game).includes(seat)) return { success: false, reason: 'Only players in this match can place ships.' };
  if (game.fleets[seat]) return { success: false, reason: 'Fleet already placed' };
  const error = bsFleetError(fleet, game.options);
  if (error) return { success: false, reason: error };
  if (!automatic && now >= game.placeDeadline) return { success: false, reason: 'The placement time is over' };

  game.fleets = { ...game.fleets, [seat]: fleet.map(({ cell, vertical }) => ({ cell, vertical })) };
  if (automatic && !game.players[seat]?.isBot && !game.autoPlaced.includes(seat)) {
    game.autoPlaced = battleshipSeats(game).filter((other) => other === seat || game.autoPlaced.includes(other));
  }
  if (pendingSeats(game).length === 0) {
    game.phase = 'playing';
    game.currentTurnSeat = battleshipSeats(game)[0];
  }
  return { success: true };
}

/** The log entry a shot at `cell` makes against `fleet`, already shot at `previous`. */
export function shotEntry(
  seat: GameSeat, fleet: BsFleet, previous: readonly number[], cell: number, timestamp: number,
): BattleshipShot {
  const shot = bsResolveShot(fleet, previous, cell);
  return {
    seat, to: bsNode(cell), result: shot.outcome,
    ...shot.ship ? { ship: shot.ship, sunkCells: shot.cells!.map(bsNode) } : {},
    timestamp,
  };
}

/** The seat that shoots after `entry`: the same one after a hit when the room allows another shot. */
export function nextShooter(seats: readonly GameSeat[], entry: BattleshipShot, options: BattleshipOptions): GameSeat {
  return options.hitAgain && entry.result !== 'miss' ? entry.seat : seats.find((seat) => seat !== entry.seat)!;
}

/**
 * Fires the seat's shot on its turn at a cell of the opponent's sea it has not shot before. The match ends
 * when the opponent's last ship sinks.
 */
export function fire(roomCode: RoomCode, seat: GameSeat, to: string, now: number = Date.now()): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: game.phase === 'placing' ? 'Placement is not finished' : 'The game is over' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  const opponent = battleshipOpponent(game, seat);
  const cell = bsCell(to);
  const fleet = opponent ? game.fleets[opponent] : null;
  if (!fleet || cell === null) return { success: false, reason: 'Illegal shot' };
  const previous = shotsBy(game.log, seat);
  if (previous.includes(cell)) return { success: false, reason: 'That cell was already shot' };

  const entry = shotEntry(seat, fleet, previous, cell, now);
  game.log.push(entry);
  game.drawOffer = afterBoardMove(game.drawOffer, seat);
  if (entry.result === 'sunk' && bsFleetSunk(fleet, [...previous, cell])) finish(game, { winners: [seat], reason: 'fleet-sunk' });
  else game.currentTurnSeat = nextShooter(battleshipSeats(game), entry, game.options);
  return { success: true };
}

/** Resignation; it never moves the turn or its clock. Resigning also works while placing. */
export function control(roomCode: RoomCode, seat: GameSeat, action: MatchControlAction): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase === 'scoring') return { success: false, reason: 'The game is over' };
  const seats = battleshipSeats(game);
  const applied = applyMatchControl(game.drawOffer, seat, action, battleshipDefinition.matchControls!, {
    seats, turnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
  });
  if (typeof applied === 'string') return { success: false, reason: applied };
  game.drawOffer = applied.state;
  if (applied.effect?.kind === 'resigned') finish(game, resignationOutcome(applied.effect.seat, seats));
  else if (applied.effect?.kind === 'agreed-draw') finish(game, { winners: [], reason: 'agreed-draw' });
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** Submitted fleets that `reveal` allows, copied so the view never shares stored objects. */
function visibleFleets(game: BattleshipGameState, reveal: (seat: GameSeat) => boolean): Partial<Record<GameSeat, BsFleet>> {
  return Object.fromEntries(battleshipSeats(game).flatMap((seat) => {
    const fleet = game.fleets[seat];
    return fleet && reveal(seat) ? [[seat, structuredClone(fleet)]] : [];
  }));
}

/**
 * The seat sees its own fleet and, once the match is over, the opponent's; the opponent's fleet otherwise
 * never leaves the server. Shot results are public in the log.
 */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): BattleshipVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  const seats = battleshipSeats(game);
  return {
    gameType: 'battleship',
    phase: game.phase,
    mySeat: seat,
    seats,
    options: game.options,
    placeDeadline: game.placeDeadline,
    placed: seats.filter((other) => Boolean(game.fleets[other])),
    autoPlaced: game.autoPlaced,
    fleets: visibleFleets(game, (owner) => game.phase === 'scoring' || owner === seat),
    currentTurnSeat: game.currentTurnSeat,
    drawOffer: game.drawOffer,
    log: game.log,
    result: game.result,
  };
}

/** God view for unseated spectators: every submitted fleet. */
export function withObserverView(
  visible: BattleshipVisibleState, game: BattleshipGameState, observer: ObserverRole,
): BattleshipVisibleState {
  return { ...visible, observer, fleets: visibleFleets(game, () => true) };
}

export function getGameState(roomCode: RoomCode): BattleshipGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): BattleshipGameState[] {
  return [...games.values()];
}

export function restoreGames(records: BattleshipGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
