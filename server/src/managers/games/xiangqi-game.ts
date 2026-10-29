// ─── Xiangqi Game: red and black alternate moves until mate, repetition, the no-capture limit, or a match control ───

import { randomUUID } from 'node:crypto';
import type {
  GameSeat, PlayerInfo, RoomCode, XiangqiGameState, XiangqiMatchResult, XiangqiMove, XiangqiOptions, XiangqiVisibleState,
} from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  xqApply, xqCell, xqInitialBoard, xqIsLegal, xqMoveFacts, xqNode, xqOpponent, xqPlies, xqVerdict,
} from '@shared/rules/xiangqi';
import type { XqSide } from '@shared/rules/xiangqi';
import { resignationOutcome } from '@shared/rules/board/board-result';
import type { BoardOutcome } from '@shared/rules/board/board-result';
import { NO_DRAW_OFFER, afterBoardMove, applyMatchControl } from '@shared/rules/board/match-controls';
import type { MatchControlAction } from '@shared/rules/board/match-controls';
import { xiangqiDefinition } from '@shared/games/xiangqi/definition';
import { DEFAULT_XIANGQI_OPTIONS } from '@shared/xiangqi-options';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → XiangqiGameState */
const games: Map<RoomCode, XiangqiGameState> = new Map();

/** The two seats in play order: red first. */
export function xiangqiSeats(game: Pick<XiangqiGameState, 'players'>): GameSeat[] {
  return occupiedSeats(game.players);
}

export function startGame(
  roomCode: RoomCode, players: Partial<Record<GameSeat, PlayerInfo>>,
  options: XiangqiOptions = DEFAULT_XIANGQI_OPTIONS, now: number = Date.now(),
): void {
  const seats = occupiedSeats(players);
  games.set(roomCode, {
    gameType: 'xiangqi',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    options: { ...options },
    phase: 'playing',
    board: [...xqInitialBoard(options.handicap, options.handicapSide)],
    currentTurnSeat: seats[0],
    drawOffer: NO_DRAW_OFFER,
    log: [],
    result: null,
  });
}

function sideOf(game: XiangqiGameState, seat: GameSeat): XqSide {
  return xiangqiSeats(game).indexOf(seat) === 0 ? 0 : 1;
}

function finish(game: XiangqiGameState, outcome: BoardOutcome): void {
  const result: XiangqiMatchResult = {
    gameType: 'xiangqi',
    seats: xiangqiSeats(game),
    moves: game.log.length,
    winners: [...outcome.winners],
    reason: outcome.reason,
  };
  game.phase = 'scoring';
  game.result = result;
}

/** Moves the seat's piece on its turn, then passes the turn or ends the match by the rules' verdict. */
export function move(roomCode: RoomCode, seat: GameSeat, fromNode: string, toNode: string, now: number = Date.now()): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  const from = xqCell(fromNode);
  const to = xqCell(toNode);
  const side = sideOf(game, seat);
  if (from === null || to === null || !xqIsLegal(game.board, side, from, to)) return { success: false, reason: 'Illegal move' };

  const facts = xqMoveFacts(game.board, from, to);
  const entry: XiangqiMove = {
    seat, from: xqNode(from), to: xqNode(to), piece: facts.piece,
    ...facts.captured ? { captured: facts.captured, capture: true } : {},
    ...facts.check ? { check: true } : {},
    ...facts.line ? { line: facts.line } : {},
    timestamp: now,
  };
  game.board = xqApply(game.board, from, to);
  game.log.push(entry);
  game.drawOffer = afterBoardMove(game.drawOffer, seat);

  const seats = xiangqiSeats(game);
  const next = xqOpponent(side);
  const verdict = xqVerdict(game.board, next, xqPlies(game.log));
  if (verdict === null) game.currentTurnSeat = seats[next];
  else finish(game, { winners: verdict.loser === null ? [] : [seats[xqOpponent(verdict.loser)]], reason: verdict.reason });
  return { success: true };
}

/** Resignation and draw offers; they never move the turn or its clock. */
export function control(roomCode: RoomCode, seat: GameSeat, action: MatchControlAction): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: 'The game is over' };
  const seats = xiangqiSeats(game);
  const applied = applyMatchControl(game.drawOffer, seat, action, xiangqiDefinition.matchControls!, {
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
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): XiangqiVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'xiangqi',
    phase: game.phase,
    mySeat: seat,
    seats: xiangqiSeats(game),
    options: game.options,
    board: game.board,
    currentTurnSeat: game.currentTurnSeat,
    drawOffer: game.drawOffer,
    log: game.log,
    result: game.result,
  };
}

export function getGameState(roomCode: RoomCode): XiangqiGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): XiangqiGameState[] {
  return [...games.values()];
}

export function restoreGames(records: XiangqiGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
