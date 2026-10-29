// ─── Game Manager: facade dispatching by game type ───

import { advanceGameClock, initializeGameClock } from './game-clock';
import { randomUUID } from 'node:crypto';
import { getPresentationEndsAt, PRESENTATION_TIMING_VERSION } from '@shared/game-presentation';
import { DEFAULT_TIME_CONTROL } from '@shared/time-control';
import { gameDefinition, gameTimeControl } from '@shared/games/registry';
import type { GameActionEnvelope, GameActionMap } from '@shared/games/actions';
import type {
  GameOptions,
  AnyGameState,
  BidAction,
  BlackjackAction,
  BlackjackDealerAction,
  Card,
  ChinesePokerArrangement,
  GameType,
  HoldemAction,
  MatchResult,
  NapoleonAction,
  ObserverRole,
  PlayerInfo,
  PlayerVisibleGameState,
  RoomCode,
  GameSeat, Seat,
  TimeControl,
} from '@shared/types';
import type { NnChoice } from '@shared/rules/ninetynine';
import { gamePlayer, isCompassSeat, occupiedSeats, playerCountAllowed } from '@shared/rules/seats';
import { normalizeFlexibleGame } from '@shared/game-seat-compat';
import { isFullTable } from './games/game-adapter';
import type { SharedDeadlineWindow } from './games/game-adapter';
import { prepareAutoPass } from './games/bigtwo-adapter';
import { allGameAdapters, gameAdapter } from './games/registry';
import * as bigtwo from './games/bigtwo-game';
import * as sevens from './games/sevens-game';

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
    game.presentation = { id: randomUUID(), startedAt: Date.now(), logStart, timingVersion: PRESENTATION_TIMING_VERSION };
    gameAdapter(game.gameType).afterPresentation?.(game, getPresentationEndsAt(game));
  }
  return result;
}

function timedAction(roomCode: RoomCode, seat: GameSeat, operation: () => Result, automatic: boolean): Result {
  const game = getGameState(roomCode);
  if (!automatic && game?.autoPlaySeats?.includes(seat)) {
    return { success: false, reason: 'Turn off auto-play before playing manually.' };
  }
  const clock = game?.clock;
  const now = Date.now();
  if (!automatic && clock?.turn?.seat === seat && now >= clock.turn.deadline) {
    return { success: false, reason: 'Your turn has timed out. Please wait for the automatic action.' };
  }
  const clockAdvance = game && gameAdapter(game.gameType).clockBeforeAction?.(game, seat);
  const result = operation();
  if (result.success && game && clock) {
    const { sameTurn = false, redealt = false, forced = false } = clockAdvance?.(game) ?? {};
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

/** Developer-only Sevens deal chosen at startup; normal games otherwise. */
export function setSevensDevPreset(enabled: boolean): void {
  sevens.setDevPreset(enabled);
}

/** Missing seats stay empty; only games with a flexible seat count accept them. */
export function startGame(
  roomCode: RoomCode,
  gameType: GameType,
  players: Partial<Record<GameSeat, PlayerInfo>>,
  settings?: TimeControl,
  options: GameOptions = {},
): Result {
  const seats = gameDefinition(gameType).seats;
  if (occupiedSeats(players).length < seats.minPlayers) {
    return { success: false, reason: 'Not enough players to start this game.' };
  }
  if (!seats.flexible && (!isFullTable(players) || occupiedSeats(players).length !== 4)) {
    return { success: false, reason: 'All four seats must be filled.' };
  }
  if (occupiedSeats(players).length > seats.maxPlayers) {
    return { success: false, reason: 'Too many players for this game.' };
  }
  if (!playerCountAllowed(gameType, occupiedSeats(players).length)) {
    return { success: false, reason: 'This game cannot start with this many players.' };
  }
  // A finished board of another game type may still be waiting for game:continue.
  removeGame(roomCode);
  const adapter = gameAdapter(gameType);
  const started = adapter.start({ roomCode, players, settings: settings ?? gameTimeControl(gameType),
    options });
  if (!started.success) return started;
  const game = getGameState(roomCode);
  if (game?.phase === 'scoring' || (game && adapter.presentsOpening)) {
    game.presentation = { id: randomUUID(), startedAt: Date.now(), logStart: 0, timingVersion: PRESENTATION_TIMING_VERSION };
  }
  if (game) initializeGameClock(game, settings ?? gameTimeControl(gameType));
  return { success: true };
}

/** Called inside a runtime mutation; automation belongs to this match and preserves human identity. */
export function setAutoPlay(roomCode: RoomCode, seat: GameSeat, enabled: boolean): { success: boolean; reason?: string } {
  const game = getGameState(roomCode);
  const player = game && gamePlayer(game, seat);
  if (!game || game.phase === 'scoring' || !player || player.isBot || eliminationIndex(game, seat) >= 0) {
    return { success: false, reason: 'No active player seat.' };
  }
  game.autoPlaySeats = [...(game.autoPlaySeats ?? []).filter((entry) => entry !== seat), ...(enabled ? [seat] : [])];
  if (!enabled && game.earlyLeaveSeats) game.earlyLeaveSeats = game.earlyLeaveSeats.filter((entry) => entry !== seat);
  return { success: true };
}

/** Enable automation and publish the caller's early departure in the same runtime commit. */
export function leaveEarly(roomCode: RoomCode, seat: GameSeat): { success: boolean; reason?: string } {
  const result = setAutoPlay(roomCode, seat, true);
  const game = getGameState(roomCode);
  if (result.success && game) game.earlyLeaveSeats = [...new Set([...(game.earlyLeaveSeats ?? []), seat])];
  return result;
}

export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): PlayerVisibleGameState | null {
  const game = getGameState(roomCode);
  if (!game || (!isCompassSeat(seat) && !gameDefinition(game.gameType).seats.flexible)) return null;
  const visible = gameAdapter(game.gameType).getPlayerVisibleState(roomCode, seat);
  if (!visible) return null;
  const serverNow = Date.now();
  return { ...visible,
    autoPlay: game.autoPlaySeats?.includes(seat) ?? false,
    earlyLeaveSeats: [...game.earlyLeaveSeats ?? []],
    ...(game.presentation ? { presentation: { ...game.presentation, serverNow } } : {}),
    ...(game.clock ? { clock: { ...game.clock, serverNow } } : {}),
  };
}

/** Adds every private hand (Blackjack: the hole card) for a recipient with god view. */
function withGodView(
  visible: PlayerVisibleGameState, game: AnyGameState, observer: ObserverRole,
): PlayerVisibleGameState {
  // Both come from the same room, so the view belongs to the game's own type.
  return visible.gameType === game.gameType
    ? gameAdapter(game.gameType).withObserverView(visible, game, observer) : { ...visible, observer };
}

/**
 * The snapshot one room member receives: spectators (no seat) watch from South with god
 * view, and seats permanently out of the match keep their own view plus god view.
 * Bots and automatic actions must use `getPlayerVisibleState`, which never adds god view.
 */
export function getRecipientVisibleState(roomCode: RoomCode, seat: GameSeat | null): PlayerVisibleGameState | null {
  const game = getGameState(roomCode);
  const visible = getPlayerVisibleState(roomCode, seat ?? 'S');
  if (!game || !visible) return null;
  if (!seat) return withGodView(visible, game, 'spectator');
  return eliminationIndex(game, seat) >= 0 ? withGodView(visible, game, 'eliminated') : visible;
}

/** Log index of the entry that knocked the seat out of the match for good, or -1. */
function eliminationIndex(game: AnyGameState, seat: GameSeat): number {
  return gameAdapter(game.gameType).eliminationIndex?.(game, seat) ?? -1;
}

/**
 * Whether the seat is out of the match and every player has already seen it happen. Until
 * the eliminating presentation ends, the seat still counts as playing so its own chat and
 * voice do not reveal the outcome early.
 */
export function isEliminationShown(roomCode: RoomCode, seat: GameSeat): boolean {
  const game = getGameState(roomCode);
  if (!game) return false;
  const index = eliminationIndex(game, seat);
  if (index < 0) return false;
  return !game.presentation || Date.now() >= getPresentationEndsAt(game) || index < game.presentation.logStart;
}

export function getGameState(roomCode: RoomCode): AnyGameState | null {
  for (const adapter of allGameAdapters()) {
    const game = adapter.getGameState(roomCode);
    if (game) return game;
  }
  return null;
}

/** Ends a game without a match record. */
export function abortGame(roomCode: RoomCode): void {
  for (const adapter of allGameAdapters()) adapter.abortGame(roomCode);
}

export function removeGame(roomCode: RoomCode): void {
  abortGame(roomCode);
}

/** Lets one player leave the finished board; it is removed once every human has left. */
export function returnFromResult(roomCode: RoomCode, seat: GameSeat): void {
  const game = getGameState(roomCode);
  if (!game?.result) return;
  const returned = new Set([...(game.returnedSeats ?? []), seat]);
  const humans = occupiedSeats(game.players).filter((value) => gamePlayer(game, value)?.isBot === false || gamePlayer(game, value)?.isBot === undefined);
  if (humans.every((value) => returned.has(value))) removeGame(roomCode);
  else game.returnedSeats = occupiedSeats(game.players).filter((value) => returned.has(value));
}

/** The finished board stays visible only to its own players until they return. */
export function isViewingGame(roomCode: RoomCode, seat: GameSeat, accountId: string): boolean {
  const game = getGameState(roomCode);
  return Boolean(game && gamePlayer(game, seat)?.id === accountId && !(game.returnedSeats as readonly GameSeat[] | undefined)?.includes(seat));
}

/**
 * Spectators watch the match and its finished board until they return to the room. Players
 * of that match who later stood up are not pulled back to it.
 */
export function isSpectating(roomCode: RoomCode, accountId: string): boolean {
  const game = getGameState(roomCode);
  return Boolean(game && !Object.values(game.players).some((player) => player?.id === accountId)
    && !game.returnedViewers?.includes(accountId));
}

/** Lets one spectator leave the finished board; the players' return decides its removal. */
export function returnViewerFromResult(roomCode: RoomCode, accountId: string): void {
  const game = getGameState(roomCode);
  if (!game?.result || game.returnedViewers?.includes(accountId)) return;
  game.returnedViewers = [...(game.returnedViewers ?? []), accountId];
}

export function hasActiveGame(roomCode: RoomCode): boolean {
  return getGameState(roomCode) !== null;
}

export function exportGames(): AnyGameState[] {
  return allGameAdapters().flatMap((adapter) => adapter.exportGames());
}

export function restoreGames(records: AnyGameState[]): void {
  records = records.map(normalizeFlexibleGame);
  for (const adapter of allGameAdapters()) {
    adapter.restoreGames(records.filter((game) => game.gameType === adapter.gameType));
  }
}

/** The durable history record of a finished match, or null while it is still being played. */
export function getMatchResult(game: AnyGameState): MatchResult | null {
  return gameAdapter(game.gameType).matchResult(game);
}

function dispatchGameAction<K extends GameType>(
  code: RoomCode, seat: GameSeat, gameType: K, action: GameActionMap[K], automatic = false,
): Result {
  const available = (operation: () => Result): Result => isGame(code, gameType) ? operation() : WRONG_GAME;
  const result = gameAdapter(gameType).applyAction(code, seat, action, {
    automatic,
    settings: getGameState(code)?.clock?.settings ?? DEFAULT_TIME_CONTROL,
    timed: (operation) => timedAction(code, seat, () => available(operation), automatic),
    present: (operation) => available(() => presentAction(code, operation)),
    simultaneous: (operation) => {
      if (!automatic && getGameState(code)?.autoPlaySeats?.includes(seat)) {
        return { success: false, reason: 'Turn off auto-play before playing manually.' };
      }
      return available(operation);
    },
    resetClock: () => {
      const game = getGameState(code);
      if (game?.clock) initializeGameClock(game, game.clock.settings);
    },
  });
  // A finished match has no turn, even when an untimed action (resigning, an agreed draw) ended it.
  const finished = getGameState(code);
  if (result.success && finished?.phase === 'scoring' && finished.clock?.turn) finished.clock = { ...finished.clock, turn: null };
  return result;
}

/** Rejects stale game envelopes before any clock or game mutation. */
export function handleGameAction(
  code: RoomCode, seat: GameSeat, request: GameActionEnvelope, automatic = false,
): Result {
  if (!isGame(code, request.gameType)) return WRONG_GAME;
  return dispatchGameAction(code, seat, request.gameType, request.action, automatic);
}

// Compatibility entry points for bots and internal callers use the same adapter actions.
export function handleRedealResponse(roomCode: RoomCode, seat: Seat, accept: boolean, automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'bridge', { type: 'redeal', accept }, automatic);
}

export function handleBid(roomCode: RoomCode, seat: Seat, action: BidAction, automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'bridge', { type: 'bid', bid: action }, automatic);
}

export function handlePlayCard(roomCode: RoomCode, seat: Seat, card: Card, automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'bridge', { type: 'play', card }, automatic);
}

export function handleBigTwoPlay(roomCode: RoomCode, seat: Seat, cards: readonly Card[], automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'bigtwo', { type: 'play', cards }, automatic);
}

export function handleBigTwoPass(roomCode: RoomCode, seat: Seat, automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'bigtwo', { type: 'pass' }, automatic);
}

export function handleRedPointsPlay(roomCode: RoomCode, seat: Seat, card: Card, capture?: Card, automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'redpoints', { type: 'play', card, capture }, automatic);
}

export function handleRedPointsChooseFlip(roomCode: RoomCode, seat: Seat, capture: Card, automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'redpoints', { type: 'chooseFlip', capture }, automatic);
}

export function handleNinetyNinePlay(
  roomCode: RoomCode, seat: GameSeat, card: Card, choice?: NnChoice, target?: GameSeat, automatic = false,
): Result {
  return dispatchGameAction(roomCode, seat, 'ninetynine', { type: 'play', card, choice, target }, automatic);
}

export function handleSevensPlay(roomCode: RoomCode, seat: Seat, card: Card, automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'sevens', { type: 'play', card }, automatic);
}

export function handleSevensCover(roomCode: RoomCode, seat: Seat, card: Card, automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'sevens', { type: 'cover', card }, automatic);
}

export function handleLiarsDeckPlay(roomCode: RoomCode, seat: Seat, cardIds: readonly number[], automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'liarsdeck', { type: 'play', cardIds }, automatic);
}

export function handleLiarsDeckChallenge(roomCode: RoomCode, seat: Seat, automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'liarsdeck', { type: 'challenge' }, automatic);
}

export function handleBlackjackAction(roomCode: RoomCode, seat: GameSeat, action: BlackjackAction, automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'blackjack', { type: 'act', action }, automatic);
}

export function handleBlackjackDealerAction(
  roomCode: RoomCode, seat: GameSeat, action: BlackjackDealerAction, automatic = false,
): Result {
  return dispatchGameAction(roomCode, seat, 'blackjack', { type: 'dealerAct', action }, automatic);
}

export function handleHoldemAction(roomCode: RoomCode, seat: GameSeat, action: HoldemAction, automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'holdem', action, automatic);
}

export function handleNapoleonAction(roomCode: RoomCode, seat: GameSeat, action: NapoleonAction, automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'napoleon', action, automatic);
}

export function handleBlackjackBet(roomCode: RoomCode, seat: GameSeat, amount: number, automatic = false): Result {
  return dispatchGameAction(roomCode, seat, 'blackjack', { type: 'bet', amount }, automatic);
}

export function handleChinesePokerArrange(
  roomCode: RoomCode, seat: Seat, arrangement: ChinesePokerArrangement, automatic = false,
): Result {
  return dispatchGameAction(roomCode, seat, 'chinesepoker', { type: 'arrange', arrangement }, automatic);
}

/**
 * Seats that still owe a simultaneous decision once the game's shared deadline has passed:
 * Chinese Poker arrangements, Blackjack bets, and Napoleon discard reviews.
 */
export function overdueSharedDeadlineSeats(roomCode: RoomCode, gameId: string, now = Date.now()): GameSeat[] {
  const game = getGameState(roomCode);
  if (!game || game.id !== gameId) return [];
  const rules = gameAdapter(game.gameType).sharedDeadline;
  const window = rules?.window(game);
  return rules && window && now >= window.deadline ? [...rules.pendingSeats(game)] : [];
}

/** The game's open shared-deadline window, or null while turns pass from seat to seat. */
export function getSharedDeadlineWindow(game: AnyGameState): SharedDeadlineWindow | null {
  return gameAdapter(game.gameType).sharedDeadline?.window(game) ?? null;
}

/** Seats that owe a simultaneous decision now in seat order, or null while one seat holds the turn. */
export function getOwingSeats(game: AnyGameState): readonly GameSeat[] | null {
  return gameAdapter(game.gameType).sharedDeadline?.owingSeats(game) ?? null;
}

/** A separate durable scheduler (the Big Two forced pass) owns the current turn. */
export function isForcedActionPending(game: AnyGameState): boolean {
  return gameAdapter(game.gameType).forcedActionPending?.(game) ?? false;
}

/** Initializes legacy turns and removes random waits from restored bot passes. */
export function preparePendingAutoPasses(): void {
  for (const game of bigtwo.exportGames()) prepareAutoPass(game, getPresentationEndsAt(game));
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
