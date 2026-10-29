// ─── Go Fish Game: flow management ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  Card,
  GameSeat,
  PlayerInfo,
  Rank,
  RoomCode,
} from '@shared/types';
import type {
  GoFishFish,
  GoFishGameState,
  GoFishMatchResult,
  GoFishVisibleState,
} from '@shared/games/gofish/types';
import { GAME_SEAT_ORDER, RANK_ORDER_DESC } from '@shared/constants';
import { occupiedSeats } from '@shared/rules/seats';
import {
  GF_BOOKS_PER_HAND, GF_HANDS, gfCompleteBooks, gfCount, gfHandSize, gfLeaders, gfNextSeat, gfTargets,
} from '@shared/rules/gofish';
import { createDeck, shuffleDeck } from '../../engine/deck';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → GoFishGameState */
const games: Map<RoomCode, GoFishGameState> = new Map();

function seatMap<T>(value: (seat: GameSeat) => T): Record<GameSeat, T> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, value(seat)])) as Record<GameSeat, T>;
}

function handCounts(game: GoFishGameState): Record<GameSeat, number> {
  return seatMap((seat) => game.hands[seat].length);
}

function booksMade(game: GoFishGameState): number {
  return GAME_SEAT_ORDER.reduce((sum, seat) => sum + game.books[seat].length, 0);
}

/** Seats from the one after `seat` around the table, ending with `seat` itself. */
function seatsAfter(seats: readonly GameSeat[], seat: GameSeat): GameSeat[] {
  const order: GameSeat[] = [];
  let next = gfNextSeat(seats, seat);
  while (next !== seat) {
    order.push(next);
    next = gfNextSeat(seats, next);
  }
  return [...order, seat];
}

/** Lays down every complete book in `seat`'s hand. */
function layBooks(game: GoFishGameState, seat: GameSeat, now: number): void {
  for (const rank of gfCompleteBooks(game.hands[seat])) {
    game.hands[seat] = game.hands[seat].filter((card) => card.rank !== rank);
    game.books[seat].push(rank);
    game.log.push({ type: 'book', seat, rank, timestamp: now });
  }
}

/** A seat with no cards draws one while the stock lasts; with nothing to draw it sits out. */
function refillEmpty(game: GoFishGameState, order: readonly GameSeat[], now: number): void {
  for (const seat of order) {
    if (game.hands[seat].length > 0 || game.stock.length === 0) continue;
    game.hands[seat].push(game.stock.shift() as Card);
    game.log.push({ type: 'refill', seat, timestamp: now });
  }
}

/** Deals a hand and gives `first` the turn. */
function startHand(
  game: GoFishGameState, hand: number, first: GameSeat, deck: readonly Card[] | undefined, now: number,
): void {
  const participants = occupiedSeats(game.players);
  const size = gfHandSize(participants.length);
  const cards = [...(deck ?? shuffleDeck(createDeck()))];
  game.hand = hand;
  game.hands = seatMap((seat) => {
    const start = participants.indexOf(seat) * size;
    return start < 0 ? [] : cards.slice(start, start + size);
  });
  game.stock = cards.slice(size * participants.length);
  game.books = seatMap(() => []);
  game.currentTurnSeat = first;
  game.log.push({ type: 'hand', hand, first, timestamp: now });
  for (const seat of participants) layBooks(game, seat, now);
  settleTurn(game, first, true, now);
}

function finishMatch(game: GoFishGameState): void {
  const seats = occupiedSeats(game.players);
  const result: GoFishMatchResult = {
    gameType: 'gofish',
    seats,
    scores: { ...game.scores },
    winners: gfLeaders(seats, game.scores),
    hands: game.hand,
    handBooks: game.log.flatMap((entry) => (entry.type === 'handEnd' ? [entry.books] : [])),
  };
  game.phase = 'scoring';
  game.result = result;
}

/** Adds the hand's books to the totals, then deals the next hand or ends the match. */
function endHand(game: GoFishGameState, now: number): void {
  const seats = occupiedSeats(game.players);
  const books = seatMap((seat) => game.books[seat].length);
  game.scores = seatMap((seat) => game.scores[seat] + books[seat]);
  game.log.push({ type: 'handEnd', hand: game.hand, books, timestamp: now });
  if (game.hand >= GF_HANDS) {
    finishMatch(game);
    return;
  }
  const previousFirst = [...game.log].reverse().find((entry) => entry.type === 'hand');
  const first = gfNextSeat(seats, previousFirst?.type === 'hand' ? previousFirst.first : game.currentTurnSeat);
  startHand(game, game.hand + 1, first, undefined, now);
}

/** A seat with cards that has someone to ask can take a turn. */
function canTakeTurn(game: GoFishGameState, seat: GameSeat): boolean {
  return game.hands[seat].length > 0
    && gfTargets(occupiedSeats(game.players), handCounts(game), seat).length > 0;
}

/**
 * Finishes an action: refills empty hands, ends the hand once all 13 books are down, and picks who plays next.
 * `continues` keeps the turn with `actor` (cards received, or the fished card matched).
 */
function settleTurn(game: GoFishGameState, actor: GameSeat, continues: boolean, now: number): void {
  const seats = occupiedSeats(game.players);
  refillEmpty(game, [actor, ...seatsAfter(seats, actor).slice(0, -1)], now);
  if (booksMade(game) >= GF_BOOKS_PER_HAND) {
    endHand(game, now);
    return;
  }
  const next = (continues ? [actor] : []).concat(seatsAfter(seats, actor)).find((seat) => canTakeTurn(game, seat));
  // Unreachable while books remain: every unfinished rank still has all four cards among the hands and the stock.
  if (!next) {
    endHand(game, now);
    return;
  }
  game.currentTurnSeat = next;
}

/** `deck` and `firstSeat` are test hooks for the opening hand; later hands are shuffled. */
export function startGame(
  roomCode: RoomCode,
  players: Partial<Record<GameSeat, PlayerInfo>>,
  deck?: readonly Card[],
  firstSeat?: GameSeat,
  now: number = Date.now(),
): void {
  const participants = occupiedSeats(players);
  const first = firstSeat ?? participants[randomInt(participants.length)];
  const game: GoFishGameState = {
    gameType: 'gofish',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    hand: 0,
    hands: seatMap(() => []),
    stock: [],
    books: seatMap(() => []),
    scores: seatMap(() => 0),
    currentTurnSeat: first,
    log: [],
    result: null,
  };
  startHand(game, 1, first, deck, now);
  games.set(roomCode, game);
}

/**
 * Asks `target` for every card of `rank`. Cards received, or a fished card of that rank, let the asker go on;
 * any other draw passes the turn.
 */
export function ask(roomCode: RoomCode, seat: GameSeat, target: GameSeat, rank: Rank, now: number = Date.now()): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'Not in playing phase' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  if (!RANK_ORDER_DESC.includes(rank)) return { success: false, reason: 'Invalid rank' };
  if (target === seat) return { success: false, reason: 'You cannot ask yourself' };
  if (!occupiedSeats(game.players).includes(target)) return { success: false, reason: 'That seat is not playing' };
  if (game.hands[target].length === 0) return { success: false, reason: 'That player has no cards' };
  if (gfCount(game.hands[seat], rank) === 0) return { success: false, reason: 'You must hold the rank you ask for' };

  const taken = game.hands[target].filter((card) => card.rank === rank);
  let fished: GoFishFish | null = null;
  if (taken.length > 0) {
    game.hands[target] = game.hands[target].filter((card) => card.rank !== rank);
    game.hands[seat] = [...game.hands[seat], ...taken];
  } else {
    const drawn = game.stock.shift();
    if (drawn) {
      game.hands[seat] = [...game.hands[seat], drawn];
      fished = drawn.rank === rank ? 'lucky' : 'miss';
    } else fished = 'empty';
  }
  game.log.push({ type: 'ask', seat, target, rank, given: taken.length, fished, timestamp: now });
  layBooks(game, seat, now);
  settleTurn(game, seat, taken.length > 0 || fished === 'lucky', now);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): GoFishVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'gofish',
    phase: game.phase,
    mySeat: seat,
    seats: occupiedSeats(game.players),
    myHand: game.hands[seat],
    handCounts: handCounts(game),
    hand: game.hand,
    books: game.books,
    scores: game.scores,
    currentTurnSeat: game.currentTurnSeat,
    stockCount: game.stock.length,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): GoFishGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): GoFishGameState[] {
  return [...games.values()];
}

export function restoreGames(records: GoFishGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
