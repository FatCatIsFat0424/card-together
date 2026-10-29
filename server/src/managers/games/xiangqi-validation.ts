import { distinctPlayers, flexibleSeatGame, gameSeatList, gameSeats, number, object, oneOf, sameJson } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { XiangqiGameState, XiangqiMove } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  XQ_NO_CAPTURE_PLIES, isXqBoard, isXqPiece, xqApply, xqCell, xqInitialBoard, xqIsLegal, xqMoveFacts, xqOpponent, xqVerdict,
} from '@shared/rules/xiangqi';
import type { XqBoard, XqPly, XqSide } from '@shared/rules/xiangqi';
import { isBoardOutcome } from '@shared/rules/board/board-result';
import { isDrawOfferState } from '@shared/rules/board/match-controls';
import { isXiangqiOptions } from '@shared/xiangqi-options';

/** Thirty captures at most, each quiet stretch ending the game at the no-capture limit. */
const MAX_PLIES = 31 * XQ_NO_CAPTURE_PLIES;

const DECISIVE = ['checkmate', 'stalemate', 'perpetual-check', 'resign'];
const DRAWN = ['repetition', 'no-capture-limit', 'agreed-draw'];
const MOVE_KEYS = ['seat', 'from', 'to', 'piece', 'captured', 'capture', 'check', 'line', 'timestamp'];

/** Xiangqi result: both seats in play order and a reason that agrees with the number of winners. */
export function isXiangqiResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'xiangqi' || !gameSeatList(value.seats) || value.seats.length !== 2
    || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as string[]).includes(seat)))
    || !number(value.moves) || value.moves > MAX_PLIES || !oneOf(value.reason, [...DECISIVE, ...DRAWN])) return false;
  if (!isBoardOutcome(value, value.seats)) return false;
  return (value.winners as unknown[]).length === (DECISIVE.includes(value.reason as string) ? 1 : 0);
}

function line(value: unknown): boolean {
  if (value === undefined) return true;
  if (!object(value) || Object.keys(value).some((key) => !['order', 'count', 'crowded'].includes(key))) return false;
  return number(value.count) && value.count >= 2 && value.count <= 5 && number(value.order) && value.order < value.count
    && (value.crowded === undefined || value.crowded === true);
}

function xiangqiLog(value: unknown): boolean {
  if (!object(value) || !oneOf(value.seat, gameSeats) || !number(value.timestamp)) return false;
  if (Object.keys(value).some((key) => !MOVE_KEYS.includes(key))) return false;
  return xqCell(value.from) !== null && xqCell(value.to) !== null && isXqPiece(value.piece)
    && (value.captured === undefined || isXqPiece(value.captured))
    && (value.capture === undefined ? value.captured === undefined : value.capture === true && value.captured !== undefined)
    && (value.check === undefined || value.check === true) && line(value.line);
}

export function xiangqiGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) && Object.keys(value.players as ObjectValue).length === 2 &&
    isXiangqiOptions(value.options) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    isXqBoard(value.board) &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    isDrawOfferState(value.drawOffer, occupiedSeats(value.players as ObjectValue)) &&
    Array.isArray(value.log) && value.log.length <= MAX_PLIES && value.log.every(xiangqiLog) &&
    (value.result === null || isXiangqiResult(value.result));
}

/** The public facts a move must carry, recomputed from the position before it. */
function expectedMove(board: XqBoard, entry: XiangqiMove, from: number, to: number): Omit<XiangqiMove, 'seat' | 'timestamp'> {
  const facts = xqMoveFacts(board, from, to);
  return {
    from: entry.from, to: entry.to, piece: facts.piece,
    ...facts.captured ? { captured: facts.captured, capture: true } : {},
    ...facts.check ? { check: true } : {},
    ...facts.line ? { line: facts.line } : {},
  };
}

/**
 * Replaying the public log from the start (with the room's handicap) reproduces the board, the turn, and the
 * result: every move is legal for the side on turn and records exactly its public facts, nothing follows a
 * game-ending position, and a match that ended on the board names the rules' own verdict.
 */
export function coherentXiangqiGame(state: XiangqiGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (seats.length !== 2) return false;
  let board: XqBoard = xqInitialBoard(state.options.handicap, state.options.handicapSide);
  let side: XqSide = 0;
  let verdict: ReturnType<typeof xqVerdict> = null;
  const plies: XqPly[] = [];
  for (const entry of state.log) {
    if (verdict !== null) return false;
    const from = xqCell(entry.from);
    const to = xqCell(entry.to);
    if (from === null || to === null || entry.seat !== seats[side] || !xqIsLegal(board, side, from, to)) return false;
    const { seat: _seat, timestamp: _timestamp, ...recorded } = entry;
    if (!sameJson(recorded, expectedMove(board, entry, from, to))) return false;
    plies.push({ from, to, piece: entry.piece, captured: entry.captured ?? null, check: entry.check === true });
    board = xqApply(board, from, to);
    side = xqOpponent(side);
    verdict = xqVerdict(board, side, plies);
  }
  if (!sameJson(state.board, board)) return false;
  // A match that ended on the board leaves the turn with the seat that made the last move.
  if (state.currentTurnSeat !== seats[verdict === null ? side : xqOpponent(side)]) return false;
  if ((state.phase === 'scoring') !== (state.result !== null)) return false;
  if (verdict !== null && state.result === null) return false;
  const result = state.result;
  if (result === null) return true;
  const natural = verdict === null ? ['resign', 'agreed-draw'].includes(result.reason)
    : result.reason === verdict.reason
      && sameJson(result.winners, verdict.loser === null ? [] : [seats[xqOpponent(verdict.loser)]]);
  return natural && sameJson(result.seats, seats) && result.moves === state.log.length;
}
