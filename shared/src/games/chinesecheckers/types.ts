import type { GameClock, GamePresentation, ObserverRole } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { NodeId } from '../../rules/board/board-model';
import type { BoardMoveRecord } from '../../rules/board/board-move';
import type { BoardOutcome } from '../../rules/board/board-result';
import type { DrawOfferState } from '../../rules/board/match-controls';
import type { CcHole } from '../../rules/chinesecheckers';

/**
 * One public log entry. A move names its start, end, and the landings of a jump chain in between; a pass
 * (every marble of the seat was blocked, recorded automatically) has no `from` or `to`; a resignation in a
 * match of three or more players has `resigned` and takes the seat's marbles off the board.
 */
export interface ChineseCheckersMove extends BoardMoveRecord {
  readonly seat: GameSeat;
  readonly from?: NodeId;
  readonly to?: NodeId;
  /** Landings between `from` and `to`, present only for chains of two or more jumps */
  readonly path?: readonly NodeId[];
  /** The move jumped at least once */
  readonly jump?: true;
  readonly resigned?: true;
  readonly timestamp: number;
}

export type ChineseCheckersPhase = 'playing' | 'scoring';

/** Every seat of the match with its corner, progress, and place when play stopped. */
export interface ChineseCheckersMatchResult extends BoardOutcome {
  readonly gameType: 'chinesecheckers';
  /** The seats in play order; the first starts at the bottom corner and moves first */
  readonly seats: GameSeat[];
  /** Home corner of each seat, as an index into `STAR_CORNERS` */
  readonly corners: Partial<Record<GameSeat, number>>;
  /** Rows each seat's marbles still had to travel (`ccRemaining`); absent for seats that resigned a multi-player match */
  readonly remaining: Partial<Record<GameSeat, number>>;
  /** Marbles each seat had in its target triangle; absent like `remaining` */
  readonly arrived: Partial<Record<GameSeat, number>>;
  /** Places, 1 first; equal progress shares a place and resigned seats fill the last places */
  readonly ranks: Partial<Record<GameSeat, number>>;
  /** Moves made; passes and resignations are not counted */
  readonly moves: number;
}

export interface ChineseCheckersGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'chinesecheckers';
  readonly id: string;
  readonly startedAt: number;
  /** The seats playing, in play order */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: ChineseCheckersPhase;
  /** The 121 holes in `starBoard()` node order */
  holes: CcHole[];
  currentTurnSeat: GameSeat;
  drawOffer: DrawOfferState;
  /** Seats that resigned a match of three or more, earliest first; they no longer take turns */
  resigned: GameSeat[];
  log: ChineseCheckersMove[];
  result: ChineseCheckersMatchResult | null;
}

/** Chinese checkers has no hidden information: every seat and spectator sees the whole state. */
export interface ChineseCheckersVisibleState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly observer?: ObserverRole;
  readonly gameType: 'chinesecheckers';
  readonly phase: ChineseCheckersPhase;
  readonly mySeat: GameSeat;
  /** The seats in play order */
  readonly seats: readonly GameSeat[];
  /** Home corner per seat, in `seats` order */
  readonly corners: readonly number[];
  readonly holes: readonly CcHole[];
  readonly currentTurnSeat: GameSeat;
  readonly drawOffer: DrawOfferState;
  readonly resigned: readonly GameSeat[];
  readonly log: readonly ChineseCheckersMove[];
  readonly result: ChineseCheckersMatchResult | null;
}

export interface ChineseCheckersGameContract {
  readonly state: ChineseCheckersGameState;
  readonly visible: ChineseCheckersVisibleState;
  readonly result: ChineseCheckersMatchResult;
  readonly options: Record<string, never>;
}
