import type { GameClock, GamePresentation, ObserverRole } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { NodeId } from '../../rules/board/board-model';
import type { BoardMoveRecord } from '../../rules/board/board-move';
import type { BoardOutcome } from '../../rules/board/board-result';
import type { DrawOfferState } from '../../rules/board/match-controls';
import type { BqBoard, BqColour, BqPiece, BqSlot } from '../../rules/banqi';

/** The two optional variants a room can switch on; both default to off. */
export interface BanqiOptions {
  /** 連吃: after a capture the same piece may keep capturing within the turn */
  readonly chain: boolean;
  /** 車衝: the chariot moves and captures at any distance along a line */
  readonly rookDash: boolean;
}

/**
 * One public action. A flip names the cell and the piece it revealed (face up for everyone from then on);
 * a move names both cells, the moving piece, and the piece it captured. Pieces still face down never appear.
 */
export interface BanqiMove extends BoardMoveRecord {
  readonly seat: GameSeat;
  readonly from?: NodeId;
  readonly to: NodeId;
  /** Revealed by a flip; absent for moves */
  readonly revealed?: BqPiece;
  /** The piece that moved; absent for flips */
  readonly piece?: BqPiece;
  /** The piece taken, face up at the time; absent unless the move captured */
  readonly captured?: BqPiece;
  /** A further capture by the same piece within one turn (連吃) */
  readonly chain?: true;
  readonly timestamp: number;
}

export type BanqiPhase = 'playing' | 'scoring';

/** Both seats play to the end, so the result lists them with the pieces each still had. */
export interface BanqiMatchResult extends BoardOutcome {
  readonly gameType: 'banqi';
  /** The two seats in play order: the first mover first */
  readonly seats: GameSeat[];
  /** Pieces of each seat's colour left on the board, face-down ones included; empty before colours are set */
  readonly remaining: Partial<Record<GameSeat, number>>;
  /** Actions taken: flips, moves, and captures */
  readonly moves: number;
}

export interface BanqiGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'banqi';
  readonly id: string;
  readonly startedAt: number;
  readonly options: BanqiOptions;
  /** The two seats playing; the first in seat order moves first */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: BanqiPhase;
  /** Public cells, row-major: empty, face down, or the face-up piece */
  board: BqSlot[];
  /** Server-only: the piece under each face-down cell, -1 elsewhere. Never sent to a seated player. */
  hidden: number[];
  /** Colour of each seat in play order; null until the first flip decides it */
  colours: [BqColour, BqColour] | null;
  currentTurnSeat: GameSeat;
  /** Cell of the piece that just captured and may capture again; null outside a chain */
  chain: NodeId | null;
  /** Moves in a row without a flip or capture */
  quietMoves: number;
  drawOffer: DrawOfferState;
  log: BanqiMove[];
  result: BanqiMatchResult | null;
}

/**
 * What a seat sees: the public cells only. Face-down cells carry no identity, so a seated player learns a
 * piece exactly when it is flipped. `observedPieces` is added for unseated spectators alone.
 */
export interface BanqiVisibleState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly observer?: ObserverRole;
  readonly gameType: 'banqi';
  readonly phase: BanqiPhase;
  readonly mySeat: GameSeat;
  /** The two seats in play order: the first mover first */
  readonly seats: readonly GameSeat[];
  readonly options: BanqiOptions;
  readonly board: BqBoard;
  readonly colours: readonly [BqColour, BqColour] | null;
  readonly currentTurnSeat: GameSeat;
  readonly chain: NodeId | null;
  readonly quietMoves: number;
  readonly drawOffer: DrawOfferState;
  readonly log: readonly BanqiMove[];
  readonly result: BanqiMatchResult | null;
  /** God view: the piece under each face-down cell, for spectators who are not seated */
  readonly observedPieces?: Readonly<Record<NodeId, BqPiece>>;
}

export interface BanqiGameContract {
  readonly state: BanqiGameState;
  readonly visible: BanqiVisibleState;
  readonly result: BanqiMatchResult;
  readonly options: BanqiOptions;
}
