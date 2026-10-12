// ─── Blackjack Game: shared betting window, player turns, and the house or a player dealer ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  BlackjackAction,
  BlackjackDealerAction,
  BlackjackGameState,
  BlackjackOptions,
  BlackjackLogEntry,
  BlackjackVisibleState,
  Card,
  PlayerInfo,
  RoomCode,
  GameSeat,
} from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { DEFAULT_BLACKJACK_OPTIONS } from '@shared/blackjack-options';
import { occupiedSeats } from '@shared/rules/seats';
import {
  bjApplyEntry,
  bjBettingSeats,
  bjDealerActions,
  bjDealerDone,
  bjDealerPeeks,
  bjEmptyTable,
  bjIsNatural,
  bjIsValidBet,
  bjLegalActions,
  bjMatchHands,
  bjMatchOver,
  bjNextDealer,
  bjNextTurn,
  bjSettle,
  bjSitsIn,
  bjWinners,
} from '@shared/rules/blackjack';
import { createDeck, shuffleDeck } from '../../engine/deck';

type Result = { success: true } | { success: false; reason: string };

/** Deals stay unpredictable from previously observed shuffles. */
const RANDOM_RANGE = 2 ** 32;
const secureRandom = (): number => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

/** roomCode → BlackjackGameState */
const games: Map<RoomCode, BlackjackGameState> = new Map();

function seatMap<T>(value: (seat: GameSeat) => T): Record<GameSeat, T> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, value(seat)])) as Record<GameSeat, T>;
}

function record(game: BlackjackGameState, entry: BlackjackLogEntry): void {
  game.log.push(entry);
  bjApplyEntry(game, entry);
}

/**
 * Each hand holds at most 30 hard points. One deck (340 points) covers four split-capable players;
 * two decks (680 points) cover eight. A fresh shoe is used for each hand.
 */
function draw(game: BlackjackGameState): Card {
  const card = game.deck.shift();
  if (!card) throw new Error('Blackjack deck exhausted');
  return card;
}

/** Seats that must still bet this hand, ordered N, E, S, W */
export function pendingBetSeats(game: BlackjackGameState): GameSeat[] {
  return game.phase !== 'betting' ? []
    : bjBettingSeats(game.chips, game.dealerSeat).filter((seat) => game.bets[seat] === null);
}

/**
 * Seats missing from `players` stay empty for the whole match. With a player dealer the first hand
 * is dealt by a random seat taking part. `random` is a test hook.
 */
export function startGame(
  roomCode: RoomCode,
  players: Partial<Record<GameSeat, PlayerInfo>>,
  betMs: number,
  now: number = Date.now(),
  options: BlackjackOptions = DEFAULT_BLACKJACK_OPTIONS,
  random: () => number = secureRandom,
): void {
  const seats = occupiedSeats(players);
  games.set(roomCode, {
    options: { ...options },
    ...(options.playerDealer ? { dealerSeat: seats[Math.floor(random() * seats.length)] } : {}),
    gameType: 'blackjack',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'betting',
    hand: 0,
    chips: bjEmptyTable(seats).chips,
    bets: seatMap(() => null),
    betMs,
    betDeadline: now + betMs,
    deck: [],
    hands: seatMap(() => []),
    dealer: [],
    hole: null,
    currentTurnSeat: seats[0],
    activeHand: 0,
    log: [],
    result: null,
  });
}

/** Opens the betting window once the previous hand's presentation has ended. */
export function openBetting(roomCode: RoomCode, startsAt: number): void {
  const game = games.get(roomCode);
  if (game?.phase === 'betting' && game.betDeadline === null) game.betDeadline = startsAt + game.betMs;
}

/** Settles the hand, then opens betting on the next one (passing the deal on) or ends the match. */
function settle(game: BlackjackGameState, now: number): void {
  const { outcomes, net, chips } = bjSettle(game);
  record(game, { type: 'settle', hand: game.hand, outcomes, net, chips: { ...chips }, timestamp: now });
  const seats = occupiedSeats(game.players);
  if (bjMatchOver(game.hand, game.chips, seats, game.dealerSeat !== undefined)) {
    game.phase = 'scoring';
    game.result = { gameType: 'blackjack', seats, chips: { ...game.chips }, hands: game.hand,
      winners: bjWinners(game.chips, seats) };
    return;
  }
  game.phase = 'betting';
  game.bets = seatMap(() => null);
  game.betDeadline = null;
  if (game.dealerSeat) game.dealerSeat = bjNextDealer(game.dealerSeat, seats);
}

/**
 * Reveals the hole card once every player hand is finished. The house then draws to 17 when a hand
 * still needs beating and settles; a player dealer takes its own turn unless nothing is left to play.
 */
function finishHand(game: BlackjackGameState, now: number): void {
  const hole = game.hole;
  if (!hole) throw new Error('Blackjack hole card missing');
  game.hole = null;
  record(game, { type: 'reveal', card: hole, timestamp: now });
  if (game.dealerSeat && !bjDealerDone(game)) {
    game.currentTurnSeat = game.dealerSeat;
    game.activeHand = 0;
    return;
  }
  while (!bjDealerDone(game)) record(game, { type: 'dealerHit', card: draw(game), timestamp: now });
  settle(game, now);
}

function advance(game: BlackjackGameState, now: number): void {
  const next = bjNextTurn(game.hands);
  if (!next) {
    finishHand(game, now);
    return;
  }
  game.currentTurnSeat = next.seat;
  game.activeHand = next.handIndex;
}

/** Deals two cards to each bettor and the dealer; a dealer blackjack under a peek ends the hand at once. */
function deal(game: BlackjackGameState, now: number, random: () => number): void {
  const bets = seatMap((seat) => game.bets[seat] ?? 0);
  game.deck = shuffleDeck(occupiedSeats(game.players).length > 4 ? [...createDeck(), ...createDeck()] : createDeck(), random);
  const bettors = GAME_SEAT_ORDER.filter((seat) => bets[seat] > 0);
  const cards = seatMap((): Card[] => []);
  for (const seat of bettors) cards[seat].push(draw(game));
  const upCard = draw(game);
  for (const seat of bettors) cards[seat].push(draw(game));
  game.hole = draw(game);
  game.bets = seatMap(() => null);
  game.betDeadline = null;
  game.phase = 'playing';
  record(game, { type: 'deal', hand: game.hand + 1, bets, cards, upCard,
    ...(game.dealerSeat ? { dealer: game.dealerSeat } : {}), timestamp: now });
  if (bjDealerPeeks(upCard) && bjIsNatural({ cards: [upCard, game.hole], split: false })) {
    finishHand(game, now);
    return;
  }
  advance(game, now);
}

/**
 * A bet is hidden until every seat that can cover the minimum, except a player dealer, has bet.
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
  if (seat === game.dealerSeat) return { success: false, reason: 'The dealer does not bet' };
  if (!bjSitsIn(game.chips[seat])) return { success: false, reason: 'Not enough chips to bet' };
  if (game.bets[seat] !== null) return { success: false, reason: 'Already bet' };
  if (!bjIsValidBet(amount, game.chips[seat])) return { success: false, reason: 'Invalid bet' };
  if (!automatic && (game.betDeadline === null || now >= game.betDeadline)) {
    return { success: false, reason: 'Betting is closed' };
  }

  game.bets[seat] = amount;
  record(game, { type: 'bet', seat, auto: automatic && !game.players[seat]?.isBot, timestamp: now });
  if (pendingBetSeats(game).length === 0) deal(game, now, random);
  return { success: true };
}

export function act(roomCode: RoomCode, seat: GameSeat, action: BlackjackAction, now: number = Date.now()): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'Not in playing phase' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  const handIndex = game.activeHand;
  if (!bjLegalActions(game.hands[seat], handIndex, game.chips[seat]).includes(action)) {
    return { success: false, reason: 'This action is not available' };
  }
  if (action === 'stand') record(game, { type: 'stand', seat, handIndex, timestamp: now });
  else if (action === 'split') {
    record(game, { type: 'split', seat, handIndex, cards: [draw(game), draw(game)], timestamp: now });
  } else record(game, { type: action, seat, handIndex, card: draw(game), timestamp: now });
  advance(game, now);
  return { success: true };
}

/** The player dealer's turn, after every player hand: it must hit below 17 and may stand from 17. */
export function dealerAct(
  roomCode: RoomCode, seat: GameSeat, action: BlackjackDealerAction, now: number = Date.now(),
): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'Not in playing phase' };
  if (!game.dealerSeat || game.dealerSeat !== seat) return { success: false, reason: 'You are not the dealer' };
  if (game.currentTurnSeat !== seat || game.hole !== null) return { success: false, reason: 'Not your turn' };
  if (!bjDealerActions(game.dealer).includes(action)) {
    return { success: false, reason: action === 'stand' ? 'The dealer must hit below 17' : 'This action is not available' };
  }
  record(game, action === 'hit' ? { type: 'dealerHit', card: draw(game), timestamp: now }
    : { type: 'dealerStand', timestamp: now });
  if (bjDealerDone(game)) settle(game, now);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/**
 * Other seats' bets stay hidden until the deal; the hole card until the dealer reveals it, except
 * from a player dealer, who holds it.
 */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): BlackjackVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  const seats = occupiedSeats(game.players);
  const options = game.options ?? DEFAULT_BLACKJACK_OPTIONS;
  return {
    ...(game.hole && seat === game.dealerSeat ? { myHole: game.hole } : {}),
    options,
    dealerSeat: game.dealerSeat ?? null,
    totalHands: bjMatchHands(seats.length, game.dealerSeat !== undefined),
    gameType: 'blackjack',
    phase: game.phase,
    mySeat: seat,
    seats,
    hand: game.hand,
    chips: game.chips,
    myBet: game.bets[seat],
    betPlaced: seatMap((other) => game.bets[other] !== null),
    betDeadline: game.betDeadline,
    hands: game.hands,
    dealer: game.dealer,
    holeHidden: game.hole !== null,
    currentTurnSeat: game.currentTurnSeat,
    activeHand: game.activeHand,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): BlackjackGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): BlackjackGameState[] {
  return [...games.values()];
}

export function restoreGames(records: BlackjackGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
