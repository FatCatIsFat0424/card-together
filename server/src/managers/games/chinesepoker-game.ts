// ─── Chinese Poker Game: simultaneous arranging and pairwise scoring ───

import { randomUUID } from 'node:crypto';
import type {
  Card,
  ChinesePokerArrangement,
  ChinesePokerGameState,
  ChinesePokerVisibleState,
  PlayerInfo,
  RoomCode,
  Seat,
} from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { CP_ROWS, cpCopyArrangement, cpIsValidArrangement, cpMatchResult, cpSortHand } from '@shared/rules/chinesepoker';
import { createDeck, shuffleDeck } from '../../engine/deck';
import { dealCards } from '../../engine/dealing';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → ChinesePokerGameState */
const games: Map<RoomCode, ChinesePokerGameState> = new Map();

function seatMap<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return { N: value('N'), E: value('E'), S: value('S'), W: value('W') };
}

/** `deck` is a test hook; games normally deal a fresh shuffle. */
export function startGame(
  roomCode: RoomCode,
  players: Record<Seat, PlayerInfo>,
  arrangeMs: number,
  deck: readonly Card[] = shuffleDeck(createDeck()),
): void {
  const dealt = dealCards(deck);
  const now = Date.now();
  games.set(roomCode, {
    gameType: 'chinesepoker',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'arranging',
    hands: seatMap((seat) => cpSortHand(dealt[seat])),
    arrangements: seatMap(() => null),
    arrangeDeadline: now + arrangeMs,
    autoArranged: [],
    log: [],
    result: null,
  });
}

/** Seats that have not submitted yet, ordered N, E, S, W */
export function pendingSeats(game: ChinesePokerGameState): Seat[] {
  return SEAT_ORDER_CLOCKWISE.filter((seat) => game.arrangements[seat] === null);
}

/** Reveals every arrangement once the last seat submits; the reveal log replays rows and bonuses in order. */
function settle(game: ChinesePokerGameState, timestamp: number): void {
  const arrangements = seatMap((seat) => {
    const arrangement = game.arrangements[seat];
    if (!arrangement) throw new Error(`Seat ${seat} has not arranged`);
    return arrangement;
  });
  const result = cpMatchResult(arrangements);
  game.result = result;
  game.phase = 'scoring';
  for (const row of CP_ROWS) game.log.push({ type: 'reveal', row, timestamp });
  for (const { seats, shooter } of result.matchups) {
    if (shooter) game.log.push({ type: 'shoot', seat: shooter, target: shooter === seats[0] ? seats[1] : seats[0], timestamp });
  }
  if (result.homeRun) game.log.push({ type: 'homerun', seat: result.homeRun, timestamp });
}

/** A submission is final. `automatic` marks server-made arrangements, which are accepted past the deadline. */
export function arrange(
  roomCode: RoomCode,
  seat: Seat,
  arrangement: ChinesePokerArrangement,
  automatic: boolean,
  now: number = Date.now(),
): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'arranging') return { success: false, reason: 'Not in arranging phase' };
  if (game.arrangements[seat]) return { success: false, reason: 'Already submitted' };
  if (!cpIsValidArrangement(game.hands[seat], arrangement)) return { success: false, reason: 'Invalid arrangement' };
  if (!automatic && now >= game.arrangeDeadline) return { success: false, reason: 'The arrangement time is over' };

  game.arrangements[seat] = cpCopyArrangement(arrangement);
  game.log.push({ type: 'submit', seat, timestamp: now });
  if (automatic && !game.players[seat].isBot && !game.autoArranged.includes(seat)) {
    game.autoArranged = SEAT_ORDER_CLOCKWISE.filter((other) => other === seat || game.autoArranged.includes(other));
  }
  if (pendingSeats(game).length === 0) settle(game, now);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** Other seats' arrangements stay hidden until the result reveals them all. */
export function getPlayerVisibleState(roomCode: RoomCode, seat: Seat): ChinesePokerVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'chinesepoker',
    phase: game.phase,
    mySeat: seat,
    myHand: game.hands[seat],
    myArrangement: game.arrangements[seat],
    submitted: seatMap((other) => game.arrangements[other] !== null),
    arrangeDeadline: game.arrangeDeadline,
    autoArranged: game.autoArranged,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): ChinesePokerGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): ChinesePokerGameState[] {
  return [...games.values()];
}

export function restoreGames(records: ChinesePokerGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
