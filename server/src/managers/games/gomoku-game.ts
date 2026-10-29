// ─── Gomoku Game: two seats alternate stones until five in a row, a full board, or an agreed result ───

import { randomUUID } from 'node:crypto';
import type {
  GameSeat, GomokuGameState, GomokuMatchResult, GomokuMove, GomokuVisibleState, PlayerInfo, RoomCode,
} from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  DEFAULT_GOMOKU_OPTIONS, gmBlackSeat, gmCell, gmHasMove, gmInitialStones, gmIsLegal, gmNode, gmPlacements,
  gmSeatToAct, gmSideOfStone, gmStage, gmStoneCount, gmWins,
} from '@shared/rules/gomoku';
import type { GomokuOptions } from '@shared/rules/gomoku';
import { resignationOutcome } from '@shared/rules/board/board-result';
import type { BoardOutcome } from '@shared/rules/board/board-result';
import { NO_DRAW_OFFER, afterBoardMove, applyMatchControl } from '@shared/rules/board/match-controls';
import type { MatchControlAction } from '@shared/rules/board/match-controls';
import { gomokuDefinition } from '@shared/games/gomoku/definition';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → GomokuGameState */
const games: Map<RoomCode, GomokuGameState> = new Map();

/** The two seats in seat order: the first lays the first stone. */
export function gomokuSeats(game: Pick<GomokuGameState, 'players'>): GameSeat[] {
  return occupiedSeats(game.players);
}

export function startGame(
  roomCode: RoomCode, players: Partial<Record<GameSeat, PlayerInfo>>, options: GomokuOptions = DEFAULT_GOMOKU_OPTIONS,
  now: number = Date.now(),
): void {
  const seats = occupiedSeats(players);
  games.set(roomCode, {
    gameType: 'gomoku',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    options: { ...options },
    phase: 'playing',
    stones: gmInitialStones(),
    currentTurnSeat: seats[0],
    drawOffer: NO_DRAW_OFFER,
    log: [],
    result: null,
  });
}

/** Closes the match with the given outcome and the board as it stands. */
function finish(game: GomokuGameState, outcome: BoardOutcome): void {
  const seats = gomokuSeats(game);
  const result: GomokuMatchResult = {
    gameType: 'gomoku',
    seats,
    blackSeat: gmBlackSeat(seats, game.log),
    moves: gmStoneCount(game.stones),
    options: { ...game.options },
    winners: [...outcome.winners],
    reason: outcome.reason,
  };
  game.phase = 'scoring';
  game.result = result;
}

/**
 * Passes the turn after a committed action, or ends the match when the stone made a line, filled the board, or
 * left the next player with only forbidden points.
 */
function advance(game: GomokuGameState, placed: { index: number; side: 0 | 1 } | null): void {
  const seats = gomokuSeats(game);
  if (placed && gmWins(game.stones, placed.index, placed.side, game.options.renju)) {
    finish(game, { winners: [game.currentTurnSeat], reason: 'five-in-row' });
    return;
  }
  const next = gmSeatToAct(seats, game.options, game.log);
  const stage = gmStage(game.options, game.log);
  // Only a free move can run out of room: a full board, or Renju leaving black nothing legal.
  if (stage === 'playing' && !gmHasMove(game.stones, gmSideOfStone(gmPlacements(game.log)), game.options.renju)) {
    finish(game, { winners: [], reason: 'board-full' });
    return;
  }
  game.currentTurnSeat = next;
}

/** Lays a stone for the seat on its turn. */
export function place(roomCode: RoomCode, seat: GameSeat, to: string, now: number = Date.now()): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  if (gmStage(game.options, game.log) === 'choosing') return { success: false, reason: 'Choose a side first' };
  const index = gmCell(to);
  const side = gmSideOfStone(gmPlacements(game.log));
  if (index === null || !gmIsLegal(game.stones, index, side, game.options.renju)) {
    return { success: false, reason: index !== null && game.stones[index] === null ? 'Forbidden move' : 'Illegal move' };
  }

  game.stones[index] = side;
  const move: GomokuMove = { seat, to: gmNode(index), timestamp: now };
  game.log.push(move);
  game.drawOffer = afterBoardMove(game.drawOffer, seat);
  advance(game, { index, side });
  return { success: true };
}

/** Swap opening: the second seat takes black (swap) or keeps white; white then moves. */
export function chooseSide(roomCode: RoomCode, seat: GameSeat, swap: boolean, now: number = Date.now()): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  if (gmStage(game.options, game.log) !== 'choosing') return { success: false, reason: 'No side to choose' };
  game.log.push({ seat, swap, timestamp: now });
  game.drawOffer = afterBoardMove(game.drawOffer, seat);
  advance(game, null);
  return { success: true };
}

/** Resignation and draw offers; they never move the turn or its clock. */
export function control(roomCode: RoomCode, seat: GameSeat, action: MatchControlAction): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  const seats = gomokuSeats(game);
  const applied = applyMatchControl(game.drawOffer, seat, action, gomokuDefinition.matchControls!, {
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
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): GomokuVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'gomoku',
    phase: game.phase,
    mySeat: seat,
    seats: gomokuSeats(game),
    options: game.options,
    stones: game.stones,
    currentTurnSeat: game.currentTurnSeat,
    drawOffer: game.drawOffer,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): GomokuGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): GomokuGameState[] {
  return [...games.values()];
}

export function restoreGames(records: GomokuGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
