// ─── Go Game: two seats alternate stones; two passes (or the move cap) open the marking of dead stones, then the area count ───

import { randomUUID } from 'node:crypto';
import type { GameSeat, GoGameState, GoMatchResult, GoMoveRecord, GoVisibleState, PlayerInfo, RoomCode } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  DEFAULT_GO_OPTIONS, goInitialPosition, goMoveError, goMoveLimit, goNode, goPlay, goPlayEnd, goPointOfNode, goScore,
  goToggleDead,
} from '@shared/rules/go';
import type { GoOptions, GoPosition, GoSide } from '@shared/rules/go';
import { goMovesOfLog, goReplayLog, goSideOfSeatIndex } from '@shared/rules/go-match';
import { goEstimateDead } from '@shared/rules/go-ownership';
import { resignationOutcome } from '@shared/rules/board/board-result';
import { NO_DRAW_OFFER, afterBoardMove, applyMatchControl } from '@shared/rules/board/match-controls';
import type { MatchControlAction } from '@shared/rules/board/match-controls';
import { goDefinition } from '@shared/games/go/definition';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → GoGameState */
const games: Map<RoomCode, GoGameState> = new Map();

/** The two seats in play order: the first plays black. */
export function goSeats(game: Pick<GoGameState, 'players'>): GameSeat[] {
  return occupiedSeats(game.players);
}

/** The seat's side, or null for a seat outside the match. */
export function goSideOfSeat(game: Pick<GoGameState, 'players'>, seat: GameSeat): GoSide | null {
  return goSideOfSeatIndex(goSeats(game).indexOf(seat));
}

/** The seat that plays a side. */
const seatOfSide = (game: Pick<GoGameState, 'players'>, side: GoSide): GameSeat => goSeats(game)[side];

export function startGame(
  roomCode: RoomCode, players: Partial<Record<GameSeat, PlayerInfo>>, options: GoOptions = DEFAULT_GO_OPTIONS,
  now: number = Date.now(),
): void {
  const seats = occupiedSeats(players);
  const opening = goInitialPosition(options);
  games.set(roomCode, {
    gameType: 'go',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    options: { ...options },
    phase: 'playing',
    stones: [...opening.stones],
    captures: [0, 0],
    passes: 0,
    resumes: [],
    // With a handicap white moves first.
    currentTurnSeat: seats[opening.toMove],
    markDeadline: 0,
    dead: [],
    confirmed: [],
    drawOffer: NO_DRAW_OFFER,
    log: [],
    result: null,
  });
}

/** The rules position behind a game's stored fields. */
export function positionOf(game: GoGameState): GoPosition {
  const opening = goInitialPosition(game.options);
  return {
    ...opening,
    stones: game.stones,
    toMove: goSideOfSeat(game, game.currentTurnSeat) ?? 0,
    captures: game.captures,
    passes: game.passes,
    moves: game.log.length,
  };
}

/** Seats that have not accepted the current marking yet, in play order. */
export function pendingSeats(game: GoGameState): GameSeat[] {
  return game.phase === 'marking' ? goSeats(game).filter((seat) => !game.confirmed.includes(seat)) : [];
}

/** Closes the match; `scored` carries the area count of a counted match. */
function finish(
  game: GoGameState, winners: readonly GameSeat[], reason: GoMatchResult['reason'], scored: ReturnType<typeof goScore> | null,
): void {
  const seats = goSeats(game);
  game.result = {
    gameType: 'go',
    seats,
    options: { ...game.options },
    moves: game.log.length,
    captured: { [seats[0]]: game.captures[0], [seats[1]]: game.captures[1] },
    dead: scored ? [...game.dead] : [],
    area: scored ? { [seats[0]]: scored.area[0], [seats[1]]: scored.area[1] } : {},
    komi: positionOf(game).komi,
    margin: scored?.margin ?? 0,
    winners: [...winners],
    reason,
  };
  game.phase = 'scoring';
  game.markDeadline = 0;
  game.dead = [];
  game.confirmed = [];
}

/** Opens the marking window after play ended, with the server's estimate of the dead stones. */
function beginMarking(game: GoGameState, markMs: number, now: number): void {
  game.phase = 'marking';
  game.markDeadline = now + markMs;
  game.dead = goEstimateDead(positionOf(game));
  game.confirmed = [];
}

/** Commits a move result to the game and passes the turn, opening the marking when play ended. */
function commit(game: GoGameState, seat: GameSeat, record: GoMoveRecord, position: GoPosition, markMs: number): void {
  game.log.push(record);
  game.stones = [...position.stones];
  game.captures = [position.captures[0], position.captures[1]];
  game.passes = position.passes;
  game.currentTurnSeat = seatOfSide(game, position.toMove);
  game.drawOffer = afterBoardMove(game.drawOffer, seat);
  if (goPlayEnd(position) !== null) beginMarking(game, markMs, record.timestamp);
}

const MOVE_ERRORS = {
  outside: 'Illegal move',
  occupied: 'That point is taken',
  suicide: 'Suicide is not allowed',
  superko: 'Ko: that repeats an earlier position',
  over: 'The game is over',
} as const;

function playingGame(roomCode: RoomCode, seat: GameSeat): GoGameState | string {
  const game = games.get(roomCode);
  if (!game) return 'Game not found';
  if (game.phase === 'marking') return 'The dead stones are being marked';
  if (game.phase !== 'playing') return 'The game is over';
  return game.currentTurnSeat === seat ? game : 'Not your turn';
}

/** Lays a stone for the seat on its turn. */
export function place(roomCode: RoomCode, seat: GameSeat, to: string, markMs: number, now: number = Date.now()): Result {
  const game = playingGame(roomCode, seat);
  if (typeof game === 'string') return { success: false, reason: game };
  const point = goPointOfNode(game.options.size, to);
  const moves = goMovesOfLog(game.options.size, game.log);
  const replay = moves && goReplayLog(game.options, moves, game.resumes);
  if (point === null || !replay) return { success: false, reason: 'Illegal move' };
  const position = positionOf(game);
  const error = goMoveError(position, point, replay.history);
  if (error !== null) return { success: false, reason: MOVE_ERRORS[error] };
  const played = goPlay(position, point, replay.history)!;
  const captured = played.captured.length;
  commit(game, seat, {
    seat, to: goNode(game.options.size, point), ...captured > 0 ? { capture: true, captured } : {}, timestamp: now,
  }, played.position, markMs);
  return { success: true };
}

/** Passes for the seat on its turn; the second pass in a row ends play. */
export function pass(roomCode: RoomCode, seat: GameSeat, markMs: number, now: number = Date.now()): Result {
  const game = playingGame(roomCode, seat);
  if (typeof game === 'string') return { success: false, reason: game };
  const played = goPlay(positionOf(game), 'pass', []);
  if (!played) return { success: false, reason: 'The game is over' };
  commit(game, seat, { seat, timestamp: now }, played.position, markMs);
  return { success: true };
}

function markingGame(roomCode: RoomCode, seat: GameSeat, automatic: boolean, now: number): GoGameState | string {
  const game = games.get(roomCode);
  if (!game) return 'Game not found';
  if (game.phase !== 'marking') return game.phase === 'playing' ? 'Play is still going on' : 'The game is over';
  if (goSideOfSeat(game, seat) === null) return 'Only players in this match can do that.';
  return !automatic && now >= game.markDeadline ? 'The marking time is over' : game;
}

/** Marks or unmarks the whole chain at a point as dead; any change withdraws both confirmations. */
export function toggleDead(roomCode: RoomCode, seat: GameSeat, to: string, automatic: boolean, now: number = Date.now()): Result {
  const game = markingGame(roomCode, seat, automatic, now);
  if (typeof game === 'string') return { success: false, reason: game };
  const point = goPointOfNode(game.options.size, to);
  if (point === null || game.stones[point] === null) return { success: false, reason: 'There is no stone there' };
  game.dead = goToggleDead(game.options.size, game.stones, game.dead, point);
  game.confirmed = [];
  return { success: true };
}

/** Accepts the dead stones the seat saw; the count follows once both seats have accepted. */
export function confirmScore(
  roomCode: RoomCode, seat: GameSeat, dead: readonly number[], automatic: boolean, now: number = Date.now(),
): Result {
  const game = markingGame(roomCode, seat, automatic, now);
  if (typeof game === 'string') return { success: false, reason: game };
  if (game.confirmed.includes(seat)) return { success: false, reason: 'Already confirmed' };
  if (dead.length !== game.dead.length || dead.some((point, index) => point !== game.dead[index])) {
    return { success: false, reason: 'The marking changed' };
  }
  game.confirmed = goSeats(game).filter((other) => other === seat || game.confirmed.includes(other));
  if (pendingSeats(game).length > 0) return { success: true };
  const position = positionOf(game);
  const scored = goScore(game.options.size, game.stones, game.dead, position.komi);
  finish(game, [seatOfSide(game, scored.winner)], goPlayEnd(position) === 'move-limit' ? 'move-limit' : 'score', scored);
  return { success: true };
}

/** Sends the count back to play. The seat that did not pass last moves next; the move cap cannot be resumed. */
export function resume(roomCode: RoomCode, seat: GameSeat, automatic: boolean, now: number = Date.now()): Result {
  const game = markingGame(roomCode, seat, automatic, now);
  if (typeof game === 'string') return { success: false, reason: game };
  if (game.log.length >= goMoveLimit(game.options.size)) return { success: false, reason: 'The move limit is reached' };
  game.phase = 'playing';
  game.passes = 0;
  game.resumes = [...game.resumes, game.log.length];
  game.markDeadline = 0;
  game.dead = [];
  game.confirmed = [];
  return { success: true };
}

/** Resignation; it never moves the turn or its clock and is allowed while marking too. */
export function control(roomCode: RoomCode, seat: GameSeat, action: MatchControlAction): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase === 'scoring') return { success: false, reason: 'The game is over' };
  const seats = goSeats(game);
  const applied = applyMatchControl(game.drawOffer, seat, action, goDefinition.matchControls!, {
    seats, turnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
  });
  if (typeof applied === 'string') return { success: false, reason: applied };
  game.drawOffer = applied.state;
  if (applied.effect?.kind === 'resigned') {
    const outcome = resignationOutcome(applied.effect.seat, seats);
    finish(game, outcome.winners, outcome.reason, null);
  }
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** The whole position is public, so every seat and spectator gets the same view. */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): GoVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'go',
    phase: game.phase,
    mySeat: seat,
    seats: goSeats(game),
    options: game.options,
    stones: game.stones,
    captures: game.captures,
    passes: game.passes,
    resumes: game.resumes,
    currentTurnSeat: game.currentTurnSeat,
    markDeadline: game.markDeadline,
    dead: game.dead,
    confirmed: game.confirmed,
    drawOffer: game.drawOffer,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): GoGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): GoGameState[] {
  return [...games.values()];
}

export function restoreGames(records: GoGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
