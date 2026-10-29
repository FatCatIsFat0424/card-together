// ─── Reversi Game: two seats alternate placements; a seat without a legal move passes automatically ───

import { randomUUID } from 'node:crypto';
import type {
  GameSeat, PlayerInfo, ReversiGameState, ReversiMatchResult, ReversiMove, ReversiVisibleState, RoomCode,
} from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import { rvCell, rvCounts, rvInitialDiscs, rvLeader, rvNextSide, rvNode, rvPlace } from '@shared/rules/reversi';
import type { RvSide } from '@shared/rules/reversi';
import { resignationOutcome } from '@shared/rules/board/board-result';
import type { BoardOutcome } from '@shared/rules/board/board-result';
import { NO_DRAW_OFFER, afterBoardMove, applyMatchControl } from '@shared/rules/board/match-controls';
import type { MatchControlAction } from '@shared/rules/board/match-controls';
import { reversiDefinition } from '@shared/games/reversi/definition';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → ReversiGameState */
const games: Map<RoomCode, ReversiGameState> = new Map();

/** The two seats in play order: dark first. */
export function reversiSeats(game: Pick<ReversiGameState, 'players'>): GameSeat[] {
  return occupiedSeats(game.players);
}

export function startGame(roomCode: RoomCode, players: Partial<Record<GameSeat, PlayerInfo>>, now: number = Date.now()): void {
  const seats = occupiedSeats(players);
  games.set(roomCode, {
    gameType: 'reversi',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    discs: [...rvInitialDiscs()],
    currentTurnSeat: seats[0],
    drawOffer: NO_DRAW_OFFER,
    log: [],
    result: null,
  });
}

function sideOf(game: ReversiGameState, seat: GameSeat): RvSide {
  return reversiSeats(game).indexOf(seat) === 0 ? 0 : 1;
}

/** Closes the match with the given outcome and the board as it stands. */
function finish(game: ReversiGameState, outcome: BoardOutcome): void {
  const seats = reversiSeats(game);
  const [dark, light] = rvCounts(game.discs);
  const result: ReversiMatchResult = {
    gameType: 'reversi',
    seats,
    discs: { [seats[0]]: dark, [seats[1]]: light },
    moves: game.log.filter((entry) => entry.to !== undefined).length,
    winners: [...outcome.winners],
    reason: outcome.reason,
  };
  game.phase = 'scoring';
  game.result = result;
}

/** Places a disc for the seat on its turn, then passes the turn, skips a stuck opponent, or ends the match. */
export function place(roomCode: RoomCode, seat: GameSeat, to: string, now: number = Date.now()): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  const index = rvCell(to);
  const side = sideOf(game, seat);
  const placed = index === null ? null : rvPlace(game.discs, index, side);
  if (index === null || !placed) return { success: false, reason: 'Illegal move' };

  game.discs = [...placed.discs];
  const move: ReversiMove = { seat, to: rvNode(index), flips: placed.flips.map(rvNode), timestamp: now };
  game.log.push(move);
  game.drawOffer = afterBoardMove(game.drawOffer, seat);

  const seats = reversiSeats(game);
  const next = rvNextSide(game.discs, side);
  if (next === null) {
    const leader = rvLeader(game.discs);
    finish(game, { winners: leader === null ? [] : [seats[leader]], reason: 'disc-count' });
  } else if (next === side) {
    // The opponent cannot move: record the skipped turn and let the same seat play again.
    game.log.push({ seat: seats[next === 0 ? 1 : 0], flips: [], timestamp: now });
  } else {
    game.currentTurnSeat = seats[next];
  }
  return { success: true };
}

/** Resignation and draw offers; they never move the turn or its clock. */
export function control(roomCode: RoomCode, seat: GameSeat, action: MatchControlAction): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  const seats = reversiSeats(game);
  const applied = applyMatchControl(game.drawOffer, seat, action, reversiDefinition.matchControls!, {
    seats, turnSeat: game.currentTurnSeat,
  });
  if (typeof applied === 'string') return { success: false, reason: applied };
  game.drawOffer = applied.state;
  if (applied.effect?.kind === 'resigned') finish(game, resignationOutcome(applied.effect.seat, seats));
  else if (applied.effect?.kind === 'agreed-draw') finish(game, { winners: [], reason: 'agreed-draw' });
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** The whole position is public, so every seat and spectator gets the same view. */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): ReversiVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'reversi',
    phase: game.phase,
    mySeat: seat,
    seats: reversiSeats(game),
    discs: game.discs,
    currentTurnSeat: game.currentTurnSeat,
    drawOffer: game.drawOffer,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): ReversiGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): ReversiGameState[] {
  return [...games.values()];
}

export function restoreGames(records: ReversiGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
