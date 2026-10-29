import { distinctPlayers, flexibleSeatGame, gameSeatList, gameSeats, number, object, oneOf, sameJson } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { GameSeat, LandBattleGameState, LandBattleMove } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  LB_PIECES_PER_SIDE, LB_QUIET_LIMIT, isLbRank, lbApplyMove, lbCell, lbHasMove, lbLayoutError, lbNode, lbOpponent,
} from '@shared/rules/landbattle';
import type { LbSide } from '@shared/rules/landbattle';
import { isBoardOutcome } from '@shared/rules/board/board-result';
import { isDrawOfferState } from '@shared/rules/board/match-controls';
import { initialPieces, movedPieces, piecesBoard } from './landbattle-game';

/** Every battle removes at least one piece, and at most `LB_QUIET_LIMIT - 1` quiet moves come between them. */
const MAX_LOG = LB_QUIET_LIMIT * (2 * LB_PIECES_PER_SIDE + 1);

/** The reasons a Land Battle Chess match can end for. */
const REASONS = ['flag-captured', 'no-moves', 'no-capture-limit', 'resign', 'agreed-draw'];

function piecesShape(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 2 * LB_PIECES_PER_SIDE && value.every((piece: unknown) => object(piece)
    && Object.keys(piece).length === 4 && (piece.side === 0 || piece.side === 1) && isLbRank(piece.rank)
    && lbCell(piece.origin) !== null && lbCell(piece.node) !== null);
}

function logShape(value: unknown): boolean {
  if (!object(value) || !oneOf(value.seat, gameSeats) || !number(value.timestamp)) return false;
  if (Object.keys(value).some((key) => !['seat', 'from', 'to', 'path', 'capture', 'battle', 'flagShown', 'timestamp'].includes(key))) return false;
  if (lbCell(value.from) === null || lbCell(value.to) === null) return false;
  if (value.path !== undefined && (!Array.isArray(value.path) || value.path.length === 0 || value.path.length > 20
    || !value.path.every((node: unknown) => lbCell(node) !== null))) return false;
  if ((value.capture === undefined) !== (value.battle === undefined)) return false;
  if (value.capture !== undefined && (value.capture !== true || !oneOf(value.battle, ['win', 'lose', 'tie']))) return false;
  return value.flagShown === undefined || (gameSeatList(value.flagShown) && value.flagShown.length > 0 && value.battle !== undefined);
}

/** Land Battle Chess result: both seats with their remaining pieces, and a reason that agrees with the winners. */
export function isLandBattleResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'landbattle' || !gameSeatList(value.seats) || value.seats.length !== 2
    || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as string[]).includes(seat)))
    || !number(value.moves) || value.moves > MAX_LOG || !oneOf(value.reason, REASONS)) return false;
  const seats = value.seats;
  const remaining = value.remaining;
  if (!object(remaining) || Object.keys(remaining).length !== 2
    || !seats.every((seat) => number(remaining[seat]) && remaining[seat] <= LB_PIECES_PER_SIDE)) return false;
  if (!isBoardOutcome(value, seats)) return false;
  const winners = value.winners as string[];
  return value.reason === 'no-capture-limit' || value.reason === 'agreed-draw' ? winners.length === 0 : winners.length === 1;
}

export function landBattleGame(value: ObjectValue, player: PlayerValidator): boolean {
  if (!flexibleSeatGame(value, player) || Object.keys(value.players as ObjectValue).length !== 2) return false;
  const seats = occupiedSeats(value.players as ObjectValue);
  const layouts = value.layouts;
  return oneOf(value.phase, ['deploying', 'playing', 'scoring']) && number(value.deployDeadline)
    && object(layouts) && Object.keys(layouts).length === 2
    && seats.every((seat) => layouts[seat] === null || lbLayoutError(layouts[seat]) === null)
    && gameSeatList(value.autoDeployed) && value.autoDeployed.every((seat) => seats.includes(seat))
    && piecesShape(value.pieces)
    && oneOf(value.currentTurnSeat, seats)
    && isDrawOfferState(value.drawOffer, seats)
    && number(value.quietMoves) && value.quietMoves <= LB_QUIET_LIMIT
    && gameSeatList(value.flagsShown) && value.flagsShown.every((seat) => seats.includes(seat))
    && Array.isArray(value.log) && value.log.length <= MAX_LOG && value.log.every(logShape)
    && (value.result === null || isLandBattleResult(value.result));
}

/**
 * Replaying the public log from both deployments reproduces the pieces, the turn, the quiet-move count, the
 * shown flags, and the result: every move is legal for the seat on turn and records the outcome the rules
 * give, and a match ends by the rules only when they say so.
 */
export function coherentLandBattleGame(state: LandBattleGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (seats.length !== 2 || (state.phase === 'scoring') !== (state.result !== null)) return false;
  if (!sameJson(state.autoDeployed, seats.filter((seat) => state.autoDeployed.includes(seat)))) return false;
  const [first, second] = seats.map((seat) => state.layouts[seat] ?? null);
  if (!first || !second) {
    // Before both deployments only a resignation can end the match, and nothing has moved.
    return state.log.length === 0 && state.pieces.length === 0 && state.quietMoves === 0 && state.flagsShown.length === 0
      && state.currentTurnSeat === seats[0] && (state.result === null
        ? state.phase === 'deploying' : state.result.reason === 'resign' && sameJson(state.result.remaining, { [seats[0]]: 0, [seats[1]]: 0 }));
  }
  if (state.phase === 'deploying') return false;

  let pieces = initialPieces([first, second]);
  let side: LbSide = 0;
  let quiet = 0;
  const shown: GameSeat[] = [];
  let ended: { winners: GameSeat[]; reason: string } | null = null;
  for (const entry of state.log) {
    if (ended || entry.seat !== seats[side]) return false;
    const from = lbCell(entry.from)!;
    const to = lbCell(entry.to)!;
    const board = piecesBoard(pieces);
    if (board[from]?.side !== side) return false;
    const applied = lbApplyMove(board, from, to);
    if (!applied) return false;
    const fallen = applied.removed.filter((piece) => piece.rank === 'marshal').map((piece) => seats[piece.side]);
    const expected: LandBattleMove = {
      seat: entry.seat, from: entry.from, to: entry.to,
      ...applied.path.length > 0 ? { path: applied.path.map(lbNode) } : {},
      ...applied.outcome === 'move' ? {} : { capture: true, battle: applied.outcome },
      ...fallen.length > 0 ? { flagShown: seats.filter((seat) => fallen.includes(seat)) } : {},
      timestamp: entry.timestamp,
    };
    if (!sameJson(entry, expected)) return false;
    pieces = movedPieces(pieces, from, to, applied.outcome);
    quiet = applied.outcome === 'move' ? quiet + 1 : 0;
    for (const seat of fallen) if (!shown.includes(seat)) shown.push(seat);
    const opponent = lbOpponent(side);
    if (applied.flagCaptured) ended = { winners: [entry.seat], reason: 'flag-captured' };
    else if (!lbHasMove(applied.board, opponent)) ended = { winners: [entry.seat], reason: 'no-moves' };
    else if (quiet >= LB_QUIET_LIMIT) ended = { winners: [], reason: 'no-capture-limit' };
    else side = opponent;
  }
  if (!sameJson(state.pieces, pieces) || state.quietMoves !== quiet || state.currentTurnSeat !== seats[side]
    || !sameJson(state.flagsShown, seats.filter((seat) => shown.includes(seat)))) return false;
  const result = state.result;
  if (ended && !result) return false;
  if (!result) return true;
  const natural = ended ? sameJson(result.winners, ended.winners) && result.reason === ended.reason
    : ['resign', 'agreed-draw'].includes(result.reason);
  return natural && sameJson(result.seats, seats) && result.moves === state.log.length
    && sameJson(result.remaining, Object.fromEntries(seats.map((seat, index) => [seat,
      pieces.filter((piece) => piece.side === index).length])));
}
