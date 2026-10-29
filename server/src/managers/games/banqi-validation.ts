import { distinctPlayers, flexibleSeatGame, gameSeatList, gameSeats, number, object, oneOf, sameJson } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { BanqiGameState } from '@shared/games/banqi/types';
import { isBanqiOptions } from '@shared/banqi-options';
import { occupiedSeats } from '@shared/rules/seats';
import {
  BQ_CELLS, BQ_DOWN, BQ_EMPTY, BQ_QUIET_LIMIT, bqApplyMove, bqCell, bqColour, bqFullSet, bqHasAction, bqMovesFrom, bqNode,
  bqOpposite, bqTally, isBqBoard, isBqPiece,
} from '@shared/rules/banqi';
import type { BqColour, BqPiece, BqSlot } from '@shared/rules/banqi';
import { isBoardOutcome } from '@shared/rules/board/board-result';
import { isDrawOfferState } from '@shared/rules/board/match-controls';
import { banqiRules } from './banqi-game';

/** 32 flips plus 30 captures each followed by at most 49 quiet moves, with room for chain entries. */
const MAX_LOG = 4000;
const PIECES_PER_COLOUR = 16;
const REASONS = ['all-captured', 'no-moves', 'no-capture-limit', 'resign', 'agreed-draw'];
const LOG_KEYS = ['seat', 'from', 'to', 'revealed', 'piece', 'captured', 'chain', 'capture', 'timestamp'];

function validResultFields(value: ObjectValue, seats: readonly string[]): boolean {
  const winners = value.winners as string[];
  const remaining = value.remaining;
  if (!object(remaining) || Object.keys(remaining).some((seat) => !seats.includes(seat))
    || !Object.values(remaining).every((count) => number(count) && count <= PIECES_PER_COLOUR)
    || (Object.keys(remaining).length !== 0 && Object.keys(remaining).length !== 2)) return false;
  switch (value.reason) {
    case 'all-captured': {
      if (winners.length !== 1 || Object.keys(remaining).length !== 2) return false;
      const loser = seats.find((seat) => seat !== winners[0]) as string;
      return remaining[loser] === 0 && (remaining[winners[0]] as number) > 0;
    }
    case 'no-moves': return winners.length === 1 && Object.keys(remaining).length === 2;
    case 'no-capture-limit': return winners.length === 0 && Object.keys(remaining).length === 2;
    case 'resign': return winners.length === 1;
    case 'agreed-draw': return winners.length === 0;
    default: return false;
  }
}

/** Banqi result: both seats, the pieces each had left, and a reason that agrees with the winners. */
export function isBanqiResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'banqi' || !gameSeatList(value.seats) || value.seats.length !== 2
    || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as string[]).includes(seat)))
    || !number(value.moves) || value.moves > MAX_LOG || !oneOf(value.reason, REASONS)) return false;
  return isBoardOutcome(value, value.seats) && validResultFields(value, value.seats);
}

function banqiLog(value: unknown): boolean {
  if (!object(value) || !oneOf(value.seat, gameSeats) || !number(value.timestamp)
    || Object.keys(value).some((key) => !LOG_KEYS.includes(key)) || bqCell(value.to) === null) return false;
  if (value.chain !== undefined && value.chain !== true) return false;
  if (value.revealed !== undefined) {
    return isBqPiece(value.revealed) && Object.keys(value).length === 4;
  }
  const captured = value.captured !== undefined;
  return bqCell(value.from) !== null && isBqPiece(value.piece) && (!captured || isBqPiece(value.captured))
    && (value.capture === true) === captured && (value.capture === undefined || value.capture === true);
}

function validColours(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.length === 2 && (value[0] === 0 || value[0] === 1)
    && value[1] === bqOpposite(value[0] as BqColour));
}

export function banqiGame(value: ObjectValue, player: PlayerValidator): boolean {
  return flexibleSeatGame(value, player) && Object.keys(value.players as ObjectValue).length === 2 &&
    isBanqiOptions(value.options) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    isBqBoard(value.board) &&
    Array.isArray(value.hidden) && value.hidden.length === BQ_CELLS
    && value.hidden.every((piece: unknown) => piece === BQ_EMPTY || isBqPiece(piece)) &&
    validColours(value.colours) &&
    oneOf(value.currentTurnSeat, gameSeats) &&
    (value.chain === null || bqCell(value.chain) !== null) &&
    number(value.quietMoves) && value.quietMoves <= BQ_QUIET_LIMIT &&
    isDrawOfferState(value.drawOffer, occupiedSeats(value.players as ObjectValue)) &&
    Array.isArray(value.log) && value.log.length <= MAX_LOG && value.log.every(banqiLog) &&
    (value.result === null || isBanqiResult(value.result));
}

/**
 * Replaying the public log from an all-face-down board reproduces the board, colours, turn, chain, quiet
 * counter and result; every flip reveals a piece the set still has, every move is legal for the seat on turn,
 * and the pieces seen plus those still under face-down cells are exactly the 32 of the set.
 */
export function coherentBanqiGame(state: BanqiGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (seats.length !== 2) return false;
  const rules = banqiRules(state.options);
  let board: BqSlot[] = new Array<number>(BQ_CELLS).fill(BQ_DOWN);
  let colours: [BqColour, BqColour] | null = null;
  let turn = 0;
  let chain: number | null = null;
  let quiet = 0;
  // Assigned inside `settle`, so the cast keeps the declared type through the loop.
  let over = null as { winners: string[]; reason: string } | null;
  const captured: BqPiece[] = [];
  const takenOf = (colour: BqColour): number => captured.filter((piece) => bqColour(piece) === colour).length;

  /** Ends the turn of `seats[turn]`: a win, a draw, or the opponent's turn. A stopped chain leaves no log entry. */
  const settle = (): void => {
    chain = null;
    const opponent = 1 - turn;
    const opponentColour = colours === null ? null : colours[opponent];
    if (opponentColour !== null && takenOf(opponentColour) === PIECES_PER_COLOUR) {
      over = { winners: [seats[turn]], reason: 'all-captured' };
    } else if (opponentColour !== null && !bqHasAction(board, opponentColour, rules)) {
      over = { winners: [seats[turn]], reason: 'no-moves' };
    } else if (quiet >= BQ_QUIET_LIMIT) {
      over = { winners: [], reason: 'no-capture-limit' };
    } else {
      turn = opponent;
    }
  };

  for (const entry of state.log) {
    // The other seat acting after a capture that could continue means the chain was ended.
    if (chain !== null && entry.seat !== seats[turn]) settle();
    if (over || entry.seat !== seats[turn]) return false;
    const to = bqCell(entry.to);
    if (to === null) return false;
    if (entry.revealed !== undefined) {
      if (chain !== null || board[to] !== BQ_DOWN || entry.from !== undefined) return false;
      board = board.map((slot, cell) => (cell === to ? entry.revealed as number : slot));
      if (colours === null) {
        const first = bqColour(entry.revealed);
        colours = turn === 0 ? [first, bqOpposite(first)] : [bqOpposite(first), first];
      }
      quiet = 0;
    } else {
      const from = bqCell(entry.from);
      const colour = colours === null ? null : colours[turn];
      if (from === null || colour === null || board[from] !== entry.piece || !isBqPiece(board[from])
        || bqColour(board[from]) !== colour) return false;
      if ((chain !== null) !== (entry.chain === true) || (chain !== null && chain !== from)) return false;
      const chosen = bqMovesFrom(board, from, rules, chain !== null).find((candidate) => candidate.to === to);
      if (!chosen) return false;
      const applied = bqApplyMove(board, chosen);
      if (applied.captured !== (entry.captured ?? null)) return false;
      board = applied.board;
      if (applied.captured !== null) captured.push(applied.captured);
      quiet = chosen.capture ? 0 : quiet + 1;
      if (chosen.capture && rules.chain && bqMovesFrom(board, to, rules, true).length > 0) {
        chain = to;
        continue;
      }
    }
    settle();
  }
  // A chain left open by the last entry is either still running or was ended without a further move.
  if (chain !== null && state.chain === null) settle();

  if (!sameJson(state.board, board) || !sameJson(state.colours, colours) || state.currentTurnSeat !== seats[turn]
    || state.chain !== (chain === null ? null : bqNode(chain)) || state.quietMoves !== quiet) return false;
  // Pieces under face-down cells, those face up, and those captured make up the set exactly.
  const seen: BqPiece[] = [...captured];
  for (let cell = 0; cell < BQ_CELLS; cell++) {
    if (board[cell] === BQ_DOWN) {
      if (!isBqPiece(state.hidden[cell])) return false;
      seen.push(state.hidden[cell]);
    } else {
      if (state.hidden[cell] !== BQ_EMPTY) return false;
      if (isBqPiece(board[cell])) seen.push(board[cell]);
    }
  }
  if (!sameJson(bqTally(seen), bqTally(bqFullSet()))) return false;

  if ((state.phase === 'scoring') !== (state.result !== null)) return false;
  if (over && state.result === null) return false;
  if (state.result === null) return true;
  const result = state.result;
  if (over) {
    if (!sameJson(result.winners, over.winners) || result.reason !== over.reason) return false;
  } else if (result.reason !== 'resign' && result.reason !== 'agreed-draw') return false;
  const remaining: Record<string, number> = {};
  if (colours !== null) seats.forEach((seat, index) => { remaining[seat] = PIECES_PER_COLOUR - takenOf((colours as [BqColour, BqColour])[index]); });
  return sameJson(result.seats, seats) && result.moves === state.log.length && sameJson(result.remaining, remaining);
}
