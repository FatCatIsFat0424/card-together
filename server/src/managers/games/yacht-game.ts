// ─── Yacht Dice Game: rolls, holds, and one box per round, in turns or all at once ───

import { randomInt, randomUUID } from 'node:crypto';
import type { GameSeat, PlayerInfo, RoomCode } from '@shared/types';
import type {
  YachtGameState, YachtLogEntry, YachtMatchResult, YachtTurn, YachtVisibleState,
} from '@shared/games/yacht/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  EMPTY_YACHT_SCORECARD, YACHT_DICE, YACHT_MAX_ROLLS, YACHT_ROUNDS, isYachtJoker, yachtCount, yachtReroll, yachtRollDice,
  yachtTotals, yachtWinners, yachtWrite,
} from '@shared/rules/yacht';
import type { YachtBox, YachtOptions } from '@shared/rules/yacht';
import { yachtBestBox } from '@shared/rules/yacht-value';

type Result = { success: true } | { success: false; reason: string };

/** Dice stay unpredictable from previously observed rolls. */
const RANDOM_RANGE = 2 ** 32;
const secureRandom = (): number => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

/** roomCode → YachtGameState */
const games: Map<RoomCode, YachtGameState> = new Map();

const FRESH_TURN: YachtTurn = { dice: [], held: Array.from({ length: YACHT_DICE }, () => false), rolls: 0, done: false };

export function yachtSeats(game: Pick<YachtGameState, 'players'>): GameSeat[] {
  return occupiedSeats(game.players);
}

function freshTurns(seats: readonly GameSeat[]): Partial<Record<GameSeat, YachtTurn>> {
  return Object.fromEntries(seats.map((seat) => [seat, { ...FRESH_TURN }]));
}

/** Seats that still owe a score in the open simultaneous round, in play order. */
export function pendingSeats(game: YachtGameState): GameSeat[] {
  return game.phase === 'playing' && game.options.mode === 'simultaneous'
    ? yachtSeats(game).filter((seat) => !game.turns[seat]?.done) : [];
}

/** Seats missing from `players` stay empty for the whole match. */
export function startGame(
  roomCode: RoomCode, players: Partial<Record<GameSeat, PlayerInfo>>, options: YachtOptions, roundMs: number,
  now: number = Date.now(),
): void {
  const seats = occupiedSeats(players);
  const simultaneous = options.mode === 'simultaneous';
  games.set(roomCode, {
    gameType: 'yacht',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    options: { ...options },
    phase: 'playing',
    round: 1,
    currentTurnSeat: simultaneous ? null : seats[0],
    roundMs,
    roundDeadline: simultaneous ? now + roundMs : null,
    turns: freshTurns(seats),
    cards: Object.fromEntries(seats.map((seat) => [seat, EMPTY_YACHT_SCORECARD])),
    log: [],
    result: null,
  });
}

/** The seat's turn when it may act now, or the reason it may not. */
function actionableTurn(roomCode: RoomCode, seat: GameSeat): { game: YachtGameState; turn: YachtTurn } | string {
  const game = games.get(roomCode);
  if (!game) return 'Game not found';
  if (game.phase !== 'playing') return 'Not in playing phase';
  const turn = game.turns[seat];
  if (!turn) return 'Only players in this match can roll.';
  if (game.options.mode === 'turns' && game.currentTurnSeat !== seat) return 'Not your turn';
  if (turn.done) return 'You have already scored this round';
  return { game, turn };
}

function validMask(held: readonly boolean[]): boolean {
  return held.length === YACHT_DICE;
}

/** Marks the dice kept for the next roll; allowed between the first and the last roll. */
export function hold(roomCode: RoomCode, seat: GameSeat, held: readonly boolean[]): Result {
  const found = actionableTurn(roomCode, seat);
  if (typeof found === 'string') return { success: false, reason: found };
  const { game, turn } = found;
  if (turn.rolls === 0) return { success: false, reason: 'Roll the dice first' };
  if (turn.rolls >= YACHT_MAX_ROLLS) return { success: false, reason: 'No rolls left' };
  if (!validMask(held)) return { success: false, reason: 'Invalid dice' };
  game.turns = { ...game.turns, [seat]: { ...turn, held: [...held] } };
  return { success: true };
}

/** Rolls the dice that are not held; the first roll of a round rolls all five. `held` replaces the kept dice. */
export function roll(
  roomCode: RoomCode, seat: GameSeat, held?: readonly boolean[], random: () => number = secureRandom,
): Result {
  const found = actionableTurn(roomCode, seat);
  if (typeof found === 'string') return { success: false, reason: found };
  const { game, turn } = found;
  if (turn.rolls >= YACHT_MAX_ROLLS) return { success: false, reason: 'No rolls left' };
  if (held && !validMask(held)) return { success: false, reason: 'Invalid dice' };
  let next: YachtTurn;
  if (turn.rolls === 0) {
    next = { dice: yachtRollDice(YACHT_DICE, random), held: [...FRESH_TURN.held], rolls: 1, done: false };
  } else {
    const keep = held ?? turn.held;
    if (keep.every(Boolean)) return { success: false, reason: 'Release at least one die to roll' };
    next = { dice: yachtReroll(turn.dice, keep, random), held: [...keep], rolls: turn.rolls + 1, done: false };
  }
  game.turns = { ...game.turns, [seat]: next };
  return { success: true };
}

function finish(game: YachtGameState): void {
  const seats = yachtSeats(game);
  const totals = Object.fromEntries(seats.map((seat) => [seat, yachtTotals(game.cards[seat]!).total]));
  const result: YachtMatchResult = {
    gameType: 'yacht',
    seats,
    mode: game.options.mode,
    winners: yachtWinners(totals, seats),
    totals,
    upperBonus: Object.fromEntries(seats.map((seat) => [seat, yachtTotals(game.cards[seat]!).upperBonus > 0])),
    yachts: Object.fromEntries(seats.map((seat) => [seat, yachtCount(game.cards[seat]!)])),
  };
  game.phase = 'scoring';
  game.currentTurnSeat = null;
  game.roundDeadline = null;
  game.result = result;
}

/** Moves to the next seat in a turn-mode round, or opens the next round when the last seat has scored. */
function advance(game: YachtGameState, seat: GameSeat, now: number): void {
  const seats = yachtSeats(game);
  if (game.options.mode === 'turns') {
    const index = seats.indexOf(seat);
    if (index < seats.length - 1) {
      game.currentTurnSeat = seats[index + 1];
      return;
    }
  } else if (pendingSeats(game).length > 0) {
    return;
  }
  if (game.round >= YACHT_ROUNDS) {
    finish(game);
    return;
  }
  game.round += 1;
  game.turns = freshTurns(seats);
  if (game.options.mode === 'turns') game.currentTurnSeat = seats[0];
  else game.roundDeadline = now + game.roundMs;
}

/** Writes the seat's dice into `box`. A turn needs one roll first and fills exactly one empty box. */
export function score(roomCode: RoomCode, seat: GameSeat, box: YachtBox, now: number = Date.now()): Result {
  const found = actionableTurn(roomCode, seat);
  if (typeof found === 'string') return { success: false, reason: found };
  const { game, turn } = found;
  if (turn.rolls === 0) return { success: false, reason: 'Roll the dice first' };
  const card = game.cards[seat]!;
  const written = yachtWrite(card, box, turn.dice);
  if (!written) return { success: false, reason: 'That box is not available for these dice' };
  const entry: YachtLogEntry = {
    type: 'score', round: game.round, seat, box, score: written.boxes[box]!,
    bonus: isYachtJoker(card, turn.dice), dice: [...turn.dice], rolls: turn.rolls, timestamp: now,
  };
  game.cards = { ...game.cards, [seat]: written };
  game.turns = { ...game.turns, [seat]: { ...turn, done: true } };
  game.log.push(entry);
  advance(game, seat, now);
  return { success: true };
}

/** The timeout action: roll if the dice were not rolled this round, then write them into the best box. */
export function autoPlay(
  roomCode: RoomCode, seat: GameSeat, now: number = Date.now(), random: () => number = secureRandom,
): Result {
  const found = actionableTurn(roomCode, seat);
  if (typeof found === 'string') return { success: false, reason: found };
  const { game, turn } = found;
  if (turn.rolls === 0) {
    const rolled = roll(roomCode, seat, undefined, random);
    if (!rolled.success) return rolled;
  }
  const dice = game.turns[seat]!.dice;
  return score(roomCode, seat, yachtBestBox(game.cards[seat]!, dice), now);
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** Dice and cards are public, so every seat receives the same view with its own seat marked. */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): YachtVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'yacht',
    phase: game.phase,
    mySeat: seat,
    seats: yachtSeats(game),
    options: game.options,
    round: game.round,
    currentTurnSeat: game.currentTurnSeat,
    roundDeadline: game.roundDeadline,
    turns: game.turns,
    cards: game.cards,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): YachtGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): YachtGameState[] {
  return [...games.values()];
}

export function restoreGames(records: YachtGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
