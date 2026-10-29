import type { GameClock, GamePresentation, ObserverRole } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { NodeId } from '../../rules/board/board-model';
import type { BoardMoveRecord } from '../../rules/board/board-move';
import type { BoardOutcome } from '../../rules/board/board-result';
import type { DrawOfferState } from '../../rules/board/match-controls';
import type { XqCell, XqHandicap, XqHandicapSide, XqLine, XqPiece } from '../../rules/xiangqi';

/** Room rules: 讓子, the pieces one colour starts without. */
export interface XiangqiOptions {
  readonly handicap: XqHandicap;
  /** Colour that gives the handicap; ignored without one */
  readonly handicapSide: XqHandicapSide;
}

/** One public move; nothing in Xiangqi is hidden. */
export interface XiangqiMove extends BoardMoveRecord {
  readonly seat: GameSeat;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly piece: XqPiece;
  /** The piece taken, when the move captured */
  readonly captured?: XqPiece;
  readonly capture?: boolean;
  /** The move put the opposing general in check */
  readonly check?: boolean;
  /** Identical own pieces on the same file, for 前／後 and WXF tandem notation */
  readonly line?: XqLine;
  readonly timestamp: number;
}

export type XiangqiPhase = 'playing' | 'scoring';

export interface XiangqiMatchResult extends BoardOutcome {
  readonly gameType: 'xiangqi';
  /** The two seats in play order: red first */
  readonly seats: GameSeat[];
  /** Plies played */
  readonly moves: number;
}

export interface XiangqiGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'xiangqi';
  readonly id: string;
  readonly startedAt: number;
  /** The two seats playing; the first in seat order plays red */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  readonly options: XiangqiOptions;
  phase: XiangqiPhase;
  /** Row-major points, `row * 9 + col`, black's back rank first */
  board: XqCell[];
  currentTurnSeat: GameSeat;
  drawOffer: DrawOfferState;
  log: XiangqiMove[];
  result: XiangqiMatchResult | null;
}

/** Xiangqi has no hidden information: every seat and spectator sees the whole state. */
export interface XiangqiVisibleState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly observer?: ObserverRole;
  readonly gameType: 'xiangqi';
  readonly phase: XiangqiPhase;
  readonly mySeat: GameSeat;
  /** The two seats in play order: red first */
  readonly seats: readonly GameSeat[];
  readonly options: XiangqiOptions;
  readonly board: readonly XqCell[];
  readonly currentTurnSeat: GameSeat;
  readonly drawOffer: DrawOfferState;
  readonly log: readonly XiangqiMove[];
  readonly result: XiangqiMatchResult | null;
}

export interface XiangqiGameContract {
  readonly state: XiangqiGameState;
  readonly visible: XiangqiVisibleState;
  readonly result: XiangqiMatchResult;
  readonly options: XiangqiOptions;
}
