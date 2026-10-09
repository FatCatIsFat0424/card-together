// ─── Game Manager: facade dispatching by game type ───

import { advanceGameClock, initializeGameClock } from './game-clock';
import { randomUUID } from 'node:crypto';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { DEFAULT_TIME_CONTROL } from '@shared/time-control';
import type {
  AnyGameState,
  BidAction,
  BigTwoGameState,
  BridgeGameState,
  Card,
  GameType,
  NinetyNineGameState,
  PlayerInfo,
  PlayerVisibleGameState,
  RedPointsGameState,
  RoomCode,
  Seat,
  TimeControl,
} from '@shared/types';
import type { NnChoice } from '@shared/rules/ninetynine';
import * as bridge from './games/bridge-game';
import * as bigtwo from './games/bigtwo-game';
import * as redpoints from './games/redpoints-game';
import * as ninetynine from './games/ninetynine-game';

type Result = { success: true } | { success: false; reason: string };

const WRONG_GAME: Result = { success: false, reason: 'This action is not available in this game.' };

export function isPresentationActive(roomCode: RoomCode): boolean {
  const game = getGameState(roomCode);
  return game !== null && Date.now() < getPresentationEndsAt(game);
}

function presentAction(roomCode: RoomCode, operation: () => Result): Result {
  if (isPresentationActive(roomCode)) {
    return { success: false, reason: 'Please wait for the current action to finish.' };
  }
  const logStart = getGameState(roomCode)?.log.length ?? 0;
  const result = operation();
  const game = getGameState(roomCode);
  if (result.success && game) {
    game.presentation = { id: randomUUID(), startedAt: Date.now(), logStart, timingVersion: 2 };
    if (game.gameType === 'bigtwo') bigtwo.prepareAutoPass(roomCode, getPresentationEndsAt(game), autoPassMaxDelay(game));
  }
  return result;
}

/** Keeps a forced pass inside the public turn allowance so it never looks like a timeout. */
function autoPassMaxDelay(game: AnyGameState): number {
  return Math.min(bigtwo.AUTO_PASS_MAX_DELAY_MS, (game.clock?.settings ?? DEFAULT_TIME_CONTROL).baseSeconds * 1000);
}

function timedAction(roomCode: RoomCode, seat: Seat, operation: () => Result, automatic: boolean): Result {
  const game = getGameState(roomCode);
  const clock = game?.clock;
  const now = Date.now();
  if (!automatic && clock?.turn?.seat === seat && now >= clock.turn.deadline) {
    return { success: false, reason: 'Your turn has timed out. Please wait for the automatic action.' };
  }
  const hands = game?.hands;
  const redPointsPlay = game?.gameType === 'redpoints' && game.step === 'play';
  const forced = game?.gameType === 'bigtwo' && game.pendingAutoPass?.seat === seat;
  const result = operation();
  if (result.success && game && clock) {
    const sameTurn = redPointsPlay && game.gameType === 'redpoints' && game.step === 'flip-choose';
    const redealt = game.gameType === 'bridge' && game.hands !== hands;
    advanceGameClock(game, clock, sameTurn, redealt, now, forced);
  }
  return result;
}

export function initializeClock(roomCode: RoomCode, settings?: TimeControl): void {
  const game = getGameState(roomCode);
  if (game && !game.clock) initializeGameClock(game, settings);
}

/** Missing games fall through to the game handlers, which report them. */
function isGame(roomCode: RoomCode, gameType: GameType): boolean {
  return (getGameState(roomCode)?.gameType ?? gameType) === gameType;
}

export function startGame(
  roomCode: RoomCode,
  gameType: GameType,
  players: Record<Seat, PlayerInfo>,
  settings?: TimeControl,
): Result {
  // A finished board of another game type may still be waiting for game:continue.
  removeGame(roomCode);
  if (gameType === 'bigtwo') bigtwo.startGame(roomCode, players);
  else if (gameType === 'redpoints') redpoints.startGame(roomCode, players);
  else if (gameType === 'ninetynine') ninetynine.startGame(roomCode, players);
  else bridge.startGame(roomCode, players);
  const game = getGameState(roomCode);
  if (game?.phase === 'scoring') {
    game.presentation = { id: randomUUID(), startedAt: Date.now(), logStart: 0, timingVersion: 2 };
  }
  if (game) initializeGameClock(game, settings);
  return { success: true };
}

export function getPlayerVisibleState(roomCode: RoomCode, seat: Seat): PlayerVisibleGameState | null {
  const visible = bridge.getPlayerVisibleState(roomCode, seat) ?? bigtwo.getPlayerVisibleState(roomCode, seat)
    ?? redpoints.getPlayerVisibleState(roomCode, seat) ?? ninetynine.getPlayerVisibleState(roomCode, seat);
  if (!visible) return null;
  const game = getGameState(roomCode);
  const serverNow = Date.now();
  return { ...visible,
    ...(game?.presentation ? { presentation: { ...game.presentation, serverNow } } : {}),
    ...(game?.clock ? { clock: { ...game.clock, serverNow } } : {}),
  };
}

export function getGameState(roomCode: RoomCode): AnyGameState | null {
  return bridge.getGameState(roomCode) ?? bigtwo.getGameState(roomCode) ?? redpoints.getGameState(roomCode)
    ?? ninetynine.getGameState(roomCode);
}

/** Ends a game without a match record. */
export function abortGame(roomCode: RoomCode): void {
  bridge.abortGame(roomCode);
  bigtwo.abortGame(roomCode);
  redpoints.abortGame(roomCode);
  ninetynine.abortGame(roomCode);
}

export function removeGame(roomCode: RoomCode): void {
  abortGame(roomCode);
}

/** Lets one player leave the finished board; it is removed once every human has left. */
export function returnFromResult(roomCode: RoomCode, seat: Seat): void {
  const game = getGameState(roomCode);
  if (!game?.result) return;
  const returned = new Set([...(game.returnedSeats ?? []), seat]);
  const humans = SEAT_ORDER_CLOCKWISE.filter((value) => !game.players[value].isBot);
  if (humans.every((value) => returned.has(value))) removeGame(roomCode);
  else game.returnedSeats = SEAT_ORDER_CLOCKWISE.filter((value) => returned.has(value));
}

/** The finished board stays visible only to its own players until they return. */
export function isViewingGame(roomCode: RoomCode, seat: Seat, accountId: string): boolean {
  const game = getGameState(roomCode);
  return Boolean(game && game.players[seat].id === accountId && !game.returnedSeats?.includes(seat));
}

export function hasActiveGame(roomCode: RoomCode): boolean {
  return getGameState(roomCode) !== null;
}

export function exportGames(): AnyGameState[] {
  return [...bridge.exportGames(), ...bigtwo.exportGames(), ...redpoints.exportGames(),
    ...ninetynine.exportGames()];
}

export function restoreGames(records: AnyGameState[]): void {
  bridge.restoreGames(records.filter((game): game is BridgeGameState => game.gameType === 'bridge'));
  bigtwo.restoreGames(records.filter((game): game is BigTwoGameState => game.gameType === 'bigtwo'));
  redpoints.restoreGames(records.filter((game): game is RedPointsGameState => game.gameType === 'redpoints'));
  ninetynine.restoreGames(records.filter((game): game is NinetyNineGameState => game.gameType === 'ninetynine'));
}

export function handleRedealResponse(roomCode: RoomCode, seat: Seat, accept: boolean, automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'bridge') ? bridge.handleRedealResponse(roomCode, seat, accept) : WRONG_GAME, automatic);
}

export function handleBid(roomCode: RoomCode, seat: Seat, action: BidAction, automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'bridge') ? bridge.handleBid(roomCode, seat, action) : WRONG_GAME, automatic);
}

export function handlePlayCard(roomCode: RoomCode, seat: Seat, card: Card, automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'bridge') ? presentAction(roomCode, () => bridge.handlePlayCard(roomCode, seat, card)) : WRONG_GAME, automatic);
}

export function handleBigTwoPlay(roomCode: RoomCode, seat: Seat, cards: readonly Card[], automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'bigtwo') ? presentAction(roomCode, () => bigtwo.play(roomCode, seat, cards)) : WRONG_GAME, automatic);
}

export function handleBigTwoPass(roomCode: RoomCode, seat: Seat, automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'bigtwo') ? presentAction(roomCode, () => bigtwo.pass(roomCode, seat)) : WRONG_GAME, automatic);
}

export function handleRedPointsPlay(roomCode: RoomCode, seat: Seat, card: Card, capture?: Card, automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'redpoints') ? presentAction(roomCode, () => redpoints.play(roomCode, seat, card, capture)) : WRONG_GAME, automatic);
}

export function handleRedPointsChooseFlip(roomCode: RoomCode, seat: Seat, capture: Card, automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'redpoints') ? presentAction(roomCode, () => redpoints.chooseFlip(roomCode, seat, capture)) : WRONG_GAME, automatic);
}

export function handleNinetyNinePlay(
  roomCode: RoomCode, seat: Seat, card: Card, choice?: NnChoice, target?: Seat, automatic = false,
): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'ninetynine') ? presentAction(roomCode, () => ninetynine.play(roomCode, seat, card, choice, target)) : WRONG_GAME, automatic);
}

/** Initializes legacy snapshots without changing an already sampled deadline. */
export function preparePendingAutoPasses(): void {
  for (const game of bigtwo.exportGames()) {
    bigtwo.prepareAutoPass(game.roomCode, getPresentationEndsAt(game), autoPassMaxDelay(game));
  }
}

export function handlePendingAutoPass(roomCode: RoomCode, gameId: string, pendingId: string): Result {
  const game = bigtwo.getGameState(roomCode);
  const pending = game?.pendingAutoPass;
  if (!game || game.id !== gameId || !pending || pending.id !== pendingId
    || pending.seat !== game.currentTurnSeat || Date.now() < pending.executeAt
    || !bigtwo.needsAutoPass(game)) {
    return { success: false, reason: 'Automatic pass is no longer pending.' };
  }
  return handleBigTwoPass(roomCode, pending.seat, true);
}
