// ─── Ninety-Nine Game: flow management ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  Card,
  NinetyNineGameState,
  NinetyNineVisibleState,
  PlayerInfo,
  RoomCode,
  Seat,
} from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { nextSeatClockwise, nextSeatCounterClockwise } from '@shared/rules/seats';
import { NN_HAND_SIZE, NN_MAX, nnApply, nnHasPlayable, nnIsPlayable, nnRequiresChoice } from '@shared/rules/ninetynine';
import type { NnChoice } from '@shared/rules/ninetynine';
import { createDeck, shuffleDeck } from '../../engine/deck';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → NinetyNineGameState */
const games: Map<RoomCode, NinetyNineGameState> = new Map();

function seatMap<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return { N: value('N'), E: value('E'), S: value('S'), W: value('W') };
}

const sameCard = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

/** Next seat still in the game, following the current direction. */
function nextAlive(game: NinetyNineGameState, seat: Seat): Seat {
  const step = game.direction === 'ccw' ? nextSeatCounterClockwise : nextSeatClockwise;
  let next = step(seat);
  while (game.eliminated.includes(next)) next = step(next);
  return next;
}

/** Turn lands on `seat`: busted seats are eliminated in turn until someone can play or one player remains. */
function landOn(game: NinetyNineGameState, seat: Seat): void {
  let current = seat;
  while (!nnHasPlayable(game.total, game.hands[current])) {
    game.eliminated.push(current);
    // Discarded hand goes under the top card so the top stays the most recently played
    game.discard.splice(Math.max(0, game.discard.length - 1), 0, ...game.hands[current]);
    game.hands[current] = [];
    game.log.push({ type: 'eliminated', seat: current, timestamp: Date.now() });
    const alive = SEAT_ORDER_CLOCKWISE.filter((other) => !game.eliminated.includes(other));
    if (alive.length === 1) {
      game.phase = 'scoring';
      game.currentTurnSeat = alive[0];
      game.result = {
        gameType: 'ninetynine', winnerSeat: alive[0], eliminationOrder: [...game.eliminated], finalTotal: game.total,
      };
      return;
    }
    current = nextAlive(game, current);
  }
  game.currentTurnSeat = current;
}

/** Draws the stock top; an empty stock is refilled from the discard pile except its top card. */
function draw(game: NinetyNineGameState, seat: Seat): void {
  if (game.stock.length === 0) {
    game.stock = shuffleDeck(game.discard.slice(0, -1));
    game.discard = game.discard.slice(-1);
  }
  const card = game.stock.shift();
  if (card) game.hands[seat].push(card);
}

/** `deck` and `firstSeat` are test hooks. */
export function startGame(
  roomCode: RoomCode,
  players: Record<Seat, PlayerInfo>,
  deck: readonly Card[] = shuffleDeck(createDeck()),
  firstSeat: Seat = SEAT_ORDER_CLOCKWISE[randomInt(4)],
): void {
  const game: NinetyNineGameState = {
    gameType: 'ninetynine',
    id: randomUUID(),
    startedAt: Date.now(),
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    hands: seatMap((seat) => {
      const start = SEAT_ORDER_CLOCKWISE.indexOf(seat) * NN_HAND_SIZE;
      return deck.slice(start, start + NN_HAND_SIZE);
    }),
    stock: deck.slice(NN_HAND_SIZE * 4),
    discard: [],
    total: 0,
    direction: 'ccw',
    currentTurnSeat: firstSeat,
    eliminated: [],
    log: [],
    result: null,
  };
  landOn(game, firstSeat);
  games.set(roomCode, game);
}

export function play(roomCode: RoomCode, seat: Seat, card: Card, choice?: NnChoice, target?: Seat): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'Not in playing phase' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  const hand = game.hands[seat];
  if (!hand.some((own) => sameCard(own, card))) return { success: false, reason: 'Card not in hand' };
  if (!nnIsPlayable(game.total, card)) return { success: false, reason: 'That card would exceed 99' };
  const needsChoice = nnRequiresChoice(card);
  if (needsChoice !== (choice !== undefined)) {
    return { success: false, reason: needsChoice ? 'Choose plus or minus' : 'This card takes no choice' };
  }
  const effect = nnApply(game.total, card, choice);
  if (effect.total > NN_MAX) return { success: false, reason: 'That card would exceed 99' };
  if (effect.designate !== (target !== undefined)) {
    return { success: false, reason: effect.designate ? 'Choose the next player' : 'This card takes no target' };
  }
  if (target !== undefined && (target === seat || game.eliminated.includes(target))) {
    return { success: false, reason: 'Invalid target' };
  }

  game.hands[seat] = hand.filter((own) => !sameCard(own, card));
  game.discard.push(card);
  game.total = effect.total;
  if (effect.reverse) game.direction = game.direction === 'ccw' ? 'cw' : 'ccw';
  game.log.push({
    type: 'play', seat, card, choice: choice ?? null, target: target ?? null, total: game.total, timestamp: Date.now(),
  });
  draw(game, seat);
  const next = nextAlive(game, seat);
  landOn(game, target ?? next);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

export function getPlayerVisibleState(roomCode: RoomCode, seat: Seat): NinetyNineVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'ninetynine',
    phase: game.phase,
    mySeat: seat,
    myHand: game.hands[seat],
    handCounts: seatMap((other) => game.hands[other].length),
    total: game.total,
    direction: game.direction,
    currentTurnSeat: game.currentTurnSeat,
    lastPlayed: game.discard.at(-1) ?? null,
    stockCount: game.stock.length,
    eliminated: game.eliminated,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): NinetyNineGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): NinetyNineGameState[] {
  return [...games.values()];
}

export function restoreGames(records: NinetyNineGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
