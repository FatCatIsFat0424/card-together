// ─── Big Two Game：台式大老二流程管理 ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  BigTwoGameState,
  BigTwoMatchResult,
  BigTwoVisibleState,
  Card,
  PlayerInfo,
  RoomCode,
  Seat,
} from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import {
  bigTwoPenalty,
  canPlay,
  findClubThreeHolder,
  identifyCombo,
  isDragon,
  legalPlays,
  nextSeatCounterClockwise,
  sortBigTwoHand,
} from '@shared/rules/bigtwo';
import { createDeck, shuffleDeck } from '../../engine/deck';
import { dealCards } from '../../engine/dealing';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → BigTwoGameState */
const games: Map<RoomCode, BigTwoGameState> = new Map();

function seatMap<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return { N: value('N'), E: value('E'), S: value('S'), W: value('W') };
}

function matchResult(hands: Record<Seat, Card[]>, winnerSeat: Seat, dragon: boolean): BigTwoMatchResult {
  return {
    gameType: 'bigtwo',
    winnerSeat,
    dragon,
    cardsLeft: seatMap((seat) => hands[seat].length),
    twosLeft: seatMap((seat) => hands[seat].filter((card) => card.rank === 2).length),
    scores: seatMap((seat) => (seat === winnerSeat ? 0 : bigTwoPenalty(hands[seat]))),
  };
}

/** `deck` is a test hook; games normally deal a fresh shuffle. */
export function startGame(
  roomCode: RoomCode,
  players: Record<Seat, PlayerInfo>,
  deck: readonly Card[] = shuffleDeck(createDeck()),
): void {
  const dealt = dealCards(deck);
  const hands = seatMap((seat) => sortBigTwoHand(dealt[seat]));
  const dragonSeat = SEAT_ORDER_CLOCKWISE.find((seat) => isDragon(hands[seat])) ?? null;
  const now = Date.now();
  games.set(roomCode, {
    gameType: 'bigtwo',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: dragonSeat ? 'scoring' : 'playing',
    hands,
    currentTurnSeat: dragonSeat ?? findClubThreeHolder(hands),
    lastPlay: null,
    lockedSeats: [],
    firstPlay: true,
    log: dragonSeat ? [{ type: 'dragon', seat: dragonSeat, timestamp: now }] : [],
    result: dragonSeat ? matchResult(hands, dragonSeat, true) : null,
  });
}

function playableGame(roomCode: RoomCode, seat: Seat): BigTwoGameState | string {
  const game = games.get(roomCode);
  if (!game) return 'Game not found';
  if (game.phase !== 'playing') return 'Not in playing phase';
  if (game.currentTurnSeat !== seat || game.lockedSeats.includes(seat)) return 'Not your turn';
  return game;
}

/** Advance only past seats that have actually passed; pending passes stay private. */
function advanceTurn(game: BigTwoGameState, from: Seat): void {
  let seat = nextSeatCounterClockwise(from);
  while (game.lastPlay && seat !== game.lastPlay.seat && game.lockedSeats.includes(seat)) {
    seat = nextSeatCounterClockwise(seat);
  }
  if (seat === game.lastPlay?.seat) {
    game.log.push({ type: 'round_end', leaderSeat: seat, timestamp: Date.now() });
    game.lastPlay = null;
    game.lockedSeats = [];
  }
  game.currentTurnSeat = seat;
}

export function needsAutoPass(game: BigTwoGameState): boolean {
  if (game.phase !== 'playing' || !game.lastPlay || game.firstPlay
    || game.currentTurnSeat === game.lastPlay.seat
    || game.lockedSeats.includes(game.currentTurnSeat)) return false;
  const previous = identifyCombo(game.lastPlay.cards);
  return previous !== null && legalPlays(game.hands[game.currentTurnSeat], previous, false).length === 0;
}

/** Sample once per eligible turn, after the preceding public presentation finishes. */
export function prepareAutoPass(roomCode: RoomCode, earliestAt: number): void {
  const game = games.get(roomCode);
  if (!game || game.pendingAutoPass || !needsAutoPass(game)) return;
  game.pendingAutoPass = { id: randomUUID(), seat: game.currentTurnSeat,
    executeAt: Math.max(Date.now(), earliestAt) + randomInt(5001) };
}

export function play(roomCode: RoomCode, seat: Seat, cards: readonly Card[]): Result {
  const game = playableGame(roomCode, seat);
  if (typeof game === 'string') return { success: false, reason: game };
  const hand = game.hands[seat];
  const held = (card: Card): boolean => hand.some((own) => own.suit === card.suit && own.rank === card.rank);
  if (!cards.every(held)) return { success: false, reason: 'Card not in hand' };
  const previous = game.lastPlay ? identifyCombo(game.lastPlay.cards) : null;
  const combo = identifyCombo(cards);
  if (!combo || !canPlay(cards, previous, game.firstPlay)) return { success: false, reason: 'Illegal play' };

  delete game.pendingAutoPass;
  game.hands[seat] = hand.filter((own) => !combo.cards.some((card) => card.suit === own.suit && card.rank === own.rank));
  game.lastPlay = { seat, cards: combo.cards, comboType: combo.type };
  game.firstPlay = false;
  game.log.push({ type: 'play', seat, cards: combo.cards, comboType: combo.type, timestamp: Date.now() });

  if (game.hands[seat].length === 0) {
    game.phase = 'scoring';
    game.result = matchResult(game.hands, seat, false);
  } else {
    advanceTurn(game, seat);
  }
  return { success: true };
}

export function pass(roomCode: RoomCode, seat: Seat): Result {
  const game = playableGame(roomCode, seat);
  if (typeof game === 'string') return { success: false, reason: game };
  if (!game.lastPlay) return { success: false, reason: 'You must lead this round' };
  delete game.pendingAutoPass;
  game.lockedSeats.push(seat);
  game.log.push({ type: 'pass', seat, timestamp: Date.now() });
  advanceTurn(game, seat);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

export function getPlayerVisibleState(roomCode: RoomCode, seat: Seat): BigTwoVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'bigtwo',
    phase: game.phase,
    mySeat: seat,
    myHand: game.hands[seat],
    handCounts: seatMap((other) => game.hands[other].length),
    currentTurnSeat: game.currentTurnSeat,
    lastPlay: game.lastPlay,
    lockedSeats: game.lockedSeats,
    firstPlay: game.firstPlay,
    log: game.log,
    result: game.result,
    revealedHands: game.phase === 'scoring' ? game.hands : null,
  };
}

export function getGameState(roomCode: RoomCode): BigTwoGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): BigTwoGameState[] {
  return [...games.values()];
}

export function restoreGames(records: BigTwoGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
