// ─── Liar's Dice Game: bidding and elimination flow ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  DiceFace,
  GameSeat,
  LiarsDiceGameState,
  LiarsDiceLogEntry,
  LiarsDiceVisibleState,
  PlayerInfo,
  RoomCode,
} from '@shared/types';
import {
  LDI_DICE_PER_PLAYER,
  ldiIsLegalBid,
  ldiNextAlive,
  ldiNextStarter,
  ldiOnesWildAfter,
  ldiResolveCall,
  ldiRoll,
  ldiTotalDice,
} from '@shared/rules/liarsdice';
import { gameSeatMap, occupiedSeats } from '@shared/rules/seats';

type Result = { success: true } | { success: false; reason: string };

/** Dice stay unpredictable from previously observed rolls. */
const RANDOM_RANGE = 2 ** 32;
const secureRandom = (): number => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

/** roomCode → LiarsDiceGameState */
const games: Map<RoomCode, LiarsDiceGameState> = new Map();

function diceCounts(game: LiarsDiceGameState): Record<GameSeat, number> {
  return gameSeatMap((seat) => game.hands[seat].length);
}

/** Rolls a fresh set of dice for every seat with a count; `starter` opens with no bid standing. */
function startRound(
  game: LiarsDiceGameState, starter: GameSeat, counts: Record<GameSeat, number>, now: number, random: () => number,
): void {
  game.hands = gameSeatMap((seat) => ldiRoll(counts[seat], random));
  game.bid = null;
  game.onesWild = true;
  game.round += 1;
  game.currentTurnSeat = starter;
  game.log.push({ type: 'round', round: game.round, starter, counts: { ...counts }, timestamp: now });
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
  const game: LiarsDiceGameState = {
    gameType: 'liarsdice',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    round: 0,
    hands: gameSeatMap(() => []),
    bid: null,
    onesWild: true,
    currentTurnSeat: seats[0],
    eliminated: [],
    log: [],
    result: null,
  };
  const counts = gameSeatMap((seat) => (seats.includes(seat) ? LDI_DICE_PER_PLAYER : 0));
  startRound(game, seats[Math.floor(random() * seats.length)], counts, now, random);
  games.set(roomCode, game);
}

function actionableGame(roomCode: RoomCode, seat: GameSeat): LiarsDiceGameState | string {
  const game = games.get(roomCode);
  if (!game) return 'Game not found';
  if (game.phase !== 'playing') return 'Not in playing phase';
  if (game.currentTurnSeat !== seat) return 'Not your turn';
  return game;
}

export function bid(
  roomCode: RoomCode, seat: GameSeat, quantity: number, face: DiceFace, now: number = Date.now(),
): Result {
  const game = actionableGame(roomCode, seat);
  if (typeof game === 'string') return { success: false, reason: game };
  const next = { quantity, face };
  if (!ldiIsLegalBid(game.bid, next, ldiTotalDice(diceCounts(game)))) {
    return { success: false, reason: 'Bid higher than the standing bid, within the dice in play' };
  }
  game.bid = { seat, ...next };
  game.onesWild = ldiOnesWildAfter(game.onesWild, next);
  game.log.push({ type: 'bid', seat, quantity, face, timestamp: now });
  game.currentTurnSeat = ldiNextAlive(seat, occupiedSeats(game.players), game.eliminated);
  return { success: true };
}

/** Lifts every cup; the loser of the call loses a die. `random` is a test hook. */
export function challenge(
  roomCode: RoomCode, seat: GameSeat, now: number = Date.now(), random: () => number = secureRandom,
): Result {
  const game = actionableGame(roomCode, seat);
  if (typeof game === 'string') return { success: false, reason: game };
  const standing = game.bid;
  if (!standing || standing.seat === seat) return { success: false, reason: 'There is no bid to challenge' };
  const { count, bidTrue } = ldiResolveCall(game.hands, standing, game.onesWild);
  const loser = bidTrue ? seat : standing.seat;
  const counts = diceCounts(game);
  counts[loser] -= 1;
  const eliminated = counts[loser] === 0;
  const entry: LiarsDiceLogEntry = {
    type: 'challenge', seat, target: standing.seat, quantity: standing.quantity, face: standing.face,
    wild: game.onesWild, dice: gameSeatMap((other) => [...game.hands[other]]), count, bidTrue, loser, eliminated,
    timestamp: now,
  };
  game.log.push(entry);
  if (eliminated) game.eliminated.push(loser);

  const seats = occupiedSeats(game.players);
  const alive = seats.filter((other) => !game.eliminated.includes(other));
  if (alive.length === 1) {
    game.phase = 'scoring';
    game.hands = gameSeatMap((other) => (other === alive[0] ? game.hands[other] : []));
    game.bid = null;
    game.currentTurnSeat = alive[0];
    game.result = {
      gameType: 'liarsdice',
      seats,
      winnerSeat: alive[0],
      eliminationOrder: [...game.eliminated],
      dice: gameSeatMap((other) => (other === alive[0] ? counts[other] : 0)),
      rounds: game.round,
    };
    return { success: true };
  }
  startRound(game, ldiNextStarter(loser, seats, game.eliminated), counts, now, random);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** Only the seat's own dice; other cups appear in the log once a challenge lifts them. */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): LiarsDiceVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'liarsdice',
    phase: game.phase,
    mySeat: seat,
    seats: occupiedSeats(game.players),
    myDice: game.hands[seat],
    diceCounts: diceCounts(game),
    round: game.round,
    bid: game.bid,
    onesWild: game.onesWild,
    currentTurnSeat: game.currentTurnSeat,
    eliminated: game.eliminated,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): LiarsDiceGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): LiarsDiceGameState[] {
  return [...games.values()];
}

export function restoreGames(records: LiarsDiceGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
