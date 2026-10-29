// ─── Dou Dizhu Game: auction, landlord reveal, and combination play for three players over six deals ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  CardOrJoker, DouDizhuGameState, DouDizhuLogEntry, DouDizhuOptions, DouDizhuVisibleState, GameSeat, PlayerInfo, RoomCode,
} from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { DEFAULT_DOUDIZHU_OPTIONS } from '@shared/doudizhu-options';
import { cardKey, hasCard } from '@shared/rules/cards';
import {
  DDZ_DEALS, DDZ_MAX_REDEALS, createDdzDeck, ddzAuction, ddzDeal, ddzIsBomb, ddzNextSeat, ddzResolve, ddzSettle, ddzWinners,
  ddzWithout, sortDdzHand,
} from '@shared/rules/doudizhu';
import { occupiedSeats } from '@shared/rules/seats';
import { shuffleDeck } from '../../engine/deck';

type Result = { success: true } | { success: false; reason: string };

/** Deals stay unpredictable from previously observed shuffles. */
const RANDOM_RANGE = 2 ** 32;
const secureRandom = (): number => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

/** roomCode → DouDizhuGameState */
const games: Map<RoomCode, DouDizhuGameState> = new Map();

function seatMap<T>(value: (seat: GameSeat) => T): Record<GameSeat, T> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, value(seat)])) as Record<GameSeat, T>;
}

/** The seats at the table, in play order. */
export function tableSeats(game: Pick<DouDizhuGameState, 'players'>): GameSeat[] {
  return occupiedSeats(game.players);
}

/** Who opens the auction: the opener rotates with each deal and with each voided auction. */
export function firstCallerOf(seats: readonly GameSeat[], deal: number, redeals: number): GameSeat {
  return seats[(deal - 1 + redeals) % seats.length];
}

function fail(reason: string): Result {
  return { success: false, reason };
}

function logOf(game: DouDizhuGameState, entry: DouDizhuLogEntry): void {
  game.log.push(entry);
}

/** Shuffles and deals the current deal (or its redeal) and opens the auction. */
function dealHand(game: DouDizhuGameState, now: number, random: () => number): void {
  const seats = tableSeats(game);
  const dealt = ddzDeal(seats, shuffleDeck(createDdzDeck(), random));
  game.hands = seatMap((seat) => dealt.hands[seat] ?? []);
  game.bottom = dealt.bottom;
  game.bids = [];
  game.landlord = null;
  game.base = 0;
  game.grabs = 0;
  game.bombs = 0;
  game.lastPlay = null;
  game.passes = 0;
  game.plays = seatMap(() => 0);
  game.firstCaller = firstCallerOf(seats, game.deal, game.redeals);
  game.currentTurnSeat = game.firstCaller;
  game.phase = 'calling';
  logOf(game, { type: 'deal', deal: game.deal, redeal: game.redeals, firstCaller: game.firstCaller, timestamp: now });
}

/** `random` and `now` are test hooks; the first deal is dealt at once. */
export function startGame(
  roomCode: RoomCode,
  players: Partial<Record<GameSeat, PlayerInfo>>,
  options: DouDizhuOptions = DEFAULT_DOUDIZHU_OPTIONS,
  now: number = Date.now(),
  random: () => number = secureRandom,
): void {
  const seats = occupiedSeats(players);
  const game: DouDizhuGameState = {
    gameType: 'doudizhu',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    options: { variant: options.variant },
    phase: 'calling',
    deal: 1,
    redeals: 0,
    firstCaller: seats[0],
    hands: seatMap(() => []),
    bottom: [],
    bids: [],
    landlord: null,
    base: 0,
    grabs: 0,
    bombs: 0,
    lastPlay: null,
    passes: 0,
    plays: seatMap(() => 0),
    currentTurnSeat: seats[0],
    totals: seatMap(() => 0),
    log: [],
    result: null,
  };
  games.set(roomCode, game);
  dealHand(game, now, random);
}

function playerGame(roomCode: RoomCode, seat: GameSeat, phase: 'calling' | 'playing'): DouDizhuGameState | string {
  const game = games.get(roomCode);
  if (!game) return 'Game not found';
  if (game.phase !== phase) return phase === 'calling' ? 'Not in the auction' : 'Not in playing phase';
  if (game.currentTurnSeat !== seat) return 'Not your turn';
  return game;
}

/** Ends the auction: the landlord takes the bottom cards and leads. */
function startPlaying(game: DouDizhuGameState, landlord: GameSeat, base: number, grabs: number, forced: boolean, now: number): void {
  game.landlord = landlord;
  game.base = base;
  game.grabs = grabs;
  game.hands[landlord] = sortDdzHand([...game.hands[landlord], ...game.bottom]);
  game.phase = 'playing';
  game.lastPlay = null;
  game.passes = 0;
  game.currentTurnSeat = landlord;
  logOf(game, { type: 'landlord', seat: landlord, base, grabs, forced, bottom: [...game.bottom], timestamp: now });
}

/** Moves the auction along after a bid; returns once the next seat, the redeal, or the play is set up. */
function advanceAuction(game: DouDizhuGameState, now: number, random: () => number): void {
  const seats = tableSeats(game);
  const auction = ddzAuction(game.options.variant, seats, game.firstCaller, game.bids);
  if (!auction.done) {
    game.currentTurnSeat = auction.turn;
    return;
  }
  if (auction.landlord) {
    startPlaying(game, auction.landlord, auction.base, auction.grabs, false, now);
    return;
  }
  if (game.redeals >= DDZ_MAX_REDEALS) {
    // Too many voided auctions in a row: the opener takes the deal at the lowest stake.
    startPlaying(game, game.firstCaller, 1, 0, true, now);
    return;
  }
  logOf(game, { type: 'redeal', timestamp: now });
  game.redeals += 1;
  dealHand(game, now, random);
}

/** Score variant: 0 passes, 1-3 bids, and each bid must beat the one before. */
export function bid(
  roomCode: RoomCode, seat: GameSeat, score: 0 | 1 | 2 | 3, now: number = Date.now(), random: () => number = secureRandom,
): Result {
  const game = playerGame(roomCode, seat, 'calling');
  if (typeof game === 'string') return fail(game);
  if (game.options.variant !== 'score') return fail('This room calls and grabs the landlord.');
  const auction = ddzAuction('score', tableSeats(game), game.firstCaller, game.bids);
  if (auction.done) return fail('The auction has ended');
  if (score !== 0 && score < auction.minScore) return fail('The bid must be higher than the last one');
  game.bids.push({ kind: 'score', seat, score });
  logOf(game, { type: 'bid', seat, score, timestamp: now });
  advanceAuction(game, now, random);
  return { success: true };
}

/** Grab variant: call (or grab) the landlord, or pass. */
export function claim(
  roomCode: RoomCode, seat: GameSeat, take: boolean, now: number = Date.now(), random: () => number = secureRandom,
): Result {
  const game = playerGame(roomCode, seat, 'calling');
  if (typeof game === 'string') return fail(game);
  if (game.options.variant !== 'grab') return fail('This room bids for the landlord.');
  game.bids.push({ kind: 'claim', seat, take });
  logOf(game, { type: 'claim', seat, take, timestamp: now });
  advanceAuction(game, now, random);
  return { success: true };
}

/** Settles the deal, then either deals the next one or ends the match. */
function finishDeal(game: DouDizhuGameState, winner: GameSeat, now: number, random: () => number): void {
  const seats = tableSeats(game);
  const landlord = game.landlord!;
  const outcome = ddzSettle({
    seats, landlord, winner, base: game.base, doublings: game.grabs + game.bombs, plays: game.plays,
  });
  for (const seat of seats) game.totals[seat] += outcome.scores[seat];
  logOf(game, {
    type: 'deal_end', deal: game.deal, landlord, winner, landlordWins: outcome.landlordWins, base: game.base,
    bombs: game.bombs, grabs: game.grabs, spring: outcome.spring, antiSpring: outcome.antiSpring,
    multiplier: outcome.multiplier, scores: seatMap((seat) => outcome.scores[seat] ?? 0), totals: { ...game.totals },
    hands: seatMap((seat) => [...game.hands[seat]]), timestamp: now,
  });
  if (game.deal >= DDZ_DEALS) {
    game.phase = 'scoring';
    game.result = { gameType: 'doudizhu', seats, scores: { ...game.totals }, deals: game.deal,
      winners: ddzWinners(seats, game.totals) };
    return;
  }
  game.deal += 1;
  game.redeals = 0;
  dealHand(game, now, random);
}

export function play(
  roomCode: RoomCode, seat: GameSeat, cards: readonly CardOrJoker[], now: number = Date.now(),
  random: () => number = secureRandom,
): Result {
  const game = playerGame(roomCode, seat, 'playing');
  if (typeof game === 'string') return fail(game);
  const hand = game.hands[seat];
  if (cards.length === 0 || new Set(cards.map(cardKey)).size !== cards.length || !cards.every((card) => hasCard(hand, card))) {
    return fail('Card not in hand');
  }
  const combo = ddzResolve(cards, game.lastPlay?.combo ?? null);
  if (!combo) return fail('Illegal play');
  const played = sortDdzHand(cards);
  game.hands[seat] = ddzWithout(hand, played);
  game.lastPlay = { seat, cards: played, combo };
  game.passes = 0;
  game.plays[seat] += 1;
  if (ddzIsBomb(combo)) game.bombs += 1;
  logOf(game, { type: 'play', seat, cards: played, combo, timestamp: now });
  if (game.hands[seat].length === 0) finishDeal(game, seat, now, random);
  else game.currentTurnSeat = ddzNextSeat(tableSeats(game), seat);
  return { success: true };
}

export function pass(roomCode: RoomCode, seat: GameSeat, now: number = Date.now()): Result {
  const game = playerGame(roomCode, seat, 'playing');
  if (typeof game === 'string') return fail(game);
  if (!game.lastPlay) return fail('You must lead this round');
  game.passes += 1;
  logOf(game, { type: 'pass', seat, timestamp: now });
  if (game.passes >= tableSeats(game).length - 1) {
    const leaderSeat = game.lastPlay.seat;
    logOf(game, { type: 'round_end', leaderSeat, timestamp: now });
    game.lastPlay = null;
    game.passes = 0;
    game.currentTurnSeat = leaderSeat;
  } else {
    game.currentTurnSeat = ddzNextSeat(tableSeats(game), seat);
  }
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** Other hands show as counts only, and the bottom cards stay hidden until the auction ends. */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): DouDizhuVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  const seats = tableSeats(game);
  return {
    gameType: 'doudizhu',
    phase: game.phase,
    mySeat: seat,
    seats,
    options: game.options,
    deal: game.deal,
    totalDeals: DDZ_DEALS,
    redeals: game.redeals,
    firstCaller: game.firstCaller,
    myHand: game.hands[seat] ?? [],
    handCounts: seatMap((other) => game.hands[other].length),
    bids: game.bids,
    landlord: game.landlord,
    base: game.base,
    grabs: game.grabs,
    bombs: game.bombs,
    bottom: game.landlord ? game.bottom : null,
    lastPlay: game.lastPlay,
    passes: game.passes,
    currentTurnSeat: game.currentTurnSeat,
    totals: game.totals,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): DouDizhuGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): DouDizhuGameState[] {
  return [...games.values()];
}

export function restoreGames(records: DouDizhuGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
