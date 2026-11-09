// ─── Dominoes Game: flow management ───

import { randomUUID } from 'node:crypto';
import type { GameSeat, PlayerInfo, RoomCode } from '@shared/types';
import type {
  DominoesGameState,
  DominoesMatchResult,
  DominoesOptions,
  DominoesVisibleState,
  DominoSide,
  DominoTile,
} from '@shared/games/dominoes/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { DEFAULT_DOMINOES_OPTIONS } from '@shared/dominoes-options';
import { occupiedSeats } from '@shared/rules/seats';
import {
  dmAllTiles, dmBlocked, dmEnds, dmHandSize, dmLeaders, dmMatchOver, dmNextSeat, dmOpening, dmPlacement,
  dmResolveSide, dmSameTile, dmScoreRound, dmTurnOptions,
} from '@shared/rules/dominoes';
import { shuffleDeck } from '../../engine/deck';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → DominoesGameState */
const games: Map<RoomCode, DominoesGameState> = new Map();

function seatMap<T>(value: (seat: GameSeat) => T): Record<GameSeat, T> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, value(seat)])) as Record<GameSeat, T>;
}

/** A shuffled double-six set. */
export function newDominoesSet(): DominoTile[] {
  return shuffleDeck<DominoTile>(dmAllTiles());
}

/** Deals a round. Round 1 is opened by the holder of the opening tile; later rounds by `leader`. */
function startRound(
  game: DominoesGameState, round: number, leader: GameSeat | null, set: readonly DominoTile[] | undefined, now: number,
): void {
  const participants = occupiedSeats(game.players);
  const size = dmHandSize(participants.length);
  const tiles = [...(set ?? newDominoesSet())];
  game.round = round;
  game.hands = seatMap((seat) => {
    const start = participants.indexOf(seat) * size;
    return start < 0 ? [] : tiles.slice(start, start + size);
  });
  game.boneyard = tiles.slice(size * participants.length);
  game.line = [];
  if (leader === null) {
    const opening = dmOpening(game.hands, participants);
    game.openingTile = opening.tile;
    game.leader = opening.seat;
  } else {
    game.openingTile = null;
    game.leader = leader;
  }
  game.currentTurnSeat = game.leader;
  game.log.push({
    type: 'round', round, leader: game.leader, counts: seatMap((seat) => game.hands[seat].length),
    boneyard: game.boneyard.length, timestamp: now,
  });
}

function finishMatch(game: DominoesGameState): void {
  const seats = occupiedSeats(game.players);
  const result: DominoesMatchResult = {
    gameType: 'dominoes',
    seats,
    scores: { ...game.scores },
    winners: dmLeaders(seats, game.scores),
    rounds: game.round,
    targetScore: game.options.targetScore,
    roundWinners: game.log.flatMap((entry) => (entry.type === 'roundEnd' ? [entry.winner] : [])),
  };
  game.phase = 'scoring';
  game.result = result;
}

/** Settles the round (`out` emptied their hand, or null when blocked), then deals the next one or ends the match. */
function endRound(game: DominoesGameState, out: GameSeat | null, now: number): void {
  const seats = occupiedSeats(game.players);
  const score = dmScoreRound(game.hands, seats, out);
  if (score.winner !== null) game.scores = { ...game.scores, [score.winner]: game.scores[score.winner] + score.points };
  game.log.push({
    type: 'roundEnd', round: game.round, reason: score.reason, winner: score.winner, points: score.points,
    hands: seatMap((seat) => game.hands[seat].map(([low, high]): DominoTile => [low, high])),
    scores: { ...game.scores }, timestamp: now,
  });
  if (dmMatchOver(seats, game.scores, game.options.targetScore, game.round)) {
    finishMatch(game);
    return;
  }
  startRound(game, game.round + 1, score.winner ?? dmNextSeat(seats, game.leader), undefined, now);
}

/** Ends the round at once when the boneyard is empty and no seat holds a tile for the line. */
function endIfBlocked(game: DominoesGameState, now: number): boolean {
  const seats = occupiedSeats(game.players);
  if (!dmBlocked(seats.map((seat) => game.hands[seat]), game.line, game.boneyard.length)) return false;
  endRound(game, null, now);
  return true;
}

/** `set` and `options` are test hooks for the opening round; later rounds are shuffled. */
export function startGame(
  roomCode: RoomCode,
  players: Partial<Record<GameSeat, PlayerInfo>>,
  set?: readonly DominoTile[],
  options: DominoesOptions = DEFAULT_DOMINOES_OPTIONS,
  now: number = Date.now(),
): void {
  const participants = occupiedSeats(players);
  const game: DominoesGameState = {
    gameType: 'dominoes',
    id: randomUUID(),
    options: { ...options },
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    round: 0,
    hands: seatMap(() => []),
    boneyard: [],
    line: [],
    leader: participants[0],
    currentTurnSeat: participants[0],
    openingTile: null,
    scores: seatMap(() => 0),
    log: [],
    result: null,
  };
  startRound(game, 1, null, set, now);
  games.set(roomCode, game);
}

function activeGame(roomCode: RoomCode, seat: GameSeat): DominoesGameState | Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'Not in playing phase' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  return game;
}

function advance(game: DominoesGameState, from: GameSeat): void {
  game.currentTurnSeat = dmNextSeat(occupiedSeats(game.players), from);
}

export function play(
  roomCode: RoomCode, seat: GameSeat, tile: DominoTile, side?: DominoSide, now: number = Date.now(),
): Result {
  const game = activeGame(roomCode, seat);
  if (!('gameType' in game)) return game;
  const hand = game.hands[seat];
  const index = hand.findIndex((own) => dmSameTile(own, tile));
  if (index < 0) return { success: false, reason: 'Tile not in hand' };
  if (game.line.length === 0 && game.openingTile && !dmSameTile(game.openingTile, tile)) {
    return { success: false, reason: 'The opening tile must lead' };
  }
  const resolved = dmResolveSide(tile, game.line, side);
  if ('error' in resolved) return { success: false, reason: resolved.error };
  const placement = dmPlacement(tile, resolved.side, game.line);
  if (!placement) return { success: false, reason: 'That tile does not match an end' };

  game.hands[seat] = [...hand.slice(0, index), ...hand.slice(index + 1)];
  game.line = resolved.side === 'left' ? [placement, ...game.line] : [...game.line, placement];
  game.log.push({ type: 'play', seat, tile, side: resolved.side, placement, timestamp: now });
  if (game.hands[seat].length === 0) {
    endRound(game, seat, now);
    return { success: true };
  }
  if (!endIfBlocked(game, now)) advance(game, seat);
  return { success: true };
}

/** With no playable tile and tiles in the boneyard, takes one; the seat keeps the turn to play it or draw on. */
export function draw(roomCode: RoomCode, seat: GameSeat, now: number = Date.now()): Result {
  const game = activeGame(roomCode, seat);
  if (!('gameType' in game)) return game;
  const options = dmTurnOptions(game.hands[seat], game.line, game.boneyard.length, game.openingTile);
  if (options.plays.length > 0) return { success: false, reason: 'You must play a tile' };
  const ends = dmEnds(game.line);
  const [tile] = game.boneyard;
  if (!tile || !ends) return { success: false, reason: 'Nothing left to draw' };
  game.boneyard = game.boneyard.slice(1);
  game.hands[seat] = [...game.hands[seat], tile];
  game.log.push({ type: 'draw', seat, ends, timestamp: now });
  endIfBlocked(game, now);
  return { success: true };
}

/** Passing is allowed only with nothing to play and nothing to draw. */
export function pass(roomCode: RoomCode, seat: GameSeat, now: number = Date.now()): Result {
  const game = activeGame(roomCode, seat);
  if (!('gameType' in game)) return game;
  const options = dmTurnOptions(game.hands[seat], game.line, game.boneyard.length, game.openingTile);
  const ends = dmEnds(game.line);
  if (!options.canPass || !ends) {
    return { success: false, reason: options.plays.length > 0 ? 'You must play a tile' : 'Draw a tile first' };
  }
  game.log.push({ type: 'pass', seat, ends, timestamp: now });
  if (!endIfBlocked(game, now)) advance(game, seat);
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): DominoesVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'dominoes',
    phase: game.phase,
    options: game.options,
    mySeat: seat,
    seats: occupiedSeats(game.players),
    myHand: game.hands[seat],
    handCounts: seatMap((other) => game.hands[other].length),
    boneyardCount: game.boneyard.length,
    line: game.line,
    round: game.round,
    leader: game.leader,
    currentTurnSeat: game.currentTurnSeat,
    openingTile: game.line.length === 0 ? game.openingTile : null,
    scores: game.scores,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): DominoesGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): DominoesGameState[] {
  return [...games.values()];
}

export function restoreGames(records: DominoesGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
