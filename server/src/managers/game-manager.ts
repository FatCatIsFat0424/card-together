// ─── Game Manager: facade dispatching by game type ───

import { advanceGameClock, initializeGameClock } from './game-clock';
import { randomUUID } from 'node:crypto';
import { getPresentationEndsAt, PRESENTATION_TIMING_VERSION } from '@shared/game-presentation';
import { FLEXIBLE_SEAT_GAMES, SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { DEFAULT_TIME_CONTROL } from '@shared/time-control';
import type {
  AnyGameState,
  BidAction,
  BigTwoGameState,
  BlackjackAction,
  BlackjackDealerAction,
  BlackjackGameState,
  BlackjackOptions,
  BridgeGameState,
  Card,
  ChinesePokerArrangement,
  ChinesePokerGameState,
  GameType,
  HoldemAction,
  HoldemGameState,
  LiarsDeckGameState,
  NapoleonAction,
  NapoleonGameState,
  NapoleonOptions,
  NinetyNineGameState,
  NinetyNineOptions,
  ObserverRole,
  PlayerInfo,
  PlayerVisibleGameState,
  RedPointsGameState,
  RoomCode,
  GameSeat, Seat,
  SevensGameState,
  SevensOptions,
  TimeControl,
} from '@shared/types';
import type { NnChoice } from '@shared/rules/ninetynine';
import { cpArrangeSeconds } from '@shared/rules/chinesepoker';
import { bjBetSeconds, bjSitsIn } from '@shared/rules/blackjack';
import { napoleonReviewSeconds } from '@shared/rules/napoleon';
import { gamePlayer, isCompassSeat, maxPlayers, minPlayers, occupiedSeats } from '@shared/rules/seats';
import { normalizeFlexibleGame } from '@shared/game-seat-compat';
import * as bridge from './games/bridge-game';
import * as bigtwo from './games/bigtwo-game';
import * as redpoints from './games/redpoints-game';
import * as ninetynine from './games/ninetynine-game';
import * as sevens from './games/sevens-game';
import * as chinesepoker from './games/chinesepoker-game';
import * as liarsdeck from './games/liarsdeck-game';
import * as blackjack from './games/blackjack-game';
import * as holdem from './games/holdem-game';
import * as napoleon from './games/napoleon-game';

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

function timedAction(roomCode: RoomCode, seat: GameSeat, operation: () => Result, automatic: boolean): Result {
  const game = getGameState(roomCode);
  const clock = game?.clock;
  const now = Date.now();
  if (!automatic && clock?.turn?.seat === seat && now >= clock.turn.deadline) {
    return { success: false, reason: 'Your turn has timed out. Please wait for the automatic action.' };
  }
  const hands = game?.hands;
  const deals = game?.gameType === 'napoleon' ? napoleonDeals(game) : 0;
  const redPointsPlay = game?.gameType === 'redpoints' && game.step === 'play';
  const forced = game?.gameType === 'bigtwo' && game.pendingAutoPass?.seat === seat;
  const result = operation();
  if (result.success && game && clock) {
    const sameTurn = redPointsPlay && game.gameType === 'redpoints' && game.step === 'flip-choose';
    // Each Bridge redeal, Liar's Deck round, and Hold'em hand is a new deal, which refills reserves.
    const redealt = ((game.gameType === 'bridge' || game.gameType === 'liarsdeck' || game.gameType === 'holdem')
      && game.hands !== hands) || (game.gameType === 'napoleon' && napoleonDeals(game) !== deals);
    advanceGameClock(game, clock, sameTurn, redealt, now, forced);
  }
  return result;
}

/** A Napoleon all-pass auction redeals, which refills reserves like a Bridge redeal. */
function napoleonDeals(game: NapoleonGameState): number {
  return game.log.filter((entry) => entry.type === 'deal').length;
}

export function initializeClock(roomCode: RoomCode, settings?: TimeControl): void {
  const game = getGameState(roomCode);
  if (game && !game.clock) initializeGameClock(game, settings);
}

/** Missing games fall through to the game handlers, which report them. */
function isGame(roomCode: RoomCode, gameType: GameType): boolean {
  return (getGameState(roomCode)?.gameType ?? gameType) === gameType;
}

function isFullTable(players: Partial<Record<Seat, PlayerInfo>>): players is Record<Seat, PlayerInfo> {
  return SEAT_ORDER_CLOCKWISE.every((seat) => players[seat] !== undefined);
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
  sevensOptions?: SevensOptions,
  ninetyNineOptions?: NinetyNineOptions,
  blackjackOptions?: BlackjackOptions,
  napoleonOptions?: NapoleonOptions,
): Result {
  if (occupiedSeats(players).length < minPlayers(gameType)) {
    return { success: false, reason: 'Not enough players to start this game.' };
  }
  if (!FLEXIBLE_SEAT_GAMES.includes(gameType)
    && (!isFullTable(players) || occupiedSeats(players).length !== 4)) {
    return { success: false, reason: 'All four seats must be filled.' };
  }
  if (occupiedSeats(players).length > maxPlayers(gameType)) {
    return { success: false, reason: 'Too many players for this game.' };
  }
  // A finished board of another game type may still be waiting for game:continue.
  removeGame(roomCode);
  if (gameType === 'holdem') holdem.startGame(roomCode, players);
  else if (gameType === 'napoleon') napoleon.startGame(roomCode, players, napoleonOptions);
  else if (gameType === 'blackjack') {
    blackjack.startGame(roomCode, players, bjBetSeconds((settings ?? DEFAULT_TIME_CONTROL).baseSeconds) * 1000,
      undefined, blackjackOptions);
  } else if (gameType === 'ninetynine') ninetynine.startGame(roomCode, players, undefined, undefined, ninetyNineOptions);
  else if (!isFullTable(players)) return { success: false, reason: 'All four seats must be filled.' };
  else if (gameType === 'bigtwo') bigtwo.startGame(roomCode, players);
  else if (gameType === 'redpoints') redpoints.startGame(roomCode, players);
  else if (gameType === 'sevens') sevens.startGame(roomCode, players, undefined, sevensOptions);
  else if (gameType === 'liarsdeck') liarsdeck.startGame(roomCode, players);
  else if (gameType === 'chinesepoker') {
    const { baseSeconds, bankSeconds } = settings ?? DEFAULT_TIME_CONTROL;
    chinesepoker.startGame(roomCode, players, cpArrangeSeconds(baseSeconds, bankSeconds) * 1000);
  } else bridge.startGame(roomCode, players);
  const game = getGameState(roomCode);
  // Liar's Deck opens by revealing the first round's table card, Hold'em by dealing the first hand.
  if (game?.phase === 'scoring' || game?.gameType === 'liarsdeck' || game?.gameType === 'holdem') {
    game.presentation = { id: randomUUID(), startedAt: Date.now(), logStart: 0, timingVersion: PRESENTATION_TIMING_VERSION };
  }
  if (game) initializeGameClock(game, settings);
  return { success: true };
}

export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): PlayerVisibleGameState | null {
  if (!isCompassSeat(seat) && !FLEXIBLE_SEAT_GAMES.includes(getGameState(roomCode)?.gameType ?? 'bridge')) return null;
  const compass = isCompassSeat(seat) ? seat : 'N';
  const visible = bridge.getPlayerVisibleState(roomCode, compass) ?? bigtwo.getPlayerVisibleState(roomCode, compass)
    ?? redpoints.getPlayerVisibleState(roomCode, compass) ?? ninetynine.getPlayerVisibleState(roomCode, seat)
    ?? sevens.getPlayerVisibleState(roomCode, compass) ?? chinesepoker.getPlayerVisibleState(roomCode, compass)
    ?? liarsdeck.getPlayerVisibleState(roomCode, compass) ?? blackjack.getPlayerVisibleState(roomCode, seat)
    ?? holdem.getPlayerVisibleState(roomCode, seat) ?? napoleon.getPlayerVisibleState(roomCode, seat);
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
  if (visible.gameType === 'napoleon' && game.gameType === 'napoleon') {
    return { ...visible, observer, ...napoleon.getObserverView(game) };
  }
  if (visible.gameType === 'napoleon' || game.gameType === 'napoleon') return { ...visible, observer };
  return { ...visible, observer, observedHands: game.hands };
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
  switch (game.gameType) {
    case 'ninetynine': return game.log.findIndex((entry) => entry.type === 'eliminated' && entry.seat === seat);
    case 'liarsdeck': return game.log.findIndex((entry) => entry.type === 'shot' && entry.seat === seat
      && !entry.survived);
    case 'holdem': return game.log.findIndex((entry) => entry.type === 'award' && entry.eliminated.includes(seat));
    // Chips only grow by betting, so a seat that cannot cover the minimum never plays again. A
    // player dealer can still win chips back when its deal comes round, so nobody is out for good.
    case 'blackjack': return !game.players[seat] || game.dealerSeat ? -1
      : game.log.findIndex((entry) => entry.type === 'settle' && !bjSitsIn(entry.chips[seat]));
    default: return -1;
  }
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
  return bridge.getGameState(roomCode) ?? bigtwo.getGameState(roomCode) ?? redpoints.getGameState(roomCode)
    ?? ninetynine.getGameState(roomCode) ?? sevens.getGameState(roomCode) ?? chinesepoker.getGameState(roomCode)
    ?? liarsdeck.getGameState(roomCode) ?? blackjack.getGameState(roomCode)
    ?? holdem.getGameState(roomCode) ?? napoleon.getGameState(roomCode);
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
  napoleon.abortGame(roomCode);
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
  return [...bridge.exportGames(), ...bigtwo.exportGames(), ...redpoints.exportGames(),
    ...ninetynine.exportGames(), ...sevens.exportGames(), ...chinesepoker.exportGames(), ...liarsdeck.exportGames(),
    ...blackjack.exportGames(), ...holdem.exportGames(), ...napoleon.exportGames()];
}

export function restoreGames(records: AnyGameState[]): void {
  records = records.map(normalizeFlexibleGame);
  bridge.restoreGames(records.filter((game): game is BridgeGameState => game.gameType === 'bridge'));
  bigtwo.restoreGames(records.filter((game): game is BigTwoGameState => game.gameType === 'bigtwo'));
  redpoints.restoreGames(records.filter((game): game is RedPointsGameState => game.gameType === 'redpoints'));
  ninetynine.restoreGames(records.filter((game): game is NinetyNineGameState => game.gameType === 'ninetynine'));
  sevens.restoreGames(records.filter((game): game is SevensGameState => game.gameType === 'sevens'));
  chinesepoker.restoreGames(records.filter((game): game is ChinesePokerGameState => game.gameType === 'chinesepoker'));
  liarsdeck.restoreGames(records.filter((game): game is LiarsDeckGameState => game.gameType === 'liarsdeck'));
  blackjack.restoreGames(records.filter((game): game is BlackjackGameState => game.gameType === 'blackjack'));
  holdem.restoreGames(records.filter((game): game is HoldemGameState => game.gameType === 'holdem'));
  napoleon.restoreGames(records.filter((game): game is NapoleonGameState => game.gameType === 'napoleon'));
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
  roomCode: RoomCode, seat: GameSeat, card: Card, choice?: NnChoice, target?: GameSeat, automatic = false,
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

export function handleBlackjackAction(roomCode: RoomCode, seat: GameSeat, action: BlackjackAction, automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'blackjack') ? presentAction(roomCode, () => blackjack.act(roomCode, seat, action)) : WRONG_GAME, automatic);
}

export function handleBlackjackDealerAction(
  roomCode: RoomCode, seat: GameSeat, action: BlackjackDealerAction, automatic = false,
): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'blackjack') ? presentAction(roomCode, () => blackjack.dealerAct(roomCode, seat, action)) : WRONG_GAME, automatic);
}

export function handleHoldemAction(roomCode: RoomCode, seat: GameSeat, action: HoldemAction, automatic = false): Result {
  return timedAction(roomCode, seat, () => isGame(roomCode, 'holdem') ? presentAction(roomCode, () => holdem.act(roomCode, seat, action)) : WRONG_GAME, automatic);
}

/**
 * Every Napoleon decision. Acknowledging public discards belongs to no single turn; the last
 * acknowledgment hands the Napoleon the call, and a redeal refills every reserve.
 */
export function handleNapoleonAction(roomCode: RoomCode, seat: GameSeat, action: NapoleonAction, automatic = false): Result {
  const settings = getGameState(roomCode)?.clock?.settings ?? DEFAULT_TIME_CONTROL;
  const reviewMs = napoleonReviewSeconds(settings.baseSeconds) * 1000;
  return timedAction(roomCode, seat, () => isGame(roomCode, 'napoleon')
    ? presentAction(roomCode, () => napoleon.act(roomCode, seat, action, reviewMs)) : WRONG_GAME, automatic);
}

/** Seats that still owe an acknowledgment of the public discards once the shared deadline has passed. */
export function overdueNapoleonReviewSeats(roomCode: RoomCode, gameId: string, now = Date.now()): GameSeat[] {
  const game = napoleon.getGameState(roomCode);
  if (!game || game.id !== gameId || game.reviewDeadline === null || now < game.reviewDeadline) return [];
  return napoleon.pendingReviewSeats(game);
}

/**
 * Seats bet simultaneously against one shared deadline. The final bet deals a new hand, which
 * refills every reserve and starts the first player's turn after the deal presentation.
 */
export function handleBlackjackBet(roomCode: RoomCode, seat: GameSeat, amount: number, automatic = false): Result {
  if (!isGame(roomCode, 'blackjack')) return WRONG_GAME;
  const before = blackjack.getGameState(roomCode)?.hand;
  const result = presentAction(roomCode, () => blackjack.bet(roomCode, seat, amount, automatic));
  const game = blackjack.getGameState(roomCode);
  if (result.success && game?.clock && game.hand !== before) initializeGameClock(game, game.clock.settings);
  return result;
}

/** Seats that still owe a bet once the shared betting deadline has passed. */
export function overdueBlackjackSeats(roomCode: RoomCode, gameId: string, now = Date.now()): GameSeat[] {
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
