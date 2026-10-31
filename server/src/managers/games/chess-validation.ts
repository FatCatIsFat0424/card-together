import { distinctPlayers, flexibleSeatGame, gameSeatList, gameSeats, number, object, oneOf, sameJson } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { ChessGameState } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  CHESS_CELLS, CHESS_FIFTY_MOVE_PLIES, CHESS_PROMOTIONS, chessApply, chessCell, chessInitialPosition, chessIsLegal,
  chessOpponent, chessPositionKey, chessVerdict, isChessBoard, isChessPiece,
} from '@shared/rules/chess';
import type { ChessPosition } from '@shared/rules/chess';
import { chessMoveOfRecord, chessRecordOf } from '@shared/games/chess/log';
import { isBoardOutcome } from '@shared/rules/board/board-result';
import { isDrawOfferState } from '@shared/rules/board/match-controls';

/** Far above any game the draw rules allow, which keeps stored logs bounded. */
const MAX_PLIES = 6000;

const DECISIVE = ['checkmate', 'resign'];
const DRAWN = ['stalemate', 'repetition', 'fifty-move', 'insufficient-material', 'agreed-draw'];
const MOVE_KEYS = ['seat', 'from', 'to', 'piece', 'captured', 'capture', 'promotion', 'castle', 'enPassant', 'check', 'checkmate', 'san', 'timestamp'];

/** Chess result: both seats in play order and a reason that agrees with the number of winners. */
export function isChessResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'chess' || !gameSeatList(value.seats) || value.seats.length !== 2
    || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as string[]).includes(seat)))
    || !number(value.moves) || value.moves > MAX_PLIES || !oneOf(value.reason, [...DECISIVE, ...DRAWN])) return false;
  if (!isBoardOutcome(value, value.seats)) return false;
  return (value.winners as unknown[]).length === (DECISIVE.includes(value.reason as string) ? 1 : 0);
}

function chessLog(value: unknown): boolean {
  if (!object(value) || !oneOf(value.seat, gameSeats) || !number(value.timestamp)) return false;
  if (Object.keys(value).some((key) => !MOVE_KEYS.includes(key))) return false;
  const flag = (field: unknown): boolean => field === undefined || field === true;
  return chessCell(value.from) !== null && chessCell(value.to) !== null && isChessPiece(value.piece)
    && typeof value.san === 'string' && value.san.length > 0 && value.san.length <= 12
    && (value.captured === undefined || isChessPiece(value.captured))
    && (value.capture === undefined ? value.captured === undefined : value.capture === true && value.captured !== undefined)
    && (value.promotion === undefined || oneOf(value.promotion, [...CHESS_PROMOTIONS]))
    && (value.castle === undefined || oneOf(value.castle, ['k', 'q']))
    && flag(value.enPassant) && flag(value.check) && flag(value.checkmate);
}

function castlingShape(value: unknown): boolean {
  return object(value) && Object.keys(value).length === 4 && ['K', 'Q', 'k', 'q'].every((key) => typeof value[key] === 'boolean');
}

export function chessGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) && Object.keys(value.players as ObjectValue).length === 2 &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    isChessBoard(value.board) &&
    castlingShape(value.castling) &&
    (value.enPassant === null || (number(value.enPassant) && value.enPassant < CHESS_CELLS)) &&
    number(value.halfmove) && value.halfmove <= CHESS_FIFTY_MOVE_PLIES &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    isDrawOfferState(value.drawOffer, occupiedSeats(value.players as ObjectValue)) &&
    Array.isArray(value.log) && value.log.length <= MAX_PLIES && value.log.every(chessLog) &&
    (value.result === null || isChessResult(value.result));
}

/**
 * Replaying the public log from the start position reproduces the board, the rights, the turn, and the result:
 * every move is legal for the side on turn and records exactly its public facts, nothing follows a game-ending
 * position, and a match that ended on the board names the rules' own verdict.
 */
export function coherentChessGame(state: ChessGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (seats.length !== 2) return false;
  let position: ChessPosition = chessInitialPosition();
  const history: string[] = [];
  let verdict: ReturnType<typeof chessVerdict> = null;
  for (const entry of state.log) {
    if (verdict !== null) return false;
    const move = chessMoveOfRecord(entry);
    if (move === null || entry.seat !== seats[position.turn] || !chessIsLegal(position, move)) return false;
    const { seat: _seat, timestamp: _timestamp, ...recorded } = entry;
    if (!sameJson(recorded, chessRecordOf(position, move))) return false;
    history.push(chessPositionKey(position));
    position = chessApply(position, move);
    verdict = chessVerdict(position, history);
  }
  if (!sameJson(state.board, position.board) || !sameJson(state.castling, position.castling)
    || state.enPassant !== position.enPassant || state.halfmove !== position.halfmove) return false;
  // A match that ended on the board leaves the turn with the seat that made the last move.
  if (state.currentTurnSeat !== seats[verdict === null ? position.turn : chessOpponent(position.turn)]) return false;
  if ((state.phase === 'scoring') !== (state.result !== null)) return false;
  if (verdict !== null && state.result === null) return false;
  const result = state.result;
  if (result === null) return true;
  const natural = verdict === null ? ['resign', 'agreed-draw'].includes(result.reason)
    : result.reason === verdict.reason
      && sameJson(result.winners, verdict.loser === null ? [] : [seats[chessOpponent(verdict.loser)]]);
  return natural && sameJson(result.seats, seats) && result.moves === state.log.length;
}
