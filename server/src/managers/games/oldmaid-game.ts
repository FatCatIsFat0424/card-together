// ─── Old Maid Game: dealing, drawing from the neighbour, and placement scoring ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  Card,
  CardOrJoker,
  GameSeat,
  OldMaidGameState,
  OldMaidLogEntry,
  OldMaidVisibleState,
  PlayerInfo,
  RoomCode,
} from '@shared/types';
import {
  OM_DEALS,
  omApplyOrder,
  omDealHands,
  omDeck,
  omDiscardPairs,
  omIsPermutation,
  omNextHolder,
  omPlacePoints,
  omShuffle,
  omStarter,
  omWinners,
} from '@shared/rules/oldmaid';
import { gameSeatMap, occupiedSeats } from '@shared/rules/seats';

type Result = { success: true } | { success: false; reason: string };

/** Shuffles and card positions stay unpredictable from anything a player has seen. */
const RANDOM_RANGE = 2 ** 32;
const secureRandom = (): number => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

/** roomCode → OldMaidGameState */
const games: Map<RoomCode, OldMaidGameState> = new Map();

function handCounts(game: OldMaidGameState): Record<GameSeat, number> {
  return gameSeatMap((seat) => game.hands[seat].length);
}

/** Seats from `start` around the table, `start` first. */
function fromSeat(seats: readonly GameSeat[], start: GameSeat): GameSeat[] {
  const index = seats.indexOf(start);
  return [...seats.slice(index), ...seats.slice(0, index)];
}

/** Shuffles, deals every card, and has each seat discard its pairs; a hand left empty finishes at once. */
function startDeal(game: OldMaidGameState, deal: number, now: number, random: () => number): void {
  const seats = occupiedSeats(game.players);
  const dealt = omDealHands(omShuffle(omDeck(), random), seats);
  const discards = gameSeatMap((): Card[] => []);
  game.hands = gameSeatMap((): CardOrJoker[] => []);
  for (const seat of seats) {
    const { kept, pairs } = omDiscardPairs(dealt.get(seat) ?? []);
    game.hands[seat] = kept;
    discards[seat] = pairs;
  }
  const starter = omStarter(deal, seats);
  game.deal = deal;
  game.finished = fromSeat(seats, starter).filter((seat) => game.hands[seat].length === 0);
  game.log.push({
    type: 'deal', deal, starter, discards, counts: handCounts(game), finished: [...game.finished], timestamp: now,
  });
  game.currentTurnSeat = game.hands[starter].length > 0 ? starter : omNextHolder(starter, seats, handCounts(game)) ?? starter;
  if (seats.filter((seat) => game.hands[seat].length > 0).length <= 1) settleDeal(game, now, random);
}

/** The seat still holding cards is left with the joker: it places last, everyone else by finishing order. */
function settleDeal(game: OldMaidGameState, now: number, random: () => number): void {
  const seats = occupiedSeats(game.players);
  const loser = seats.find((seat) => game.hands[seat].length > 0) ?? game.currentTurnSeat;
  const order = [...game.finished, loser];
  const points = gameSeatMap((seat) => {
    const place = order.indexOf(seat) + 1;
    return place > 0 ? omPlacePoints(seats.length, place) : 0;
  });
  game.totals = gameSeatMap((seat) => game.totals[seat] + points[seat]);
  game.dealOrders.push(order);
  const entry: OldMaidLogEntry = {
    type: 'settle', deal: game.deal, order, loser, points, totals: { ...game.totals }, timestamp: now,
  };
  game.log.push(entry);
  if (game.deal < OM_DEALS) {
    startDeal(game, game.deal + 1, now, random);
    return;
  }
  game.phase = 'scoring';
  game.currentTurnSeat = loser;
  game.result = {
    gameType: 'oldmaid',
    seats,
    deals: OM_DEALS,
    totals: { ...game.totals },
    dealOrders: game.dealOrders.map((dealOrder) => [...dealOrder]),
    winners: omWinners(game.totals, seats),
  };
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
  const game: OldMaidGameState = {
    gameType: 'oldmaid',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    deal: 1,
    hands: gameSeatMap(() => []),
    finished: [],
    currentTurnSeat: seats[0],
    totals: gameSeatMap(() => 0),
    dealOrders: [],
    log: [],
    result: null,
  };
  games.set(roomCode, game);
  startDeal(game, 1, now, random);
}

/** The seat `seat` would draw from, or null when nobody else holds cards. */
export function drawSource(game: OldMaidGameState, seat: GameSeat): GameSeat | null {
  return omNextHolder(seat, occupiedSeats(game.players), handCounts(game));
}

/**
 * Takes the card at `index` of the neighbour's hand. The card joins the drawer's hand at a random position, so
 * where it lands says nothing about what it is, and a completed pair is discarded. `reorder` first rearranges the
 * drawer's own hand. `random` is a test hook.
 */
export function draw(
  roomCode: RoomCode, seat: GameSeat, index: number, reorder: readonly number[] | undefined,
  now: number = Date.now(), random: () => number = secureRandom,
): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'Not in playing phase' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  const from = drawSource(game, seat);
  if (!from) return { success: false, reason: 'There is nobody to draw from' };
  const source = game.hands[from];
  if (!Number.isInteger(index) || index < 0 || index >= source.length) {
    return { success: false, reason: 'Pick a card in the neighbour\'s hand' };
  }
  if (reorder !== undefined && !omIsPermutation(reorder, game.hands[seat].length)) {
    return { success: false, reason: 'The new order must place every card once' };
  }
  const own = reorder === undefined ? [...game.hands[seat]] : omApplyOrder(game.hands[seat], reorder);
  const [taken] = source.splice(index, 1);
  own.splice(Math.min(own.length, Math.floor(random() * (own.length + 1))), 0, taken);
  const { kept, pairs } = omDiscardPairs(own);
  game.hands[seat] = kept;
  const finished = [from, seat].filter((other) => game.hands[other].length === 0);
  game.finished.push(...finished);
  game.log.push({ type: 'draw', seat, from, index, discarded: pairs, finished, timestamp: now });

  const seats = occupiedSeats(game.players);
  if (seats.filter((other) => game.hands[other].length > 0).length <= 1) {
    settleDeal(game, now, random);
    return { success: true };
  }
  game.currentTurnSeat = omNextHolder(seat, seats, handCounts(game)) ?? seat;
  return { success: true };
}

/** Rearranges the seat's own hand; allowed at any time during play, and nothing about it is published. */
export function reorder(roomCode: RoomCode, seat: GameSeat, order: readonly number[]): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'Not in playing phase' };
  if (!occupiedSeats(game.players).includes(seat)) return { success: false, reason: 'Not a player' };
  if (!omIsPermutation(order, game.hands[seat].length)) {
    return { success: false, reason: 'The new order must place every card once' };
  }
  game.hands[seat] = omApplyOrder(game.hands[seat], order);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** The seat's own hand and every seat's card count; other hands never leave the server. */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): OldMaidVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'oldmaid',
    phase: game.phase,
    mySeat: seat,
    seats: occupiedSeats(game.players),
    deal: game.deal,
    totalDeals: OM_DEALS,
    myHand: [...game.hands[seat]],
    handCounts: handCounts(game),
    finished: game.finished,
    currentTurnSeat: game.currentTurnSeat,
    drawFrom: game.phase === 'playing' ? drawSource(game, game.currentTurnSeat) : null,
    totals: game.totals,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): OldMaidGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): OldMaidGameState[] {
  return [...games.values()];
}

export function restoreGames(records: OldMaidGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
