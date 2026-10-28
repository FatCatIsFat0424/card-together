// ─── Ten and a Half Game: shared betting window, player turns, then the rotating banker ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  Card, GameSeat, PlayerInfo, RoomCode, TenHalfAction, TenHalfGameState, TenHalfLogEntry, TenHalfVisibleState,
} from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { occupiedSeats } from '@shared/rules/seats';
import { bjBettingSeats, bjIsValidBet, bjMatchHands, bjMatchOver, bjNextDealer, bjSitsIn, bjWinners } from '@shared/rules/blackjack';
import { thApplyEntry, thEmptyTable, thIsMaxed, thNextTurn, thSettle } from '@shared/rules/tenhalf';
import { createDeck, shuffleDeck } from '../../engine/deck';

type Result = { success: true } | { success: false; reason: string };

/** Deals stay unpredictable from previously observed shuffles. */
const RANDOM_RANGE = 2 ** 32;
const secureRandom = (): number => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

/** roomCode → TenHalfGameState */
const games: Map<RoomCode, TenHalfGameState> = new Map();

function seatMap<T>(value: (seat: GameSeat) => T): Record<GameSeat, T> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, value(seat)])) as Record<GameSeat, T>;
}

function record(game: TenHalfGameState, entry: TenHalfLogEntry): void {
  game.log.push(entry);
  thApplyEntry(game, entry);
}

/** One deck per hand covers eight seats of five cards. */
function draw(game: TenHalfGameState): Card {
  const card = game.deck.shift();
  if (!card) throw new Error('Ten and a Half deck exhausted');
  return card;
}

/** Every card a seat holds, hole card first. */
export function seatCards(game: TenHalfGameState, seat: GameSeat): Card[] {
  const hole = game.holes[seat];
  return hole ? [hole, ...game.ups[seat]] : [];
}

/** Seats that must still bet this hand, ordered N, E, S, W */
export function pendingBetSeats(game: TenHalfGameState): GameSeat[] {
  return game.phase !== 'betting' ? []
    : bjBettingSeats(game.chips, game.banker).filter((seat) => game.pendingBets[seat] === null);
}

/** `random` is a test hook; the first banker is a random seat taking part. */
export function startGame(
  roomCode: RoomCode,
  players: Partial<Record<GameSeat, PlayerInfo>>,
  betMs: number,
  now: number = Date.now(),
  random: () => number = secureRandom,
): void {
  const seats = occupiedSeats(players);
  const empty = thEmptyTable(seats);
  games.set(roomCode, {
    gameType: 'tenhalf',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'betting',
    hand: 0,
    banker: seats[Math.floor(random() * seats.length)],
    chips: empty.chips,
    pendingBets: seatMap(() => null),
    bets: empty.bets,
    stacks: empty.stacks,
    betMs,
    betDeadline: now + betMs,
    deck: [],
    dealt: [],
    holes: seatMap(() => null),
    ups: empty.ups,
    done: empty.done,
    currentTurnSeat: seats[0],
    log: [],
    result: null,
  });
}

/** Opens the betting window once the previous hand's presentation has ended. */
export function openBetting(roomCode: RoomCode, startsAt: number): void {
  const game = games.get(roomCode);
  if (game?.phase === 'betting' && game.betDeadline === null) game.betDeadline = startsAt + game.betMs;
}

/** Reveals every hole card, settles against the banker, then opens the next hand or ends the match. */
function showdown(game: TenHalfGameState, now: number): void {
  record(game, { type: 'showdown', hand: game.hand, holes: { ...game.holes }, timestamp: now });
  const holes: Partial<Record<GameSeat, Card>> = {};
  for (const seat of game.dealt) {
    const hole = game.holes[seat];
    if (hole) holes[seat] = hole;
  }
  const { outcomes, net, chips } = thSettle(game, holes);
  record(game, { type: 'settle', hand: game.hand, outcomes, net, chips: { ...chips }, timestamp: now });
  const seats = occupiedSeats(game.players);
  if (bjMatchOver(game.hand, game.chips, seats, true)) {
    game.phase = 'scoring';
    game.result = { gameType: 'tenhalf', seats, chips: { ...game.chips }, hands: game.hand,
      winners: bjWinners(game.chips, seats) };
    return;
  }
  game.phase = 'betting';
  game.pendingBets = seatMap(() => null);
  game.betDeadline = null;
  game.banker = bjNextDealer(game.banker, seats);
}

function advance(game: TenHalfGameState, now: number): void {
  const next = thNextTurn(game);
  if (next === null) {
    showdown(game, now);
    return;
  }
  game.currentTurnSeat = next;
}

/** Deals each bettor and the banker one face-down card, then opens the first player's turn. */
function deal(game: TenHalfGameState, now: number, random: () => number): void {
  const bets = seatMap((seat) => game.pendingBets[seat] ?? 0);
  game.deck = shuffleDeck(createDeck(), random);
  const dealt = GAME_SEAT_ORDER.filter((seat) => seat === game.banker || bets[seat] > 0);
  game.pendingBets = seatMap(() => null);
  game.betDeadline = null;
  game.phase = 'playing';
  record(game, { type: 'deal', hand: game.hand + 1, banker: game.banker, bets, timestamp: now });
  for (const seat of dealt) game.holes[seat] = draw(game);
  advance(game, now);
}

/**
 * A bet is hidden until every seat that can cover the minimum, except the banker, has bet.
 * `automatic` marks server-made bets, which are accepted past the deadline. `random` is a test hook.
 */
export function bet(
  roomCode: RoomCode,
  seat: GameSeat,
  amount: number,
  automatic: boolean,
  now: number = Date.now(),
  random: () => number = secureRandom,
): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'betting') return { success: false, reason: 'Not in betting phase' };
  if (seat === game.banker) return { success: false, reason: 'The banker does not bet' };
  if (!bjSitsIn(game.chips[seat])) return { success: false, reason: 'Not enough chips to bet' };
  if (game.pendingBets[seat] !== null) return { success: false, reason: 'Already bet' };
  if (!bjIsValidBet(amount, game.chips[seat])) return { success: false, reason: 'Invalid bet' };
  if (!automatic && (game.betDeadline === null || now >= game.betDeadline)) {
    return { success: false, reason: 'Betting is closed' };
  }

  game.pendingBets[seat] = amount;
  record(game, { type: 'bet', seat, auto: automatic && !game.players[seat]?.isBot, timestamp: now });
  if (pendingBetSeats(game).length === 0) deal(game, now, random);
  return { success: true };
}

/** Draws a face-up card or stands; a draw to 10.5, a bust, or a fifth card ends the hand. */
export function act(roomCode: RoomCode, seat: GameSeat, action: TenHalfAction, now: number = Date.now()): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'Not in playing phase' };
  if (game.currentTurnSeat !== seat || game.done[seat]) return { success: false, reason: 'Not your turn' };
  if (action === 'stand') record(game, { type: 'stand', seat, timestamp: now });
  else {
    const card = draw(game);
    const cards = [...seatCards(game, seat), card];
    record(game, { type: 'hit', seat, card, done: thIsMaxed(cards), timestamp: now });
  }
  advance(game, now);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** Other seats' bets stay hidden until the deal, and hole cards until the showdown. */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): TenHalfVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  const seats = occupiedSeats(game.players);
  // Every hole card is public from the showdown on, which closes the hand it played in.
  const revealed = game.phase !== 'playing';
  return {
    gameType: 'tenhalf',
    phase: game.phase,
    mySeat: seat,
    seats,
    hand: game.hand,
    totalHands: bjMatchHands(seats.length, true),
    banker: game.banker,
    chips: game.chips,
    myBet: game.pendingBets[seat],
    betPlaced: seatMap((other) => game.pendingBets[other] !== null),
    betDeadline: game.betDeadline,
    bets: game.bets,
    dealt: game.dealt,
    holeSeats: GAME_SEAT_ORDER.filter((other) => game.holes[other] !== null),
    holes: seatMap((other) => (revealed || other === seat ? game.holes[other] : null)),
    ups: game.ups,
    done: game.done,
    currentTurnSeat: game.currentTurnSeat,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): TenHalfGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): TenHalfGameState[] {
  return [...games.values()];
}

export function restoreGames(records: TenHalfGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
