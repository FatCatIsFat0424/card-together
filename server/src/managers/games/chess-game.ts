// ─── Chess Game: white and black alternate moves until mate, a drawn position, or a match control ───

import { randomUUID } from 'node:crypto';
import type {
  ChessGameState, ChessMatchResult, ChessMoveRecord, ChessVisibleState, GameSeat, PlayerInfo, RoomCode,
} from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  chessApply, chessCell, chessInitialPosition, chessIsLegal, chessOpponent, chessPositionKey,
  chessVerdict,
} from '@shared/rules/chess';
import type { ChessMove, ChessPosition, ChessPromotion, ChessSide } from '@shared/rules/chess';
import { chessHistoryOfLog, chessRecordOf } from '@shared/games/chess/log';
import { resignationOutcome } from '@shared/rules/board/board-result';
import type { BoardOutcome } from '@shared/rules/board/board-result';
import { NO_DRAW_OFFER, afterBoardMove, applyMatchControl } from '@shared/rules/board/match-controls';
import type { MatchControlAction } from '@shared/rules/board/match-controls';
import { chessDefinition } from '@shared/games/chess/definition';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → ChessGameState */
const games: Map<RoomCode, ChessGameState> = new Map();

/** The two seats in play order: white first. */
export function chessSeats(game: Pick<ChessGameState, 'players'>): GameSeat[] {
  return occupiedSeats(game.players);
}

export function startGame(roomCode: RoomCode, players: Partial<Record<GameSeat, PlayerInfo>>, now: number = Date.now()): void {
  const seats = occupiedSeats(players);
  const start = chessInitialPosition();
  games.set(roomCode, {
    gameType: 'chess',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    board: [...start.board],
    castling: start.castling,
    enPassant: start.enPassant,
    halfmove: start.halfmove,
    currentTurnSeat: seats[0],
    drawOffer: NO_DRAW_OFFER,
    log: [],
    result: null,
  });
}

function sideOf(game: ChessGameState, seat: GameSeat): ChessSide {
  return chessSeats(game).indexOf(seat) === 0 ? 0 : 1;
}

function finish(game: ChessGameState, outcome: BoardOutcome): void {
  const result: ChessMatchResult = {
    gameType: 'chess',
    seats: chessSeats(game),
    moves: game.log.length,
    winners: [...outcome.winners],
    reason: outcome.reason,
  };
  game.phase = 'scoring';
  game.result = result;
}

/** The position the seat to move faces. */
function positionOf(game: ChessGameState): ChessPosition {
  return {
    board: game.board, turn: sideOf(game, game.currentTurnSeat), castling: game.castling, enPassant: game.enPassant,
    halfmove: game.halfmove,
  };
}

/**
 * Moves the seat's piece on its turn (a pawn reaching the last rank names its `promotion`), then passes the turn
 * or ends the match by the rules' verdict.
 */
export function move(
  roomCode: RoomCode, seat: GameSeat, fromNode: string, toNode: string, promotion?: ChessPromotion, now: number = Date.now(),
): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  const from = chessCell(fromNode);
  const to = chessCell(toNode);
  if (from === null || to === null) return { success: false, reason: 'Illegal move' };
  const chosen: ChessMove = { from, to, ...promotion ? { promotion } : {} };
  const position = positionOf(game);
  if (!chessIsLegal(position, chosen)) return { success: false, reason: 'Illegal move' };

  const entry: ChessMoveRecord = { seat, ...chessRecordOf(position, chosen), timestamp: now };
  const earlier = [...chessHistoryOfLog(game.log), chessPositionKey(position)];
  const next = chessApply(position, chosen);
  game.board = [...next.board];
  game.castling = next.castling;
  game.enPassant = next.enPassant;
  game.halfmove = next.halfmove;
  game.log.push(entry);
  game.drawOffer = afterBoardMove(game.drawOffer, seat);

  const seats = chessSeats(game);
  const verdict = chessVerdict(next, earlier);
  if (verdict === null) game.currentTurnSeat = seats[next.turn];
  else finish(game, { winners: verdict.loser === null ? [] : [seats[chessOpponent(verdict.loser)]], reason: verdict.reason });
  return { success: true };
}

/** Resignation and draw offers; they never move the turn or its clock. */
export function control(roomCode: RoomCode, seat: GameSeat, action: MatchControlAction): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  const seats = chessSeats(game);
  const applied = applyMatchControl(game.drawOffer, seat, action, chessDefinition.matchControls!, {
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
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): ChessVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'chess',
    phase: game.phase,
    mySeat: seat,
    seats: chessSeats(game),
    board: game.board,
    castling: game.castling,
    enPassant: game.enPassant,
    halfmove: game.halfmove,
    currentTurnSeat: game.currentTurnSeat,
    drawOffer: game.drawOffer,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): ChessGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): ChessGameState[] {
  return [...games.values()];
}

export function restoreGames(records: ChessGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
