import type { GameClock, GamePresentation, ObserverRole } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { NodeId } from '../../rules/board/board-model';
import type { BoardMoveRecord } from '../../rules/board/board-move';
import type { BoardOutcome } from '../../rules/board/board-result';
import type { DrawOfferState } from '../../rules/board/match-controls';
import type { ChessCastling, ChessCell, ChessPiece, ChessPromotion } from '../../rules/chess';

/** One public move; nothing in Chess is hidden. Named apart from the rules' square-index `ChessMove`. */
export interface ChessMoveRecord extends BoardMoveRecord {
  readonly seat: GameSeat;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly piece: ChessPiece;
  /** The piece taken, when the move captured; for en passant the pawn beside the target square. */
  readonly captured?: ChessPiece;
  readonly capture?: boolean;
  readonly promotion?: ChessPromotion;
  /** Castling side: `k` for short (O-O), `q` for long (O-O-O). */
  readonly castle?: 'k' | 'q';
  readonly enPassant?: boolean;
  /** The move put the opposing king in check (checkmate included). */
  readonly check?: boolean;
  readonly checkmate?: boolean;
  /** Standard algebraic notation in English piece letters. */
  readonly san: string;
  readonly timestamp: number;
}

export type ChessPhase = 'playing' | 'scoring';

export interface ChessMatchResult extends BoardOutcome {
  readonly gameType: 'chess';
  /** The two seats in play order: white first */
  readonly seats: GameSeat[];
  /** Plies played */
  readonly moves: number;
}

export interface ChessGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'chess';
  readonly id: string;
  readonly startedAt: number;
  /** The two seats playing; the first in seat order plays white */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: ChessPhase;
  /** Row-major squares, `row * 8 + col`, rank 8 (black's back rank) first */
  board: ChessCell[];
  castling: ChessCastling;
  /** The square a pawn skipped over on the previous move, or null */
  enPassant: number | null;
  /** Plies since the last capture or pawn move */
  halfmove: number;
  currentTurnSeat: GameSeat;
  drawOffer: DrawOfferState;
  log: ChessMoveRecord[];
  result: ChessMatchResult | null;
}

/** Chess has no hidden information: every seat and spectator sees the whole state. */
export interface ChessVisibleState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly observer?: ObserverRole;
  readonly gameType: 'chess';
  readonly phase: ChessPhase;
  readonly mySeat: GameSeat;
  /** The two seats in play order: white first */
  readonly seats: readonly GameSeat[];
  readonly board: readonly ChessCell[];
  readonly castling: ChessCastling;
  readonly enPassant: number | null;
  readonly halfmove: number;
  readonly currentTurnSeat: GameSeat;
  readonly drawOffer: DrawOfferState;
  readonly log: readonly ChessMoveRecord[];
  readonly result: ChessMatchResult | null;
}

export interface ChessGameContract {
  readonly state: ChessGameState;
  readonly visible: ChessVisibleState;
  readonly result: ChessMatchResult;
  readonly options: Record<string, never>;
}
