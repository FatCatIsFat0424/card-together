import type { GameClock, GamePresentation, ObserverRole } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { NodeId } from '../../rules/board/board-model';
import type { BoardMoveRecord } from '../../rules/board/board-move';
import type { BoardOutcome } from '../../rules/board/board-result';
import type { DrawOfferState } from '../../rules/board/match-controls';

/** One public move: the animal's rank (1 rat to 8 elephant) and, for a capture, the rank it took. */
export interface JungleMove extends BoardMoveRecord {
  readonly seat: GameSeat;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly piece: number;
  readonly capture: boolean;
  readonly captured?: number;
  readonly timestamp: number;
}

export type JunglePhase = 'playing' | 'scoring';

/** Both seats play to the end, so the result lists them with the pieces each has left. */
export interface JungleMatchResult extends BoardOutcome {
  readonly gameType: 'jungle';
  /** The two seats in play order: the first moves first */
  readonly seats: GameSeat[];
  /** Pieces left on the board when the match ended */
  readonly pieces: Partial<Record<GameSeat, number>>;
  /** Moves made by both seats */
  readonly moves: number;
}

export interface JungleGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'jungle';
  readonly id: string;
  readonly startedAt: number;
  /** The two seats playing; the first in seat order plays side 0 and moves first */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: JunglePhase;
  /** Row-major cells, `row * 7 + col`: 0 empty, a piece is its rank, plus 8 for the second seat */
  cells: number[];
  currentTurnSeat: GameSeat;
  drawOffer: DrawOfferState;
  log: JungleMove[];
  result: JungleMatchResult | null;
}

/** Jungle has no hidden information: every seat and spectator sees the whole state. */
export interface JungleVisibleState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly observer?: ObserverRole;
  readonly gameType: 'jungle';
  readonly phase: JunglePhase;
  readonly mySeat: GameSeat;
  /** The two seats in play order: the first moves first */
  readonly seats: readonly GameSeat[];
  readonly cells: readonly number[];
  readonly currentTurnSeat: GameSeat;
  readonly drawOffer: DrawOfferState;
  readonly log: readonly JungleMove[];
  readonly result: JungleMatchResult | null;
}

export interface JungleGameContract {
  readonly state: JungleGameState;
  readonly visible: JungleVisibleState;
  readonly result: JungleMatchResult;
  readonly options: Record<string, never>;
}
