// ─── Blackjack Game: shared betting window, player turns, and the house dealer ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  BlackjackAction,
  BlackjackGameState,
  BlackjackLogEntry,
  BlackjackVisibleState,
  Card,
  PlayerInfo,
  RoomCode,
  Seat,
} from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import {
  BJ_HANDS,
  BJ_STARTING_CHIPS,
  bjApplyEntry,
  bjDealerHits,
  bjDealerMustDraw,
  bjDealerPeeks,
  bjIsNatural,
  bjIsValidBet,
  bjLegalActions,
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

function seatMap<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return { N: value('N'), E: value('E'), S: value('S'), W: value('W') };
}

function record(game: BlackjackGameState, entry: BlackjackLogEntry): void {
  game.log.push(entry);
  bjApplyEntry(game, entry);
}

/**
 * Hands that stop at 21 or bust can never use 52 cards: a hand holds at most 30 hard points and the
 * deck 340, even with the dealer and two split hands per seat. A fresh deck per hand always suffices.
 */
function draw(game: BlackjackGameState): Card {
  const card = game.deck.shift();
  if (!card) throw new Error('Blackjack deck exhausted');
  return card;
}

/** Seats that must still bet this hand, ordered N, E, S, W */
export function pendingBetSeats(game: BlackjackGameState): Seat[] {
  return game.phase !== 'betting' ? []
    : SEAT_ORDER_CLOCKWISE.filter((seat) => bjSitsIn(game.chips[seat]) && game.bets[seat] === null);
}

export function startGame(
  roomCode: RoomCode,
  players: Record<Seat, PlayerInfo>,
  betMs: number,
  now: number = Date.now(),
): void {
  games.set(roomCode, {
    gameType: 'blackjack',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'betting',
    hand: 0,
    chips: seatMap(() => BJ_STARTING_CHIPS),
    bets: seatMap(() => null),
    betMs,
    betDeadline: now + betMs,
    deck: [],
    hands: seatMap(() => []),
    dealer: [],
    hole: null,
    currentTurnSeat: 'N',
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

/** Reveals the hole card, draws to 17 when a hand still needs beating, then settles. */
function finishHand(game: BlackjackGameState, now: number): void {
  const hole = game.hole;
  if (!hole) throw new Error('Blackjack hole card missing');
  game.hole = null;
  record(game, { type: 'reveal', card: hole, timestamp: now });
  const naturalDealer = bjIsNatural({ cards: game.dealer, split: false });
  while (!naturalDealer && bjDealerMustDraw(game.hands) && bjDealerHits(game.dealer)) {
    record(game, { type: 'dealerHit', card: draw(game), timestamp: now });
  }
  const { outcomes, net, chips } = bjSettle(game);
  record(game, { type: 'settle', hand: game.hand, outcomes, net, chips: { ...chips }, timestamp: now });

  if (game.hand >= BJ_HANDS || !SEAT_ORDER_CLOCKWISE.some((seat) => bjSitsIn(game.chips[seat]))) {
    game.phase = 'scoring';
    game.result = { gameType: 'blackjack', chips: { ...game.chips }, hands: game.hand, winners: bjWinners(game.chips) };
    return;
  }
  game.phase = 'betting';
  game.bets = seatMap(() => null);
  game.betDeadline = null;
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
  game.deck = shuffleDeck(createDeck(), random);
  const bettors = SEAT_ORDER_CLOCKWISE.filter((seat) => bets[seat] > 0);
  const cards = seatMap((): Card[] => []);
  for (const seat of bettors) cards[seat].push(draw(game));
  const upCard = draw(game);
  for (const seat of bettors) cards[seat].push(draw(game));
  game.hole = draw(game);
  game.bets = seatMap(() => null);
  game.betDeadline = null;
  game.phase = 'playing';
  record(game, { type: 'deal', hand: game.hand + 1, bets, cards, upCard, timestamp: now });
  if (bjDealerPeeks(upCard) && bjIsNatural({ cards: [upCard, game.hole], split: false })) {
    finishHand(game, now);
    return;
  }
  advance(game, now);
}

/**
 * A bet is hidden until every seat that can cover the minimum has bet. `automatic` marks
 * server-made bets, which are accepted past the deadline. `random` is a test hook.
 */
export function bet(
  roomCode: RoomCode,
  seat: Seat,
  amount: number,
  automatic: boolean,
  now: number = Date.now(),
  random: () => number = secureRandom,
): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'betting') return { success: false, reason: 'Not in betting phase' };
  if (!bjSitsIn(game.chips[seat])) return { success: false, reason: 'Not enough chips to bet' };
  if (game.bets[seat] !== null) return { success: false, reason: 'Already bet' };
  if (!bjIsValidBet(amount, game.chips[seat])) return { success: false, reason: 'Invalid bet' };
  if (!automatic && (game.betDeadline === null || now >= game.betDeadline)) {
    return { success: false, reason: 'Betting is closed' };
  }

  game.bets[seat] = amount;
  record(game, { type: 'bet', seat, auto: automatic && !game.players[seat].isBot, timestamp: now });
  if (pendingBetSeats(game).length === 0) deal(game, now, random);
  return { success: true };
}

export function act(roomCode: RoomCode, seat: Seat, action: BlackjackAction, now: number = Date.now()): Result {
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

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** Other seats' bets stay hidden until the deal; the hole card until the dealer reveals it. */
export function getPlayerVisibleState(roomCode: RoomCode, seat: Seat): BlackjackVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'blackjack',
    phase: game.phase,
    mySeat: seat,
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
