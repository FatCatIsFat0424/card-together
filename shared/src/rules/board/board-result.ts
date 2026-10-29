// ─── Board game outcomes and why they ended ───

import type { GameSeat } from '../../types/player';

/**
 * Why a board match ended. Append new reasons for new games; the client dictionaries must name every entry,
 * so a missing translation fails to compile.
 */
export const BOARD_RESULT_REASONS = [
  'resign',
  'checkmate',
  /** Xiangqi: the side to move has no legal move (counts as a loss). */
  'stalemate',
  'agreed-draw',
  'timeout',
  /** Repeated position ruled a draw. */
  'repetition',
  /** Xiangqi: the side giving perpetual check loses. */
  'perpetual-check',
  /** Move limit without a capture (Xiangqi 60 moves, Banqi 50) ruled a draw. */
  'no-capture-limit',
  /** The opponent has no piece that can move. */
  'no-moves',
  'all-captured',
  /** Reversi: neither side can move; more discs win. */
  'disc-count',
  /** Gomoku: five (or more) in a row. */
  'five-in-row',
  /** Gomoku: the board filled up without a line. */
  'board-full',
  /** Jungle: a piece entered the opponent's den. */
  'den-entered',
  /** Land Battle Chess: the opponent's flag was captured. */
  'flag-captured',
  /** Chinese checkers: every piece reached the opposite corner. */
  'all-home',
  /** Chinese checkers: the turn limit ran out; the most progress wins. */
  'move-limit',
  /** Battleship: every ship of the opponent's fleet was sunk. */
  'fleet-sunk',
] as const;

export type BoardResultReason = typeof BOARD_RESULT_REASONS[number];

/** How a board match ended; board results include it so history and replays show the reason. */
export interface BoardOutcome {
  /** Empty for a draw; one seat for a two-player win; the finishing order's first seats for multi-player games. */
  readonly winners: readonly GameSeat[];
  readonly reason: BoardResultReason;
}

export function isBoardResultReason(value: unknown): value is BoardResultReason {
  return (BOARD_RESULT_REASONS as readonly unknown[]).includes(value);
}

/** Shape check for persisted outcomes; `seats` are the match's seats. */
export function isBoardOutcome(value: unknown, seats: readonly GameSeat[]): value is BoardOutcome {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isBoardResultReason(record.reason) && Array.isArray(record.winners)
    && record.winners.every((seat) => seats.includes(seat as GameSeat))
    && new Set(record.winners).size === record.winners.length;
}

/** The outcome when `seat` resigns a two-player match: the other seat wins. */
export function resignationOutcome(seat: GameSeat, seats: readonly GameSeat[]): BoardOutcome {
  return { winners: seats.filter((other) => other !== seat), reason: 'resign' };
}
