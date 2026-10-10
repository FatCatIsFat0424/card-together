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
  BlackjackAction,
  BlackjackGameState,
  BridgeGameState,
  Card,
  ChinesePokerArrangement,
  ChinesePokerGameState,
  GameType,
  HoldemAction,
  HoldemGameState,
  LiarsDeckGameState,
  NinetyNineGameState,
  ObserverRole,
  PlayerInfo,
  PlayerVisibleGameState,
  RedPointsGameState,
  RoomCode,
  Seat,
  SevensGameState,
  TimeControl,
} from '@shared/types';
import type { NnChoice } from '@shared/rules/ninetynine';
import { cpArrangeSeconds } from '@shared/rules/chinesepoker';
import { bjBetSeconds, bjSitsIn } from '@shared/rules/blackjack';
import * as bridge from './games/bridge-game';
import * as bigtwo from './games/bigtwo-game';
import * as redpoints from './games/redpoints-game';
import * as ninetynine from './games/ninetynine-game';
import * as sevens from './games/sevens-game';
import * as chinesepoker from './games/chinesepoker-game';
import * as liarsdeck from './games/liarsdeck-game';
import * as blackjack from './games/blackjack-game';
import * as holdem from './games/holdem-game';

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
    // The next hand's betting window starts only after the settlement has been shown.
    if (game.gameType === 'blackjack') blackjack.openBetting(roomCode, getPresentationEndsAt(game));
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
    // Each Bridge redeal, Liar's Deck round, and Hold'em hand is a new deal, which refills reserves.
    const redealt = (game.gameType === 'bridge' || game.gameType === 'liarsdeck' || game.gameType === 'holdem')
      && game.hands !== hands;
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
  else if (gameType === 'sevens') sevens.startGame(roomCode, players);
  else if (gameType === 'liarsdeck') liarsdeck.startGame(roomCode, players);
  else if (gameType === 'holdem') holdem.startGame(roomCode, players);
  else if (gameType === 'blackjack') {
    blackjack.startGame(roomCode, players, bjBetSeconds((settings ?? DEFAULT_TIME_CONTROL).baseSeconds) * 1000);
  } else if (gameType === 'chinesepoker') {
    const { baseSeconds, bankSeconds } = settings ?? DEFAULT_TIME_CONTROL;
    chinesepoker.startGame(roomCode, players, cpArrangeSeconds(baseSeconds, bankSeconds) * 1000);
  } else bridge.startGame(roomCode, players);
  const game = getGameState(roomCode);
  // Liar's Deck opens by revealing the first round's table card, Hold'em by dealing the first hand.
  if (game?.phase === 'scoring' || game?.gameType === 'liarsdeck' || game?.gameType === 'holdem') {
    game.presentation = { id: randomUUID(), startedAt: Date.now(), logStart: 0, timingVersion: 2 };
  }
  if (game) initializeGameClock(game, settings);
  return { success: true };
}

export function getPlayerVisibleState(roomCode: RoomCode, seat: Seat): PlayerVisibleGameState | null {
  const visible = bridge.getPlayerVisibleState(roomCode, seat) ?? bigtwo.getPlayerVisibleState(roomCode, seat)
    ?? redpoints.getPlayerVisibleState(roomCode, seat) ?? ninetynine.getPlayerVisibleState(roomCode, seat)
    ?? sevens.getPlayerVisibleState(roomCode, seat) ?? chinesepoker.getPlayerVisibleState(roomCode, seat)
    ?? liarsdeck.getPlayerVisibleState(roomCode, seat) ?? blackjack.getPlayerVisibleState(roomCode, seat)
    ?? holdem.getPlayerVisibleState(roomCode, seat);
  if (!visible) return null;
  const game = getGameState(roomCode);
  const serverNow = Date.now();
  return { ...visible,
    ...(game?.presentation ? { presentation: { ...game.presentation, serverNow } } : {}),
    ...(game?.clock ? { clock: { ...game.clock, serverNow } } : {}),
  };
}

/** Adds every private hand (Blackjack: the hole card) for a recipient with god view. */
function withGodView(
  visible: PlayerVisibleGameState, game: AnyGameState, observer: ObserverRole,
): PlayerVisibleGameState {
  if (visible.gameType === 'blackjack' && game.gameType === 'blackjack') {
    return game.hole ? { ...visible, observer, observedHole: game.hole } : { ...visible, observer };
  }
  if (visible.gameType === 'blackjack' || game.gameType === 'blackjack') return { ...visible, observer };
  if (visible.gameType === 'sevens' && game.gameType === 'sevens') {
    return { ...visible, observer, observedHands: game.hands, observedCovered: game.covered };
  }
  if (visible.gameType === 'liarsdeck' && game.gameType === 'liarsdeck') {
    return { ...visible, observer, observedHands: game.hands };
  }
  if (visible.gameType === 'liarsdeck' || game.gameType === 'liarsdeck') return { ...visible, observer };
  return { ...visible, observer, observedHands: game.hands };
}

/**
 * The snapshot one room member receives: spectators (no seat) watch from South with god
 * view, and seats permanently out of the match keep their own view plus god view.
 * Bots and automatic actions must use `getPlayerVisibleState`, which never adds god view.
 */
export function getRecipientVisibleState(roomCode: RoomCode, seat: Seat | null): PlayerVisibleGameState | null {
  const game = getGameState(roomCode);
  const visible = getPlayerVisibleState(roomCode, seat ?? 'S');
  if (!game || !visible) return null;
  if (!seat) return withGodView(visible, game, 'spectator');
  return eliminationIndex(game, seat) >= 0 ? withGodView(visible, game, 'eliminated') : visible;
}

/** Log index of the entry that knocked the seat out of the match for good, or -1. */
function eliminationIndex(game: AnyGameState, seat: Seat): number {
  switch (game.gameType) {
    case 'ninetynine': return game.log.findIndex((entry) => entry.type === 'eliminated' && entry.seat === seat);
    case 'liarsdeck': return game.log.findIndex((entry) => entry.type === 'shot' && entry.seat === seat
      && !entry.survived);
    case 'holdem': return game.log.findIndex((entry) => entry.type === 'award' && entry.eliminated.includes(seat));
    // Chips only grow by betting, so a seat that cannot cover the minimum never plays again.
    case 'blackjack': return game.log.findIndex((entry) => entry.type === 'settle' && !bjSitsIn(entry.chips[seat]));
    default: return -1;
  }
}

/**
 * Whether the seat is out of the match and every player has already seen it happen. Until
 * the eliminating presentation ends, the seat still counts as playing so its own chat and
 * voice do not reveal the outcome early.
 */
export function isEliminationShown(roomCode: RoomCode, seat: Seat): boolean {
  const game = getGameState(roomCode);
  if (!game) return false;
  const index = eliminationIndex(game, seat);
  if (index < 0) return false;
  return !game.presentation || Date.now() >= getPresentationEndsAt(game) || index < game.presentation.logStart;
}

export function getGameState(roomCode: RoomCode): AnyGameState | null {
  return bridge.getGameState(roomCode) ?? bigtwo.getGameState(roomCode) ?? redpoints.getGameState(roomCode)
    ?? ninetynine.getGameState(roomCode) ?? sevens.getGameState(roomCode) ?? chinesepoker.getGameState(roomCode)
    ?? liarsdeck.getGameState(roomCode) ?? blackjack.getGameState(roomCode)
    ?? holdem.getGameState(roomCode);
}

/** Ends a game without a match record. */
export function abortGame(roomCode: RoomCode): void {
  bridge.abortGame(roomCode);
  bigtwo.abortGame(roomCode);
  redpoints.abortGame(roomCode);
  ninetynine.abortGame(roomCode);
  sevens.abortGame(roomCode);
  chinesepoker.abortGame(roomCode);
  liarsdeck.abortGame(roomCode);
  blackjack.abortGame(roomCode);
  holdem.abortGame(roomCode);
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

/**
 * Spectators watch the match and its finished board until they return to the room. Players
 * of that match who later stood up are not pulled back to it.
 */
export function isSpectating(roomCode: RoomCode, accountId: string): boolean {
  const game = getGameState(roomCode);
  return Boolean(game && !SEAT_ORDER_CLOCKWISE.some((seat) => game.players[seat].id === accountId)
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
  return [...bridge.exportGames(), ...bigtwo.exportGames(), ...redpoints.exportGames(),
    ...ninetynine.exportGames(), ...sevens.exportGames(), ...chinesepoker.exportGames(), ...liarsdeck.exportGames(),
    ...blackjack.exportGames(), ...holdem.exportGames()];
}

export function restoreGames(records: AnyGameState[]): void {
  bridge.restoreGames(records.filter((game): game is BridgeGameState => game.gameType === 'bridge'));
  bigtwo.restoreGames(records.filter((game): game is BigTwoGameState => game.gameType === 'bigtwo'));
  redpoints.restoreGames(records.filter((game): game is RedPointsGameState => game.gameType === 'redpoints'));
  ninetynine.restoreGames(records.filter((game): game is NinetyNineGameState => game.gameType === 'ninetynine'));
  sevens.restoreGames(records.filter((game): game is SevensGameState => game.gameType === 'sevens'));
  chinesepoker.restoreGames(records.filter((game): game is ChinesePokerGameState => game.gameType === 'chinesepoker'));
  liarsdeck.restoreGames(records.filter((game): game is LiarsDeckGameState => game.gameType === 'liarsdeck'));
  blackjack.restoreGames(records.filter((game): game is BlackjackGameState => game.gameType === 'blackjack'));
  holdem.restoreGames(records.filter((game): game is HoldemGameState => game.gameType === 'holdem'));
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

export function handleSevensPlay(roomCode: RoomCode, seat: Seat, card: Card, automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'sevens') ? presentAction(roomCode, () => sevens.play(roomCode, seat, card)) : WRONG_GAME, automatic);
}

export function handleSevensCover(roomCode: RoomCode, seat: Seat, card: Card, automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'sevens') ? presentAction(roomCode, () => sevens.cover(roomCode, seat, card)) : WRONG_GAME, automatic);
}

export function handleLiarsDeckPlay(roomCode: RoomCode, seat: Seat, cardIds: readonly number[], automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'liarsdeck') ? presentAction(roomCode, () => liarsdeck.play(roomCode, seat, cardIds)) : WRONG_GAME, automatic);
}

export function handleLiarsDeckChallenge(roomCode: RoomCode, seat: Seat, automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'liarsdeck') ? presentAction(roomCode, () => liarsdeck.challenge(roomCode, seat)) : WRONG_GAME, automatic);
}

export function handleBlackjackAction(roomCode: RoomCode, seat: Seat, action: BlackjackAction, automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'blackjack') ? presentAction(roomCode, () => blackjack.act(roomCode, seat, action)) : WRONG_GAME, automatic);
}

export function handleHoldemAction(roomCode: RoomCode, seat: Seat, action: HoldemAction, automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'holdem') ? presentAction(roomCode, () => holdem.act(roomCode, seat, action)) : WRONG_GAME, automatic);
}

/**
 * Seats bet simultaneously against one shared deadline. The final bet deals a new hand, which
 * refills every reserve and starts the first player's turn after the deal presentation.
 */
export function handleBlackjackBet(roomCode: RoomCode, seat: Seat, amount: number, automatic = false): Result {
  if (!isGame(roomCode, 'blackjack')) return WRONG_GAME;
  const before = blackjack.getGameState(roomCode)?.hand;
  const result = presentAction(roomCode, () => blackjack.bet(roomCode, seat, amount, automatic));
  const game = blackjack.getGameState(roomCode);
  if (result.success && game?.clock && game.hand !== before) initializeGameClock(game, game.clock.settings);
  return result;
}

/** Seats that still owe a bet once the shared betting deadline has passed. */
export function overdueBlackjackSeats(roomCode: RoomCode, gameId: string, now = Date.now()): Seat[] {
  const game = blackjack.getGameState(roomCode);
  if (!game || game.id !== gameId || game.betDeadline === null || now < game.betDeadline) return [];
  return blackjack.pendingBetSeats(game);
}

/**
 * Seats arrange simultaneously against one shared deadline, so the single-seat turn clock
 * does not apply; the final submission starts the showdown presentation.
 */
export function handleChinesePokerArrange(
  roomCode: RoomCode, seat: Seat, arrangement: ChinesePokerArrangement, automatic = false,
): Result {
  if (!isGame(roomCode, 'chinesepoker')) return WRONG_GAME;
  return presentAction(roomCode, () => chinesepoker.arrange(roomCode, seat, arrangement, automatic));
}

/** Seats that still owe an arrangement once the shared deadline has passed. */
export function overdueChinesePokerSeats(roomCode: RoomCode, gameId: string, now = Date.now()): Seat[] {
  const game = chinesepoker.getGameState(roomCode);
  if (!game || game.id !== gameId || game.phase !== 'arranging' || now < game.arrangeDeadline) return [];
  return chinesepoker.pendingSeats(game);
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
