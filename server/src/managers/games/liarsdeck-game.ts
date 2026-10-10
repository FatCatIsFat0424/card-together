// ─── Liar's Deck Game: flow management ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  LiarCard,
  LiarsDeckGameState,
  LiarsDeckVisibleState,
  PlayerInfo,
  RoomCode,
  Seat,
} from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import {
  LD_CHAMBERS,
  LD_DECK,
  LD_HAND_SIZE,
  LD_MAX_PLAY,
  LD_TABLE_FACES,
  ldCanChallenge,
  ldIsLie,
  ldMustChallenge,
  ldNextAlive,
  ldNextHolder,
  ldSortHand,
} from '@shared/rules/liarsdeck';
import { shuffleDeck } from '../../engine/deck';

type Result = { success: true } | { success: false; reason: string };

/** Bullet positions and deals stay unpredictable from previously observed shuffles. */
const RANDOM_RANGE = 2 ** 32;
const secureRandom = (): number => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

/** roomCode → LiarsDeckGameState */
const games: Map<RoomCode, LiarsDeckGameState> = new Map();

function seatMap<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return { N: value('N'), E: value('E'), S: value('S'), W: value('W') };
}

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)];
}

function handCounts(game: LiarsDeckGameState): Record<Seat, number> {
  return seatMap((seat) => game.hands[seat].length);
}

/** Deals a fresh round to every surviving seat; the starter opens with an empty table. */
function startRound(game: LiarsDeckGameState, starter: Seat, random: () => number): void {
  const deck = shuffleDeck(LD_DECK, random);
  const alive = SEAT_ORDER_CLOCKWISE.filter((seat) => !game.eliminated.includes(seat));
  game.hands = seatMap((seat) => {
    const index = alive.indexOf(seat);
    return index < 0 ? [] : ldSortHand(deck.slice(index * LD_HAND_SIZE, (index + 1) * LD_HAND_SIZE));
  });
  game.pile = [];
  game.lastPlay = null;
  game.tableFace = pick(LD_TABLE_FACES, random);
  game.round += 1;
  game.currentTurnSeat = starter;
  game.log.push({ type: 'round', round: game.round, tableFace: game.tableFace, starter, timestamp: Date.now() });
}

/** `random` is a test hook; games normally use a cryptographic source. */
export function startGame(
  roomCode: RoomCode,
  players: Record<Seat, PlayerInfo>,
  random: () => number = secureRandom,
): void {
  const game: LiarsDeckGameState = {
    gameType: 'liarsdeck',
    id: randomUUID(),
    startedAt: Date.now(),
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    hands: seatMap(() => []),
    pile: [],
    lastPlay: null,
    tableFace: 'K',
    round: 0,
    currentTurnSeat: 'N',
    bullets: seatMap(() => 1 + Math.floor(random() * LD_CHAMBERS)),
    shots: seatMap(() => 0),
    eliminated: [],
    log: [],
    result: null,
  };
  startRound(game, pick(SEAT_ORDER_CLOCKWISE, random), random);
  games.set(roomCode, game);
}

function actionableGame(roomCode: RoomCode, seat: Seat): LiarsDeckGameState | string {
  const game = games.get(roomCode);
  if (!game) return 'Game not found';
  if (game.phase !== 'playing') return 'Not in playing phase';
  if (game.currentTurnSeat !== seat) return 'Not your turn';
  return game;
}

export function play(roomCode: RoomCode, seat: Seat, cardIds: readonly number[]): Result {
  const game = actionableGame(roomCode, seat);
  if (typeof game === 'string') return { success: false, reason: game };
  if (cardIds.length < 1 || cardIds.length > LD_MAX_PLAY || new Set(cardIds).size !== cardIds.length) {
    return { success: false, reason: `Play 1 to ${LD_MAX_PLAY} different cards` };
  }
  const hand = game.hands[seat];
  const cards = cardIds.map((id) => hand.find((own) => own.id === id));
  if (cards.some((card) => !card)) return { success: false, reason: 'Card not in hand' };
  if (ldMustChallenge(seat, handCounts(game), game.lastPlay)) {
    return { success: false, reason: 'You are the last player with cards and must call LIAR' };
  }
  game.hands[seat] = hand.filter((own) => !cardIds.includes(own.id));
  game.pile.push(...(cards as LiarCard[]));
  game.lastPlay = { seat, count: cards.length };
  game.log.push({ type: 'play', seat, count: cards.length, timestamp: Date.now() });
  // Another seat always holds cards here, because the last holder must call instead of play.
  game.currentTurnSeat = ldNextHolder(seat, handCounts(game)) ?? seat;
  return { success: true };
}

/** Reveals the previous play; the loser of the call pulls their own trigger. `random` is a test hook. */
export function challenge(roomCode: RoomCode, seat: Seat, random: () => number = secureRandom): Result {
  const game = actionableGame(roomCode, seat);
  if (typeof game === 'string') return { success: false, reason: game };
  const lastPlay = game.lastPlay;
  if (!lastPlay || !ldCanChallenge(seat, lastPlay)) {
    return { success: false, reason: 'There is no play to challenge' };
  }
  const revealed = game.pile.slice(-lastPlay.count).map((card) => card.face);
  const lied = ldIsLie(revealed, game.tableFace);
  game.log.push({ type: 'challenge', seat, target: lastPlay.seat, revealed, lied, timestamp: Date.now() });

  const shooter = lied ? lastPlay.seat : seat;
  game.shots[shooter] += 1;
  const survived = game.shots[shooter] !== game.bullets[shooter];
  game.log.push({ type: 'shot', seat: shooter, shot: game.shots[shooter], survived, timestamp: Date.now() });
  if (!survived) game.eliminated.push(shooter);

  const alive = SEAT_ORDER_CLOCKWISE.filter((other) => !game.eliminated.includes(other));
  if (alive.length === 1) {
    game.phase = 'scoring';
    game.currentTurnSeat = alive[0];
    game.result = {
      gameType: 'liarsdeck',
      winnerSeat: alive[0],
      eliminationOrder: [...game.eliminated],
      shots: { ...game.shots },
      rounds: game.round,
    };
    return { success: true };
  }
  startRound(game, survived ? shooter : ldNextAlive(shooter, game.eliminated), random);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** Cards `seat` played face down this round, reconstructed from the pile in play order. */
function playedThisRound(game: LiarsDeckGameState, seat: Seat): LiarCard[] {
  const played: LiarCard[] = [];
  let offset = 0;
  for (const entry of game.log) {
    if (entry.type === 'round') {
      played.length = 0;
      offset = 0;
    }
    if (entry.type !== 'play') continue;
    if (entry.seat === seat) played.push(...game.pile.slice(offset, offset + entry.count));
    offset += entry.count;
  }
  return played;
}

export function getPlayerVisibleState(roomCode: RoomCode, seat: Seat): LiarsDeckVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'liarsdeck',
    phase: game.phase,
    mySeat: seat,
    myHand: game.hands[seat],
    myPlayed: game.phase === 'playing' ? playedThisRound(game, seat) : [],
    handCounts: handCounts(game),
    pileCount: game.pile.length,
    lastPlay: game.lastPlay,
    tableFace: game.tableFace,
    round: game.round,
    currentTurnSeat: game.currentTurnSeat,
    shots: game.shots,
    eliminated: game.eliminated,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): LiarsDeckGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): LiarsDeckGameState[] {
  return [...games.values()];
}

export function restoreGames(records: LiarsDeckGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
