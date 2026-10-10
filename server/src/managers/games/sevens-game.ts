// ─── Sevens Game: flow management ───

import { randomUUID } from 'node:crypto';
import type {
  Card,
  PlayerInfo,
  RoomCode,
  Seat,
  SevensGameState,
  SevensMatchResult,
  SevensOptions,
  SevensVisibleState,
} from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { DEFAULT_SEVENS_OPTIONS } from '@shared/sevens-options';
import { nextSeatCounterClockwise } from '@shared/rules/seats';
import {
  svApply,
  svEmptyTable,
  svIsPlayable,
  svLegalPlays,
  svPenalty,
  svSortHand,
  svWinners,
} from '@shared/rules/sevens';
import { createDeck, shuffleDeck } from '../../engine/deck';
import { dealCards } from '../../engine/dealing';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → SevensGameState */
const games: Map<RoomCode, SevensGameState> = new Map();

function seatMap<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return { N: value('N'), E: value('E'), S: value('S'), W: value('W') };
}

const sameCard = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

/** Nothing is on the table until the spade seven opens the game. */
const isFirstPlay = (game: SevensGameState): boolean => game.table.spades === null;

function matchResult(game: SevensGameState): SevensMatchResult {
  const penalties = seatMap((seat) => svPenalty(game.covered[seat]));
  return {
    gameType: 'sevens',
    penalties,
    covered: seatMap((seat) => [...game.covered[seat]]),
    winners: svWinners(penalties),
  };
}

/** Moves to the next seat, or settles when every card has been played or covered. */
function advance(game: SevensGameState, seat: Seat): void {
  if (SEAT_ORDER_CLOCKWISE.every((other) => game.hands[other].length === 0)) {
    game.phase = 'scoring';
    game.currentTurnSeat = seat;
    game.result = matchResult(game);
    return;
  }
  game.currentTurnSeat = nextSeatCounterClockwise(seat);
}

/** `deck` is a test hook; games normally deal a fresh shuffle. */
export function startGame(
  roomCode: RoomCode,
  players: Record<Seat, PlayerInfo>,
  deck: readonly Card[] = shuffleDeck(createDeck()),
  options: SevensOptions = DEFAULT_SEVENS_OPTIONS,
): void {
  const dealt = dealCards(deck);
  const hands = seatMap((seat) => svSortHand(dealt[seat]));
  const opener = SEAT_ORDER_CLOCKWISE.find((seat) =>
    hands[seat].some((card) => card.suit === 'spades' && card.rank === 7));
  if (!opener) throw new Error('Deck must contain the seven of spades');
  games.set(roomCode, {
    gameType: 'sevens',
    id: randomUUID(),
    options: { ...options },
    startedAt: Date.now(),
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    hands,
    table: svEmptyTable(),
    covered: seatMap(() => []),
    currentTurnSeat: opener,
    log: [],
    result: null,
  });
}

function actionableGame(roomCode: RoomCode, seat: Seat, card: Card): SevensGameState | string {
  const game = games.get(roomCode);
  if (!game) return 'Game not found';
  if (game.phase !== 'playing') return 'Not in playing phase';
  if (game.currentTurnSeat !== seat) return 'Not your turn';
  if (!game.hands[seat].some((own) => sameCard(own, card))) return 'Card not in hand';
  return game;
}

function takeFromHand(game: SevensGameState, seat: Seat, card: Card): void {
  game.hands[seat] = game.hands[seat].filter((own) => !sameCard(own, card));
}

export function play(roomCode: RoomCode, seat: Seat, card: Card): Result {
  const game = actionableGame(roomCode, seat, card);
  if (typeof game === 'string') return { success: false, reason: game };
  if (!svIsPlayable(game.table, card, isFirstPlay(game), game.options?.closeOnEnd)) {
    return { success: false, reason: 'Illegal play' };
  }
  game.table = svApply(game.table, card, game.options?.closeOnEnd);
  takeFromHand(game, seat, card);
  game.log.push({ type: 'play', seat, card, timestamp: Date.now() });
  advance(game, seat);
  return { success: true };
}

export function cover(roomCode: RoomCode, seat: Seat, card: Card): Result {
  const game = actionableGame(roomCode, seat, card);
  if (typeof game === 'string') return { success: false, reason: game };
  if (svLegalPlays(game.hands[seat], game.table, isFirstPlay(game), game.options?.closeOnEnd).length > 0) {
    return { success: false, reason: 'You must play a card when you can' };
  }
  takeFromHand(game, seat, card);
  game.covered[seat].push(card);
  // The log never names the covered card so other seats cannot read it
  game.log.push({ type: 'cover', seat, timestamp: Date.now() });
  advance(game, seat);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

export function getPlayerVisibleState(roomCode: RoomCode, seat: Seat): SevensVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  const myTurn = game.phase === 'playing' && game.currentTurnSeat === seat;
  return {
    gameType: 'sevens',
    phase: game.phase,
    options: game.options ?? DEFAULT_SEVENS_OPTIONS,
    mySeat: seat,
    myHand: game.hands[seat],
    myCovered: game.covered[seat],
    handCounts: seatMap((other) => game.hands[other].length),
    coveredCounts: seatMap((other) => game.covered[other].length),
    table: game.table,
    validCards: myTurn ? svLegalPlays(game.hands[seat], game.table, isFirstPlay(game), game.options?.closeOnEnd) : [],
    currentTurnSeat: game.currentTurnSeat,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): SevensGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): SevensGameState[] {
  return [...games.values()];
}

export function restoreGames(records: SevensGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
