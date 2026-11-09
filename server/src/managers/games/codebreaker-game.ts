// ─── Code Breaker Game: one shared secret, simultaneous guess rounds, private feedback ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  CodeBreakerGameState, CodeBreakerGuess, CodeBreakerProgress, CodeBreakerVisibleState,
  GameSeat, ObserverRole, PlayerInfo, RoomCode,
} from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  CB_MAX_GUESSES, cbFeedback, cbRandomCode, cbSolved, cbWinners, isCbCode,
} from '@shared/rules/codebreaker';
import type { CodeBreakerOptions } from '@shared/rules/codebreaker';

type Result = { success: true } | { success: false; reason: string };

/** The secret must stay unpredictable, so it never comes from a seeded or room-derived generator. */
const RANDOM_RANGE = 2 ** 32;
const secureRandom = (): number => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

/** roomCode → CodeBreakerGameState */
const games: Map<RoomCode, CodeBreakerGameState> = new Map();

/** The seats playing, ordered N, E, S, W, P5–P8. */
export function codeBreakerSeats(game: Pick<CodeBreakerGameState, 'players'>): GameSeat[] {
  return occupiedSeats(game.players);
}

/** Resolved guesses of one seat in round order. */
export function guessesOf(game: Pick<CodeBreakerGameState, 'log'>, seat: GameSeat): CodeBreakerGuess[] {
  return game.log.filter((entry) => entry.seat === seat).map(({ round, code, exact, partial, auto }) => ({
    round, code: [...code], exact, partial, auto,
  }));
}

export function hasSolved(game: Pick<CodeBreakerGameState, 'log'>, seat: GameSeat): boolean {
  return game.log.some((entry) => entry.seat === seat && entry.solved);
}

/** Seats that still owe guesses: not solved and under the guess cap. */
export function activeSeats(game: Pick<CodeBreakerGameState, 'players' | 'log'>): GameSeat[] {
  return codeBreakerSeats(game).filter((seat) => !hasSolved(game, seat)
    && game.log.filter((entry) => entry.seat === seat).length < CB_MAX_GUESSES);
}

/** Active seats that have not submitted this round, in seat order. */
export function pendingSeats(game: CodeBreakerGameState): GameSeat[] {
  return game.phase === 'playing' ? activeSeats(game).filter((seat) => !game.pending[seat]) : [];
}

/** `random` is a test hook; the secret is otherwise drawn from the operating system. */
export function startGame(
  roomCode: RoomCode, players: Partial<Record<GameSeat, PlayerInfo>>, options: CodeBreakerOptions, roundMs: number,
  now: number = Date.now(), random: () => number = secureRandom,
): void {
  const seats = occupiedSeats(players);
  games.set(roomCode, {
    gameType: 'codebreaker',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    options: { ...options },
    phase: 'playing',
    secret: [...cbRandomCode(options.variant, random)],
    round: 1,
    roundMs,
    roundDeadline: now + roundMs,
    pending: Object.fromEntries(seats.map((seat) => [seat, null])),
    pendingAuto: [],
    log: [],
    result: null,
  });
}

function finish(game: CodeBreakerGameState): void {
  const seats = codeBreakerSeats(game);
  const finishes = seats.map((seat) => ({
    seat, guesses: game.log.filter((entry) => entry.seat === seat).length, solved: hasSolved(game, seat),
  }));
  game.phase = 'scoring';
  game.result = {
    gameType: 'codebreaker',
    seats,
    variant: game.options.variant,
    secret: [...game.secret],
    guesses: Object.fromEntries(finishes.map((entry) => [entry.seat, entry.guesses])),
    solved: finishes.filter((entry) => entry.solved).map((entry) => entry.seat),
    winners: cbWinners(finishes),
    rounds: game.round,
  };
}

/** Scores every held guess against the secret in seat order, then opens the next round or ends the match. */
function resolveRound(game: CodeBreakerGameState, now: number): void {
  for (const seat of codeBreakerSeats(game)) {
    const code = game.pending[seat];
    if (!code) continue;
    const feedback = cbFeedback(game.secret, code);
    game.log.push({
      seat, round: game.round, code: [...code], ...feedback, solved: cbSolved(feedback),
      auto: game.pendingAuto.includes(seat), timestamp: now,
    });
    game.pending[seat] = null;
  }
  game.pendingAuto = [];
  if (activeSeats(game).length === 0) {
    finish(game);
    return;
  }
  game.round += 1;
  game.roundDeadline = now + game.roundMs;
}

/**
 * One guess per seat and round, held until every active seat has guessed. `automatic` marks server-made
 * guesses, which are accepted past the deadline.
 */
export function guess(
  roomCode: RoomCode, seat: GameSeat, code: readonly number[], automatic: boolean, now: number = Date.now(),
): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  if (!codeBreakerSeats(game).includes(seat)) return { success: false, reason: 'Only players in this match can guess.' };
  if (!activeSeats(game).includes(seat)) return { success: false, reason: 'You have no guesses left to make.' };
  if (game.pending[seat]) return { success: false, reason: 'You already guessed this round' };
  if (!isCbCode(code, game.options.variant)) return { success: false, reason: 'Invalid guess' };
  if (!automatic && now >= game.roundDeadline) return { success: false, reason: 'The round time is over' };

  game.pending[seat] = [...code];
  if (automatic && !game.players[seat]?.isBot) game.pendingAuto = [...game.pendingAuto, seat];
  if (pendingSeats(game).length === 0) resolveRound(game, now);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

function progressOf(game: CodeBreakerGameState, seat: GameSeat): CodeBreakerProgress {
  return {
    used: game.log.filter((entry) => entry.seat === seat).length,
    solved: hasSolved(game, seat),
    submitted: Boolean(game.pending[seat]),
  };
}

function histories(game: CodeBreakerGameState, reveal: (seat: GameSeat) => boolean): Partial<Record<GameSeat, CodeBreakerGuess[]>> {
  return Object.fromEntries(codeBreakerSeats(game).filter(reveal).map((seat) => [seat, guessesOf(game, seat)]));
}

function viewOf(
  game: CodeBreakerGameState, seat: GameSeat, revealAll: boolean,
): Omit<CodeBreakerVisibleState, 'observer'> {
  const seats = codeBreakerSeats(game);
  const over = game.phase === 'scoring';
  return {
    gameType: 'codebreaker',
    phase: game.phase,
    mySeat: seat,
    seats,
    options: game.options,
    round: game.round,
    roundDeadline: game.roundDeadline,
    progress: Object.fromEntries(seats.map((other) => [other, progressOf(game, other)])),
    pendingGuess: game.pending[seat] ? [...game.pending[seat]!] : null,
    histories: histories(game, (other) => revealAll || over || other === seat),
    secret: revealAll || over ? [...game.secret] : null,
    // The public log names who guessed when and who cracked the code, never the guesses.
    log: game.log.map(({ seat: guesser, round, solved, timestamp }) => ({ seat: guesser, round, solved, timestamp })),
    result: game.result,
  };
}

/**
 * The seat sees its own resolved guesses and feedback and, once the match is over, everyone's with the secret.
 * Other seats show only guesses used, solved, and submitted flags.
 */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): CodeBreakerVisibleState | null {
  const game = games.get(roomCode);
  return game ? viewOf(game, seat, false) : null;
}

/** God view for unseated spectators: the secret and every seat's guesses. */
export function withObserverView(
  visible: CodeBreakerVisibleState, game: CodeBreakerGameState, observer: ObserverRole,
): CodeBreakerVisibleState {
  return { ...visible, ...viewOf(game, visible.mySeat, true), observer };
}

export function getGameState(roomCode: RoomCode): CodeBreakerGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): CodeBreakerGameState[] {
  return [...games.values()];
}

export function restoreGames(records: CodeBreakerGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}

