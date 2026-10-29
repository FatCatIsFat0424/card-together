import type { GameClock, GamePresentation, ObserverRole } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { NodeId } from '../../rules/board/board-model';
import type { BoardMoveRecord } from '../../rules/board/board-move';
import type { BoardOutcome } from '../../rules/board/board-result';
import type { DrawOfferState } from '../../rules/board/match-controls';
import type { RvCell } from '../../rules/reversi';

/**
 * One public move. A placement names the cell and the discs it flipped; a pass (the seat had no legal move,
 * recorded automatically) has neither.
 */
export interface ReversiMove extends BoardMoveRecord {
  readonly seat: GameSeat;
  readonly to?: NodeId;
  /** Discs turned over by the placement, in board-scan order; empty for a pass */
  readonly flips: readonly NodeId[];
  readonly timestamp: number;
}

export type ReversiPhase = 'playing' | 'scoring';

/** Both seats play to the end, so the result lists them with the final disc totals. */
export interface ReversiMatchResult extends BoardOutcome {
  readonly gameType: 'reversi';
  /** The two seats in play order: dark first */
  readonly seats: GameSeat[];
  /** Discs on the board when the match ended */
  readonly discs: Partial<Record<GameSeat, number>>;
  /** Placements made; automatic passes are not counted */
  readonly moves: number;
}

export interface ReversiGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'reversi';
  readonly id: string;
  readonly startedAt: number;
  /** The two seats playing; the first in seat order plays dark */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: ReversiPhase;
  /** Row-major cells, `row * 8 + col` */
  discs: RvCell[];
  currentTurnSeat: GameSeat;
  drawOffer: DrawOfferState;
  log: ReversiMove[];
  result: ReversiMatchResult | null;
}

/** Reversi has no hidden information: every seat and spectator sees the whole state. */
export interface ReversiVisibleState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly observer?: ObserverRole;
  readonly gameType: 'reversi';
  readonly phase: ReversiPhase;
  readonly mySeat: GameSeat;
  /** The two seats in play order: dark first */
  readonly seats: readonly GameSeat[];
  readonly discs: readonly RvCell[];
  readonly currentTurnSeat: GameSeat;
  readonly drawOffer: DrawOfferState;
  readonly log: readonly ReversiMove[];
  readonly result: ReversiMatchResult | null;
}

export interface ReversiGameContract {
  readonly state: ReversiGameState;
  readonly visible: ReversiVisibleState;
  readonly result: ReversiMatchResult;
  readonly options: Record<string, never>;
}
