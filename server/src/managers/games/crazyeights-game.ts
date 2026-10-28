// ─── Crazy Eights Game: flow management ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  Card,
  GameSeat,
  PlayerInfo,
  RoomCode,
  Suit,
} from '@shared/types';
import type {
  CrazyEightsGameState,
  CrazyEightsMatchResult,
  CrazyEightsOptions,
  CrazyEightsVisibleState,
} from '@shared/games/crazyeights/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { DEFAULT_CRAZYEIGHTS_OPTIONS } from '@shared/crazyeights-options';
import { occupiedSeats } from '@shared/rules/seats';
import {
  CE_HANDS, CE_SUITS, CE_WILD_RANK, ceDeckCount, ceEffect, ceFlip, ceHandPoints, ceHandSize, ceIsPlayable,
  ceLowestSeats, ceNeedsSuit, ceNextSeat, ceTurnOptions,
} from '@shared/rules/crazyeights';
import type { CeTurnOptions } from '@shared/rules/crazyeights';
import { createDeck, shuffleDeck } from '../../engine/deck';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → CrazyEightsGameState */
const games: Map<RoomCode, CrazyEightsGameState> = new Map();

function seatMap<T>(value: (seat: GameSeat) => T): Record<GameSeat, T> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, value(seat)])) as Record<GameSeat, T>;
}

const sameCard = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

/** One or two shuffled decks, depending on the number of players. */
export function newCrazyEightsDeck(players: number): Card[] {
  return shuffleDeck(Array.from({ length: ceDeckCount(players) }, () => createDeck()).flat());
}

/** Cards a draw can still deliver: the stock plus every discard below the top. */
function drawable(game: CrazyEightsGameState): number {
  return game.stock.length + Math.max(0, game.discard.length - 1);
}

/** An empty stock is refilled from the discards below the top card. */
function takeCard(game: CrazyEightsGameState): Card | null {
  if (game.stock.length === 0 && game.discard.length > 1) {
    game.stock = shuffleDeck(game.discard.slice(0, -1));
    game.discard = game.discard.slice(-1);
  }
  return game.stock.shift() ?? null;
}

function topCard(game: CrazyEightsGameState): Card {
  return game.discard[game.discard.length - 1];
}

/** Deals a hand, turns up a starter that is not an 8, and gives `first` the turn. */
function startHand(
  game: CrazyEightsGameState, hand: number, first: GameSeat, deck: readonly Card[] | undefined, now: number,
): void {
  const participants = occupiedSeats(game.players);
  const size = ceHandSize(participants.length);
  const cards = [...(deck ?? newCrazyEightsDeck(participants.length))];
  game.hand = hand;
  game.hands = seatMap((seat) => {
    const start = participants.indexOf(seat) * size;
    return start < 0 ? [] : cards.slice(start, start + size);
  });
  game.stock = cards.slice(size * participants.length);
  // Eight-free start keeps the opening suit unambiguous; skipped 8s stay near the top of the stock.
  const starterIndex = game.stock.findIndex((card) => card.rank !== CE_WILD_RANK);
  const [starter] = game.stock.splice(Math.max(0, starterIndex), 1);
  game.discard = [starter];
  game.activeSuit = starter.suit;
  game.direction = 'ccw';
  game.drawn = false;
  game.currentTurnSeat = first;
  game.log.push({ type: 'hand', hand, first, starter, timestamp: now });
}

function finishMatch(game: CrazyEightsGameState): void {
  const seats = occupiedSeats(game.players);
  const result: CrazyEightsMatchResult = {
    gameType: 'crazyeights',
    seats,
    scores: { ...game.scores },
    winners: ceLowestSeats(seats, game.scores),
    hands: game.hand,
    handWinners: game.log.flatMap((entry) => (entry.type === 'handEnd' ? [entry.winner] : [])),
  };
  game.phase = 'scoring';
  game.result = result;
}

/** Scores the remaining cards, then deals the next hand or ends the match. */
function endHand(game: CrazyEightsGameState, winner: GameSeat, now: number): void {
  const seats = occupiedSeats(game.players);
  const points = seatMap((seat) => (seats.includes(seat) ? ceHandPoints(game.hands[seat]) : 0));
  game.scores = seatMap((seat) => game.scores[seat] + points[seat]);
  game.log.push({ type: 'handEnd', hand: game.hand, winner, points, timestamp: now });
  if (game.hand >= CE_HANDS) {
    finishMatch(game);
    return;
  }
  const previousFirst = [...game.log].reverse().find((entry) => entry.type === 'hand');
  const first = ceNextSeat(seats, previousFirst?.type === 'hand' ? previousFirst.first : game.currentTurnSeat, 'ccw');
  startHand(game, game.hand + 1, first, undefined, now);
}

/** `deck` and `firstSeat` are test hooks for the opening hand; later hands are shuffled. */
export function startGame(
  roomCode: RoomCode,
  players: Partial<Record<GameSeat, PlayerInfo>>,
  deck?: readonly Card[],
  firstSeat?: GameSeat,
  options: CrazyEightsOptions = DEFAULT_CRAZYEIGHTS_OPTIONS,
  now: number = Date.now(),
): void {
  const participants = occupiedSeats(players);
  const first = firstSeat ?? participants[randomInt(participants.length)];
  const game: CrazyEightsGameState = {
    gameType: 'crazyeights',
    id: randomUUID(),
    options: { ...options },
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    hand: 0,
    hands: seatMap(() => []),
    stock: [],
    discard: [],
    activeSuit: 'spades',
    direction: 'ccw',
    currentTurnSeat: first,
    drawn: false,
    scores: seatMap(() => 0),
    log: [],
    result: null,
  };
  startHand(game, 1, first, deck, now);
  games.set(roomCode, game);
}

function activeGame(roomCode: RoomCode, seat: GameSeat): CrazyEightsGameState | Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'Not in playing phase' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  return game;
}

function advance(game: CrazyEightsGameState, from: GameSeat): void {
  game.drawn = false;
  game.currentTurnSeat = ceNextSeat(occupiedSeats(game.players), from, game.direction);
}

export function play(roomCode: RoomCode, seat: GameSeat, card: Card, suit?: Suit, now: number = Date.now()): Result {
  const game = activeGame(roomCode, seat);
  if (!('gameType' in game)) return game;
  const hand = game.hands[seat];
  const index = hand.findIndex((own) => sameCard(own, card));
  if (index < 0) return { success: false, reason: 'Card not in hand' };
  if (!ceIsPlayable(card, topCard(game), game.activeSuit)) return { success: false, reason: 'That card does not match' };
  if (card.rank !== CE_WILD_RANK && suit !== undefined) return { success: false, reason: 'Only an 8 declares a suit' };
  if (suit !== undefined && !CE_SUITS.includes(suit)) return { success: false, reason: 'Invalid suit' };
  if (ceNeedsSuit(card, hand.length) && suit === undefined) return { success: false, reason: 'Declare a suit for the 8' };

  // Two decks can put both copies of a card in one hand; exactly one copy leaves.
  game.hands[seat] = [...hand.slice(0, index), ...hand.slice(index + 1)];
  game.discard.push(card);
  game.activeSuit = card.rank === CE_WILD_RANK ? suit ?? card.suit : card.suit;
  const declared = card.rank === CE_WILD_RANK ? suit ?? null : null;
  if (game.hands[seat].length === 0) {
    game.log.push({ type: 'play', seat, card, suit: declared, effect: null, target: null, drawn: 0, timestamp: now });
    endHand(game, seat, now);
    return { success: true };
  }

  const seats = occupiedSeats(game.players);
  const effect = ceEffect(card, game.options.actionCards);
  let target: GameSeat | null = null;
  let drawn = 0;
  let next: GameSeat;
  if (effect === 'reverse') {
    game.direction = ceFlip(game.direction);
    // Heads-up, reversing skips the opponent, so the same seat plays again.
    if (seats.length === 2) {
      target = ceNextSeat(seats, seat, game.direction);
      next = seat;
    } else next = ceNextSeat(seats, seat, game.direction);
  } else {
    const following = ceNextSeat(seats, seat, game.direction);
    if (effect === null) next = following;
    else {
      target = following;
      if (effect === 'draw') {
        for (let count = 0; count < 2; count++) {
          const penalty = takeCard(game);
          if (!penalty) break;
          game.hands[following].push(penalty);
          drawn++;
        }
      }
      next = ceNextSeat(seats, following, game.direction);
    }
  }
  game.log.push({ type: 'play', seat, card, suit: declared, effect, target, drawn, timestamp: now });
  game.drawn = false;
  game.currentTurnSeat = next;
  return { success: true };
}

function turnOptions(game: CrazyEightsGameState, seat: GameSeat): CeTurnOptions {
  return ceTurnOptions(game.hands[seat], topCard(game), game.activeSuit, game.drawn, drawable(game));
}

/** With no playable card, draws one; a playable draw may be played or passed, anything else passes at once. */
export function draw(roomCode: RoomCode, seat: GameSeat, now: number = Date.now()): Result {
  const game = activeGame(roomCode, seat);
  if (!('gameType' in game)) return game;
  if (game.drawn) return { success: false, reason: 'You already drew this turn' };
  if (turnOptions(game, seat).playable.length > 0) return { success: false, reason: 'You must play a card' };
  const card = takeCard(game);
  if (!card) return { success: false, reason: 'Nothing left to draw' };
  game.hands[seat].push(card);
  game.log.push({ type: 'draw', seat, timestamp: now });
  if (ceIsPlayable(card, topCard(game), game.activeSuit)) {
    game.drawn = true;
    return { success: true };
  }
  game.log.push({ type: 'pass', seat, timestamp: now });
  advance(game, seat);
  return { success: true };
}

/** Passing is allowed after drawing, or when nothing can be played or drawn. */
export function pass(roomCode: RoomCode, seat: GameSeat, now: number = Date.now()): Result {
  const game = activeGame(roomCode, seat);
  if (!('gameType' in game)) return game;
  const options = turnOptions(game, seat);
  if (!options.canPass) {
    return { success: false, reason: options.playable.length > 0 ? 'You must play a card' : 'Draw a card first' };
  }
  game.log.push({ type: 'pass', seat, timestamp: now });
  advance(game, seat);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): CrazyEightsVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'crazyeights',
    phase: game.phase,
    options: game.options,
    mySeat: seat,
    seats: occupiedSeats(game.players),
    myHand: game.hands[seat],
    handCounts: seatMap((other) => game.hands[other].length),
    hand: game.hand,
    scores: game.scores,
    direction: game.direction,
    currentTurnSeat: game.currentTurnSeat,
    drawn: game.drawn,
    lastPlayed: game.discard.at(-1) ?? null,
    activeSuit: game.activeSuit,
    stockCount: game.stock.length,
    reserveCount: Math.max(0, game.discard.length - 1),
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): CrazyEightsGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): CrazyEightsGameState[] {
  return [...games.values()];
}

export function restoreGames(records: CrazyEightsGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
