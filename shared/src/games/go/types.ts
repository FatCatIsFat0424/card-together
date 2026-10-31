import type { GameClock, GamePresentation, ObserverRole } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { NodeId } from '../../rules/board/board-model';
import type { BoardMoveRecord } from '../../rules/board/board-move';
import type { BoardOutcome } from '../../rules/board/board-result';
import type { DrawOfferState } from '../../rules/board/match-controls';
import type { GoCell, GoOptions } from '../../rules/go';

/** One public move: a stone on an intersection (`to`), or a pass, which has no `to`. */
export interface GoMoveRecord extends BoardMoveRecord {
  readonly seat: GameSeat;
  readonly to?: NodeId;
  /** Opponent stones this move removed; present only when it captured. */
  readonly captured?: number;
  readonly timestamp: number;
}

/**
 * `playing` and `marking` (both passed, or the move cap reached: the seats agree on the dead stones) are live;
 * `scoring` means the match is finished, as in every game.
 */
export type GoPhase = 'playing' | 'marking' | 'scoring';

export interface GoMatchResult extends BoardOutcome {
  readonly gameType: 'go';
  /** The two seats in play order; the first plays black */
  readonly seats: GameSeat[];
  readonly options: GoOptions;
  /** Log entries, passes included */
  readonly moves: number;
  /** Opponent stones each seat captured during play */
  readonly captured: Partial<Record<GameSeat, number>>;
  /** Stones counted as dead at scoring; empty for a resignation */
  readonly dead: number[];
  /** Stones plus territory per seat; empty for a resignation */
  readonly area: Partial<Record<GameSeat, number>>;
  readonly komi: number;
  /** Points between the winner's total and the loser's, komi included; 0 for a resignation */
  readonly margin: number;
}

export interface GoGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'go';
  readonly id: string;
  readonly startedAt: number;
  /** The two seats playing; the first in seat order plays black */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  readonly options: GoOptions;
  phase: GoPhase;
  /** Row-major intersections, `row * size + col`; 0 is black, 1 white */
  stones: GoCell[];
  /** Opponent stones captured by black and by white */
  captures: [number, number];
  /** Passes in a row at the end of the log; two start marking */
  passes: number;
  /** Log lengths at which marking was abandoned and play resumed */
  resumes: number[];
  /** Seat to move, or who moves first after a resume while marking */
  currentTurnSeat: GameSeat;
  /** Both seats agree on the dead stones against this shared deadline; 0 outside marking */
  markDeadline: number;
  /** Intersections of the stones marked dead, sorted; empty outside marking */
  dead: number[];
  /** Seats that accepted the current marking */
  confirmed: GameSeat[];
  drawOffer: DrawOfferState;
  log: GoMoveRecord[];
  result: GoMatchResult | null;
}

/** Go has no hidden information: every seat and spectator sees the whole state. */
export interface GoVisibleState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly observer?: ObserverRole;
  readonly gameType: 'go';
  readonly phase: GoPhase;
  readonly mySeat: GameSeat;
  /** The two seats in play order */
  readonly seats: readonly GameSeat[];
  readonly options: GoOptions;
  readonly stones: readonly GoCell[];
  readonly captures: readonly [number, number];
  readonly passes: number;
  readonly resumes: readonly number[];
  readonly currentTurnSeat: GameSeat;
  readonly markDeadline: number;
  readonly dead: readonly number[];
  readonly confirmed: readonly GameSeat[];
  readonly drawOffer: DrawOfferState;
  readonly log: readonly GoMoveRecord[];
  readonly result: GoMatchResult | null;
}

export interface GoGameContract {
  readonly state: GoGameState;
  readonly visible: GoVisibleState;
  readonly result: GoMatchResult;
  readonly options: GoOptions;
}
