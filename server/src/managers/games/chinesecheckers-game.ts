// ─── Chinese checkers Game: 2, 3, 4, or 6 seats race their marbles to the opposite corner ───

import { randomUUID } from 'node:crypto';
import type {
  ChineseCheckersGameState, ChineseCheckersMatchResult, ChineseCheckersMove, ChineseCheckersVisibleState, GameSeat,
  PlayerInfo, RoomCode,
} from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  CC_TURN_LIMIT, ccApply, ccArrived, ccCorners, ccFindMove, ccFinished, ccHasMove, ccIndex, ccInitialHoles, ccNode,
  ccRanks, ccRemaining,
} from '@shared/rules/chinesecheckers';
import { resignationOutcome } from '@shared/rules/board/board-result';
import type { BoardOutcome } from '@shared/rules/board/board-result';
import { NO_DRAW_OFFER, afterBoardMove, applyMatchControl } from '@shared/rules/board/match-controls';
import type { MatchControlAction } from '@shared/rules/board/match-controls';
import { chineseCheckersDefinition } from '@shared/games/chinesecheckers/definition';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → ChineseCheckersGameState */
const games: Map<RoomCode, ChineseCheckersGameState> = new Map();

/** The seats in play order: N, E, S, W, P5, P6 among the occupied ones. */
export function chineseCheckersSeats(game: Pick<ChineseCheckersGameState, 'players'>): GameSeat[] {
  return occupiedSeats(game.players);
}

/** Home corner per seat in play order; empty for an unsupported player count. */
export function chineseCheckersCorners(game: Pick<ChineseCheckersGameState, 'players'>): readonly number[] {
  return ccCorners(chineseCheckersSeats(game).length) ?? [];
}

function cornerOf(game: ChineseCheckersGameState, seat: GameSeat): number {
  return chineseCheckersCorners(game)[chineseCheckersSeats(game).indexOf(seat)];
}

/** A fresh match, or null when the seats are not a supported player count. */
export function newChineseCheckersGame(
  roomCode: RoomCode, players: Partial<Record<GameSeat, PlayerInfo>>, now: number, id: string = randomUUID(),
): ChineseCheckersGameState | null {
  const seats = occupiedSeats(players);
  const corners = ccCorners(seats.length);
  if (!corners) return null;
  return {
    gameType: 'chinesecheckers',
    id,
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    holes: ccInitialHoles(corners),
    currentTurnSeat: seats[0],
    drawOffer: NO_DRAW_OFFER,
    resigned: [],
    log: [],
    result: null,
  };
}

export function startGame(roomCode: RoomCode, players: Partial<Record<GameSeat, PlayerInfo>>, now: number = Date.now()): Result {
  const game = newChineseCheckersGame(roomCode, players, now);
  if (!game) return { success: false, reason: 'Chinese checkers needs 2, 3, 4, or 6 players.' };
  games.set(roomCode, game);
  return { success: true };
}

/** Turns a seat has taken: its moves and automatic passes. */
function turnsTaken(game: ChineseCheckersGameState, seat: GameSeat): number {
  return game.log.filter((entry) => entry.seat === seat && !entry.resigned).length;
}

const isMove = (entry: ChineseCheckersMove): boolean => entry.to !== undefined;

/** Closes the match: places from the outcome, then progress, with resigned seats last. Validation replays it too. */
export function finish(game: ChineseCheckersGameState, outcome: BoardOutcome): void {
  const seats = chineseCheckersSeats(game);
  const corners = chineseCheckersCorners(game);
  const playing = seats.filter((seat) => !game.resigned.includes(seat));
  const remaining: Partial<Record<GameSeat, number>> = {};
  const arrived: Partial<Record<GameSeat, number>> = {};
  const cornerMap: Partial<Record<GameSeat, number>> = {};
  seats.forEach((seat, index) => {
    cornerMap[seat] = corners[index];
    if (!playing.includes(seat)) return;
    remaining[seat] = ccRemaining(game.holes, corners[index]);
    arrived[seat] = ccArrived(game.holes, corners[index]);
  });
  // A draw shares first place; otherwise the winners lead and the rest follow their progress.
  const ranks = outcome.winners.length === 0
    ? Object.fromEntries(seats.map((seat) => [seat, 1]))
    : ccRanks(seats, remaining, outcome.winners, game.resigned);
  const result: ChineseCheckersMatchResult = {
    gameType: 'chinesecheckers',
    seats,
    corners: cornerMap,
    remaining,
    arrived,
    ranks,
    moves: game.log.filter(isMove).length,
    winners: [...outcome.winners],
    reason: outcome.reason,
  };
  game.phase = 'scoring';
  game.result = result;
}

/** Ends play on progress: the seats with the least distance left share the win, or all of them draw. */
function finishByProgress(game: ChineseCheckersGameState, reason: 'move-limit' | 'no-moves'): void {
  const seats = chineseCheckersSeats(game);
  const playing = seats.filter((seat) => !game.resigned.includes(seat));
  const left = (seat: GameSeat): number => ccRemaining(game.holes, cornerOf(game, seat));
  const best = Math.min(...playing.map(left));
  const leaders = playing.filter((seat) => left(seat) === best);
  finish(game, { winners: leaders.length === seats.length ? [] : leaders, reason });
}

/**
 * Hands the turn to the next seat still playing after `from`. A seat with every marble blocked passes (logged
 * automatically); the match ends on progress when every seat is blocked or the next seat has used its turns.
 */
function passTurn(game: ChineseCheckersGameState, from: GameSeat, now: number): void {
  const seats = chineseCheckersSeats(game);
  const playing = seats.filter((seat) => !game.resigned.includes(seat));
  if (playing.length === 1) {
    finish(game, { winners: playing, reason: 'resign' });
    return;
  }
  let index = seats.indexOf(from);
  for (let blocked = 0; blocked < playing.length;) {
    index = (index + 1) % seats.length;
    const seat = seats[index];
    if (game.resigned.includes(seat)) continue;
    if (turnsTaken(game, seat) >= CC_TURN_LIMIT) {
      finishByProgress(game, 'move-limit');
      return;
    }
    if (ccHasMove(game.holes, cornerOf(game, seat))) {
      game.currentTurnSeat = seat;
      return;
    }
    game.log.push({ seat, timestamp: now });
    blocked++;
  }
  finishByProgress(game, 'no-moves');
}

/**
 * The seat a move just won for: the mover when its target is complete, else the first other seat still playing
 * (in turn order) whose target the move completed, since a marble dropped into a rival's last empty hole gives
 * the rival the win. `settleRivals` is false only when replaying a match stored before rivals were settled.
 */
function finishedSeat(game: ChineseCheckersGameState, mover: GameSeat, settleRivals: boolean): GameSeat | null {
  if (ccFinished(game.holes, cornerOf(game, mover))) return mover;
  if (!settleRivals) return null;
  const seats = chineseCheckersSeats(game);
  const start = seats.indexOf(mover);
  for (let step = 1; step < seats.length; step++) {
    const seat = seats[(start + step) % seats.length];
    if (!game.resigned.includes(seat) && ccFinished(game.holes, cornerOf(game, seat))) return seat;
  }
  return null;
}

/**
 * Moves a marble of the seat on turn to `to` by a step or the shortest jump chain the server finds, then
 * ends the match if the move completed a target (the mover's, or a rival's that it filled) or hands the turn on.
 * Passes and resignations never complete a target: a move fills one hole, and a resignation only empties holes.
 */
export function applyMove(
  game: ChineseCheckersGameState, seat: GameSeat, from: string, to: string, now: number, settleRivals: boolean = true,
): Result {
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  const start = ccIndex(from);
  const end = ccIndex(to);
  const corner = cornerOf(game, seat);
  const found = start === null || end === null ? null : ccFindMove(game.holes, corner, start, end);
  if (start === null || end === null || !found) return { success: false, reason: 'Illegal move' };

  game.holes = ccApply(game.holes, start, end);
  game.log.push({
    seat, from: ccNode(start), to: ccNode(end),
    ...found.path.length > 0 ? { path: found.path.map(ccNode) } : {},
    ...found.jump ? { jump: true as const } : {},
    timestamp: now,
  });
  game.drawOffer = afterBoardMove(game.drawOffer, seat);
  const winner = finishedSeat(game, seat, settleRivals);
  if (winner) finish(game, { winners: [winner], reason: 'all-home' });
  else passTurn(game, seat, now);
  return { success: true };
}

/**
 * A seat leaving a match of three or more: its marbles leave the board, it takes no more turns, and the
 * others play on. The last seat left wins.
 */
export function applyResignation(game: ChineseCheckersGameState, seat: GameSeat, now: number): void {
  const corner = cornerOf(game, seat);
  game.holes = game.holes.map((hole) => (hole === corner ? null : hole));
  game.resigned = [...game.resigned, seat];
  game.log.push({ seat, resigned: true, timestamp: now });
  if (game.currentTurnSeat === seat) {
    passTurn(game, seat, now);
    return;
  }
  const playing = chineseCheckersSeats(game).filter((other) => !game.resigned.includes(other));
  if (playing.length === 1) finish(game, { winners: playing, reason: 'resign' });
}

export function move(roomCode: RoomCode, seat: GameSeat, from: string, to: string, now: number = Date.now()): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  return applyMove(game, seat, from, to, now);
}

/** Whether resigning now hands the turn to another seat, so the caller must settle the turn clock. */
export function resignationMovesTurn(roomCode: RoomCode, seat: GameSeat): boolean {
  const game = games.get(roomCode);
  return game !== undefined && game.phase === 'playing' && chineseCheckersSeats(game).length > 2
    && game.currentTurnSeat === seat;
}

/**
 * Resignation and draw offers. Two players: resigning loses and the opponent wins; draws follow the board kit.
 * Three or more: a resigning seat drops out and the rest play on; draw offers are unavailable.
 */
export function control(roomCode: RoomCode, seat: GameSeat, action: MatchControlAction, now: number = Date.now()): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  const seats = chineseCheckersSeats(game);
  if (game.resigned.includes(seat)) return { success: false, reason: 'You have already resigned.' };
  const applied = applyMatchControl(game.drawOffer, seat, action, chineseCheckersDefinition.matchControls!, {
    seats, turnSeat: game.currentTurnSeat,
  });
  if (typeof applied === 'string') return { success: false, reason: applied };
  game.drawOffer = applied.state;
  if (applied.effect?.kind === 'resigned') {
    if (seats.length === 2) finish(game, resignationOutcome(applied.effect.seat, seats));
    else applyResignation(game, applied.effect.seat, now);
  } else if (applied.effect?.kind === 'agreed-draw') {
    finish(game, { winners: [], reason: 'agreed-draw' });
  }
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** The whole position is public, so every seat and spectator gets the same view. */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): ChineseCheckersVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'chinesecheckers',
    phase: game.phase,
    mySeat: seat,
    seats: chineseCheckersSeats(game),
    corners: chineseCheckersCorners(game),
    holes: game.holes,
    currentTurnSeat: game.currentTurnSeat,
    drawOffer: game.drawOffer,
    resigned: game.resigned,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): ChineseCheckersGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): ChineseCheckersGameState[] {
  return [...games.values()];
}

export function restoreGames(records: ChineseCheckersGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
