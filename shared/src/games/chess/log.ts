import { chessCell, chessMoveFacts, chessNode, chessReplay } from '../../rules/chess';
import type { ChessMove, ChessPosition } from '../../rules/chess';
import type { ChessMoveRecord } from './types';

/** The move a log entry records, as square indices; null when the entry names a node off the board. */
export function chessMoveOfRecord(entry: Pick<ChessMoveRecord, 'from' | 'to' | 'promotion'>): ChessMove | null {
  const from = chessCell(entry.from);
  const to = chessCell(entry.to);
  return from === null || to === null ? null : { from, to, ...entry.promotion ? { promotion: entry.promotion } : {} };
}

/**
 * Keys of every position that came before the one the log leads to, which repetition counts. Replays the log
 * from the start position, so the log must hold legal moves only.
 */
export function chessHistoryOfLog(log: readonly Pick<ChessMoveRecord, 'from' | 'to' | 'promotion'>[]): string[] {
  const moves = log.map(chessMoveOfRecord);
  if (moves.some((move) => move === null)) throw new Error('Log names a square off the board');
  return chessReplay(moves as ChessMove[]).history;
}

/** The public facts a legal move must carry in the log, everything but who moved and when. */
export function chessRecordOf(position: ChessPosition, move: ChessMove): Omit<ChessMoveRecord, 'seat' | 'timestamp'> {
  const facts = chessMoveFacts(position, move);
  return {
    from: chessNode(move.from), to: chessNode(move.to), piece: facts.piece,
    ...facts.captured ? { captured: facts.captured, capture: true } : {},
    ...facts.promotion ? { promotion: facts.promotion } : {},
    ...facts.castle ? { castle: facts.castle } : {},
    ...facts.enPassant ? { enPassant: true } : {},
    ...facts.check ? { check: true } : {},
    ...facts.checkmate ? { checkmate: true } : {},
    san: facts.san,
  };
}
