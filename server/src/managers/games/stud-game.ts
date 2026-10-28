// ─── Five-Card Stud Game: no-limit hands with antes and rising stakes ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  Card,
  StudAction,
  StudGameState,
  StudLogEntry,
  StudStreet,
  StudVisibleState,
  PlayerInfo,
  RoomCode,
  GameSeat,
} from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import {
  heEliminations,
  heInHand,
  heLegalActions,
  heMatchOver,
  heNextButton,
  heNextSeat,
  heNextToAct,
  heWinners,
} from '@shared/rules/holdem';
import { STUD_FINAL_STREET, studApplyEntry, studAward, studEmptyTable, studFirstToAct, studStakes } from '@shared/rules/stud';
import { occupiedSeats } from '@shared/rules/seats';
import { createDeck, shuffleDeck } from '../../engine/deck';

type Result = { success: true } | { success: false; reason: string };

/** Deals stay unpredictable from previously observed shuffles. */
const RANDOM_RANGE = 2 ** 32;
const secureRandom = (): number => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

/** roomCode → StudGameState */
const games: Map<RoomCode, StudGameState> = new Map();

function seatMap<T>(value: (seat: GameSeat) => T): Record<GameSeat, T> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, value(seat)])) as Record<GameSeat, T>;
}

function record(game: StudGameState, entry: StudLogEntry): void {
  game.log.push(entry);
  studApplyEntry(game, entry);
}

function draw(game: StudGameState): Card {
  const card = game.deck.shift();
  if (!card) throw new Error('Stud deck exhausted');
  return card;
}

/** Seats in `seats`, starting from the one clockwise after the button. */
function dealOrder(button: GameSeat, seats: readonly GameSeat[]): GameSeat[] {
  const order: GameSeat[] = [];
  let seat = heNextSeat(button, (candidate) => seats.includes(candidate)) ?? button;
  for (let count = 0; count < seats.length; count++) {
    order.push(seat);
    seat = heNextSeat(seat, (candidate) => seats.includes(candidate)) ?? seat;
  }
  return order;
}

/** Deals one up card to every unfolded seat for `street`, from the button's left. */
function dealUpCards(game: StudGameState, street: StudStreet, now: number): void {
  const cards = seatMap((): Card[] => []);
  for (const seat of dealOrder(game.button, heInHand(game))) cards[seat].push(draw(game));
  record(game, { type: 'street', street, cards, timestamp: now });
}

/** Shuffles, posts antes, deals each seat a hole card, then its first up card. */
function startHand(game: StudGameState, button: GameSeat, now: number, random: () => number): void {
  game.deck = shuffleDeck(createDeck(), random);
  const hand = game.hand + 1;
  const { ante, minBet } = studStakes(hand);
  const dealt = GAME_SEAT_ORDER.filter((seat) => game.chips[seat] > 0);
  const hands = seatMap((): Card[] => []);
  for (const seat of dealOrder(button, dealt)) hands[seat].push(draw(game));
  game.hands = hands;
  const antes = seatMap((seat) => dealt.includes(seat) ? Math.min(ante, game.chips[seat]) : 0);
  record(game, { type: 'hand', hand, button, ante, minBet, antes, timestamp: now });
  dealUpCards(game, 2, now);
  progress(game, studFirstToAct(game), now, random);
}

/**
 * Gives the turn to `next`, or once betting closes deals the next up card, shows down, awards the
 * pots, and starts the following hand or ends the match.
 */
function progress(game: StudGameState, next: GameSeat | null, now: number, random: () => number): void {
  let seat = next;
  while (!seat) {
    const inHand = heInHand(game);
    if (inHand.length > 1 && game.street < STUD_FINAL_STREET) {
      dealUpCards(game, (game.street + 1) as StudStreet, now);
      seat = studFirstToAct(game);
      continue;
    }
    if (inHand.length > 1) {
      record(game, { type: 'showdown', cards: seatMap((other) => inHand.includes(other) ? [...game.hands[other]] : []),
        timestamp: now });
    }
    const { pots, payouts } = studAward(game);
    const chips = seatMap((other) => game.chips[other] + payouts[other]);
    record(game, { type: 'award', pots, chips: { ...chips }, eliminated: heEliminations(game, chips), timestamp: now });
    if (heMatchOver(game)) {
      game.phase = 'scoring';
      game.result = { gameType: 'stud', seats: occupiedSeats(game.players), chips: { ...game.chips }, hands: game.hand,
        winners: heWinners(game.chips), eliminationOrder: [...game.eliminated] };
      return;
    }
    startHand(game, heNextButton(game.button, game.chips), now, random);
    return;
  }
  game.currentTurnSeat = seat;
}

/**
 * Seats missing from `players` stay empty for the whole match. `random` is a test hook; games
 * normally use a cryptographic source.
 */
export function startGame(
  roomCode: RoomCode,
  players: Partial<Record<GameSeat, PlayerInfo>>,
  random: () => number = secureRandom,
  now: number = Date.now(),
): void {
  const seats = occupiedSeats(players);
  const game: StudGameState = {
    ...studEmptyTable(seats),
    gameType: 'stud',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    currentTurnSeat: seats[0],
    deck: [],
    hands: seatMap(() => []),
    log: [],
    result: null,
  };
  const button = seats[Math.floor(random() * seats.length)];
  startHand(game, button, now, random);
  games.set(roomCode, game);
}

export function act(
  roomCode: RoomCode,
  seat: GameSeat,
  action: StudAction,
  now: number = Date.now(),
  random: () => number = secureRandom,
): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'Not in playing phase' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  const legal = heLegalActions(game, seat);
  if (!legal) return { success: false, reason: 'Not your turn' };
  const stake = game.streetBets[seat];
  const chips = game.chips[seat];
  let entry: StudLogEntry;
  if (action.type === 'fold') {
    entry = { type: 'action', seat, action: 'fold', to: stake, allIn: false, timestamp: now };
  } else if (action.type === 'check') {
    if (!legal.check) return { success: false, reason: 'You cannot check facing a bet' };
    entry = { type: 'action', seat, action: 'check', to: stake, allIn: false, timestamp: now };
  } else if (action.type === 'call') {
    if (legal.call === 0) return { success: false, reason: 'There is nothing to call' };
    entry = { type: 'action', seat, action: 'call', to: stake + legal.call, allIn: legal.call === chips, timestamp: now };
  } else {
    const bounds = legal.raise;
    if (!bounds) return { success: false, reason: 'You cannot raise now' };
    if (!Number.isSafeInteger(action.to) || action.to < bounds.min || action.to > bounds.max) {
      return { success: false, reason: 'Invalid raise amount' };
    }
    entry = { type: 'action', seat, action: game.currentBet === 0 ? 'bet' : 'raise', to: action.to,
      allIn: action.to === bounds.max, timestamp: now };
  }
  record(game, entry);
  progress(game, heNextToAct(game, seat), now, random);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** Only the seat's own hole card; others appear only when a showdown reveals them. */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): StudVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'stud',
    phase: game.phase,
    mySeat: seat,
    seats: occupiedSeats(game.players),
    myHand: game.hands[seat],
    hand: game.hand,
    button: game.button,
    ante: game.ante,
    minBet: game.minBet,
    chips: game.chips,
    streetBets: game.streetBets,
    totalBets: game.totalBets,
    dealt: game.dealt,
    folded: game.folded,
    street: game.street,
    up: game.up,
    currentBet: game.currentBet,
    minRaise: game.minRaise,
    acted: game.acted,
    revealed: game.revealed,
    eliminated: game.eliminated,
    currentTurnSeat: game.currentTurnSeat,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): StudGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): StudGameState[] {
  return [...games.values()];
}

export function restoreGames(records: StudGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
