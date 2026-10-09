// ─── Red Points Game: flow management ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  Card,
  PlayerInfo,
  RedPointsGameState,
  RedPointsMatchResult,
  RedPointsVisibleState,
  RoomCode,
  Seat,
} from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { nextSeatCounterClockwise } from '@shared/rules/seats';
import { RP_HAND_SIZE, RP_TABLE_SIZE, rpNeedsRedeal, rpPairOptions, rpScore } from '@shared/rules/redpoints';
import { createDeck, shuffleDeck } from '../../engine/deck';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → RedPointsGameState */
const games: Map<RoomCode, RedPointsGameState> = new Map();

function seatMap<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return { N: value('N'), E: value('E'), S: value('S'), W: value('W') };
}

const sameCard = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

function matchResult(captured: Record<Seat, Card[]>): RedPointsMatchResult {
  const points = seatMap((seat) => rpScore(captured[seat]));
  const best = Math.max(...SEAT_ORDER_CLOCKWISE.map((seat) => points[seat]));
  return { gameType: 'redpoints', points, winners: SEAT_ORDER_CLOCKWISE.filter((seat) => points[seat] === best) };
}

/** `deck` and `firstSeat` are test hooks; a deck whose table needs a redeal is replaced by fresh shuffles. */
export function startGame(
  roomCode: RoomCode,
  players: Record<Seat, PlayerInfo>,
  deck: readonly Card[] = shuffleDeck(createDeck()),
  firstSeat: Seat = SEAT_ORDER_CLOCKWISE[randomInt(4)],
): void {
  const tableStart = RP_HAND_SIZE * 4;
  let cards = [...deck];
  while (rpNeedsRedeal(cards.slice(tableStart, tableStart + RP_TABLE_SIZE))) cards = shuffleDeck(createDeck());
  games.set(roomCode, {
    gameType: 'redpoints',
    id: randomUUID(),
    startedAt: Date.now(),
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    hands: seatMap((seat) => {
      const start = SEAT_ORDER_CLOCKWISE.indexOf(seat) * RP_HAND_SIZE;
      return cards.slice(start, start + RP_HAND_SIZE);
    }),
    table: cards.slice(tableStart, tableStart + RP_TABLE_SIZE),
    stock: cards.slice(tableStart + RP_TABLE_SIZE),
    captured: seatMap(() => []),
    currentTurnSeat: firstSeat,
    step: 'play',
    pendingFlip: null,
    log: [],
    result: null,
  });
}

function activeGame(roomCode: RoomCode, seat: Seat): RedPointsGameState | string {
  const game = games.get(roomCode);
  if (!game) return 'Game not found';
  if (game.phase !== 'playing') return 'Not in playing phase';
  if (game.currentTurnSeat !== seat) return 'Not your turn';
  return game;
}

/** Resolves which table card `card` takes: null = stays on the table, string = invalid choice. */
function captureTarget(card: Card, table: readonly Card[], capture: Card | undefined): Card | null | string {
  const options = rpPairOptions(card, table);
  if (options.length === 0) return capture ? 'Nothing to capture' : null;
  if (!capture) return options.length === 1 ? options[0] : 'Choose a card to capture';
  return options.find((option) => sameCard(option, capture)) ?? 'Cannot capture that card';
}

/** Moves `card` and its capture into the seat's pile, or leaves `card` on the table. */
function settle(game: RedPointsGameState, type: 'play' | 'flip', seat: Seat, card: Card, captured: Card | null): void {
  if (captured) {
    game.table = game.table.filter((entry) => !sameCard(entry, captured));
    game.captured[seat].push(card, captured);
  } else {
    game.table.push(card);
  }
  game.log.push({ type, seat, card, captured, timestamp: Date.now() });
}

function endTurn(game: RedPointsGameState): void {
  if (game.stock.length === 0 && SEAT_ORDER_CLOCKWISE.every((seat) => game.hands[seat].length === 0)) {
    game.phase = 'scoring';
    game.result = matchResult(game.captured);
  } else {
    game.currentTurnSeat = nextSeatCounterClockwise(game.currentTurnSeat);
  }
}

export function play(roomCode: RoomCode, seat: Seat, card: Card, capture?: Card): Result {
  const game = activeGame(roomCode, seat);
  if (typeof game === 'string') return { success: false, reason: game };
  if (game.step !== 'play') return { success: false, reason: 'Choose a card for the flipped card first' };
  const hand = game.hands[seat];
  if (!hand.some((own) => sameCard(own, card))) return { success: false, reason: 'Card not in hand' };
  const target = captureTarget(card, game.table, capture);
  if (typeof target === 'string') return { success: false, reason: target };

  game.hands[seat] = hand.filter((own) => !sameCard(own, card));
  settle(game, 'play', seat, card, target);

  const flipped = game.stock.shift();
  if (flipped) {
    const options = rpPairOptions(flipped, game.table);
    if (options.length >= 2) {
      game.step = 'flip-choose';
      game.pendingFlip = flipped;
      return { success: true };
    }
    settle(game, 'flip', seat, flipped, options[0] ?? null);
  }
  endTurn(game);
  return { success: true };
}

export function chooseFlip(roomCode: RoomCode, seat: Seat, capture: Card): Result {
  const game = activeGame(roomCode, seat);
  if (typeof game === 'string') return { success: false, reason: game };
  const flipped = game.pendingFlip;
  if (game.step !== 'flip-choose' || !flipped) return { success: false, reason: 'No flipped card to resolve' };
  const target = captureTarget(flipped, game.table, capture);
  if (typeof target === 'string' || !target) return { success: false, reason: 'Cannot capture that card' };
  game.step = 'play';
  game.pendingFlip = null;
  settle(game, 'flip', seat, flipped, target);
  endTurn(game);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

export function getPlayerVisibleState(roomCode: RoomCode, seat: Seat): RedPointsVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'redpoints',
    phase: game.phase,
    mySeat: seat,
    myHand: game.hands[seat],
    handCounts: seatMap((other) => game.hands[other].length),
    table: game.table,
    stockCount: game.stock.length,
    captured: game.captured,
    currentTurnSeat: game.currentTurnSeat,
    step: game.step,
    pendingFlip: game.pendingFlip,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): RedPointsGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): RedPointsGameState[] {
  return [...games.values()];
}

export function restoreGames(records: RedPointsGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
