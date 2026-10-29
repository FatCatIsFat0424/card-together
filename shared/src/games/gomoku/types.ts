import type { GameClock, GamePresentation, ObserverRole } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { NodeId } from '../../rules/board/board-model';
import type { BoardMoveRecord } from '../../rules/board/board-move';
import type { BoardOutcome } from '../../rules/board/board-result';
import type { DrawOfferState } from '../../rules/board/match-controls';
import type { GmCell, GomokuOptions } from '../../rules/gomoku';

/**
 * One public move: a stone on an intersection, or (swap opening only) the second seat's colour choice, which
 * has no `to`. The colour of a stone follows from how many are down, so it is not stored.
 */
export interface GomokuMove extends BoardMoveRecord {
  readonly seat: GameSeat;
  readonly to?: NodeId;
  /** Present only on the colour choice: true when the second seat took black */
  readonly swap?: boolean;
  readonly timestamp: number;
}

export type GomokuPhase = 'playing' | 'scoring';

export interface GomokuMatchResult extends BoardOutcome {
  readonly gameType: 'gomoku';
  /** The two seats in seat order */
  readonly seats: GameSeat[];
  /** The seat that played black, which is the second seat after a swap */
  readonly blackSeat: GameSeat;
  /** Stones on the board when the match ended */
  readonly moves: number;
  readonly options: GomokuOptions;
}

export interface GomokuGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'gomoku';
  readonly id: string;
  readonly startedAt: number;
  /** The two seats playing; the first in seat order lays the first stone */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  readonly options: GomokuOptions;
  phase: GomokuPhase;
  /** Row-major intersections, `row * 15 + col`; 0 is black, 1 white */
  stones: GmCell[];
  currentTurnSeat: GameSeat;
  drawOffer: DrawOfferState;
  log: GomokuMove[];
  result: GomokuMatchResult | null;
}

/** Gomoku has no hidden information: every seat and spectator sees the whole state. */
export interface GomokuVisibleState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly observer?: ObserverRole;
  readonly gameType: 'gomoku';
  readonly phase: GomokuPhase;
  readonly mySeat: GameSeat;
  /** The two seats in seat order */
  readonly seats: readonly GameSeat[];
  readonly options: GomokuOptions;
  readonly stones: readonly GmCell[];
  readonly currentTurnSeat: GameSeat;
  readonly drawOffer: DrawOfferState;
  readonly log: readonly GomokuMove[];
  readonly result: GomokuMatchResult | null;
}

export interface GomokuGameContract {
  readonly state: GomokuGameState;
  readonly visible: GomokuVisibleState;
  readonly result: GomokuMatchResult;
  readonly options: GomokuOptions;
}
