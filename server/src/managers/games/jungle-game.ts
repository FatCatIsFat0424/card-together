// ─── Jungle Game: two seats alternate moves until a den is entered, a side is out of moves, or the draw rule hits ───

import { randomUUID } from 'node:crypto';
import type {
  GameSeat, JungleGameState, JungleMatchResult, JungleMove, JungleVisibleState, PlayerInfo, RoomCode,
} from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  jgApply, jgBoardOutcome, jgCell, jgInitialCells, jgIsLegal, jgNode, jgOutcome, jgPieceCount, jgQuietPlies, jgRankOf,
} from '@shared/rules/jungle';
import type { JgSide } from '@shared/rules/jungle';
import { resignationOutcome } from '@shared/rules/board/board-result';
import type { BoardOutcome } from '@shared/rules/board/board-result';
import { NO_DRAW_OFFER, afterBoardMove, applyMatchControl } from '@shared/rules/board/match-controls';
import type { MatchControlAction } from '@shared/rules/board/match-controls';
import { jungleDefinition } from '@shared/games/jungle/definition';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → JungleGameState */
const games: Map<RoomCode, JungleGameState> = new Map();

/** The two seats in play order: the first plays side 0 and moves first. */
export function jungleSeats(game: Pick<JungleGameState, 'players'>): GameSeat[] {
  return occupiedSeats(game.players);
}

export function startGame(roomCode: RoomCode, players: Partial<Record<GameSeat, PlayerInfo>>, now: number = Date.now()): void {
  const seats = occupiedSeats(players);
  games.set(roomCode, {
    gameType: 'jungle',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    cells: jgInitialCells(),
    currentTurnSeat: seats[0],
    drawOffer: NO_DRAW_OFFER,
    log: [],
    result: null,
  });
}

function sideOf(game: JungleGameState, seat: GameSeat): JgSide {
  return jungleSeats(game).indexOf(seat) === 0 ? 0 : 1;
}

/** Closes the match with the given outcome and the board as it stands. */
function finish(game: JungleGameState, outcome: BoardOutcome): void {
  const seats = jungleSeats(game);
  const result: JungleMatchResult = {
    gameType: 'jungle',
    seats,
    pieces: { [seats[0]]: jgPieceCount(game.cells, 0), [seats[1]]: jgPieceCount(game.cells, 1) },
    moves: game.log.length,
    winners: [...outcome.winners],
    reason: outcome.reason,
  };
  game.phase = 'scoring';
  game.result = result;
}

/** Moves a piece for the seat on its turn, then passes the turn or ends the match. */
export function move(roomCode: RoomCode, seat: GameSeat, fromNode: string, toNode: string, now: number = Date.now()): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  const from = jgCell(fromNode);
  const to = jgCell(toNode);
  const side = sideOf(game, seat);
  if (from === null || to === null || !jgIsLegal(game.cells, from, to, side)) return { success: false, reason: 'Illegal move' };

  const captured = game.cells[to] === 0 ? null : jgRankOf(game.cells[to]);
  const entry: JungleMove = {
    seat, from: jgNode(from), to: jgNode(to), piece: jgRankOf(game.cells[from]), capture: captured !== null,
    ...captured === null ? {} : { captured }, timestamp: now,
  };
  game.cells = jgApply(game.cells, { from, to });
  game.log.push(entry);
  game.drawOffer = afterBoardMove(game.drawOffer, seat);

  const seats = jungleSeats(game);
  const outcome = jgOutcome(game.cells, side, to, jgQuietPlies(game.log));
  if (outcome) finish(game, jgBoardOutcome(outcome, seats));
  else game.currentTurnSeat = seats[side === 0 ? 1 : 0];
  return { success: true };
}

/** Resignation and draw offers; they never move the turn or its clock. */
export function control(roomCode: RoomCode, seat: GameSeat, action: MatchControlAction): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  const seats = jungleSeats(game);
  const applied = applyMatchControl(game.drawOffer, seat, action, jungleDefinition.matchControls!, {
    seats, turnSeat: game.currentTurnSeat,
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

/** The whole position is public, so every seat and spectator gets the same view. */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): JungleVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'jungle',
    phase: game.phase,
    mySeat: seat,
    seats: jungleSeats(game),
    cells: game.cells,
    currentTurnSeat: game.currentTurnSeat,
    drawOffer: game.drawOffer,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): JungleGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): JungleGameState[] {
  return [...games.values()];
}

export function restoreGames(records: JungleGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
