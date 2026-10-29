import type { GameClock, GamePresentation, ObserverRole } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { NodeId } from '../../rules/board/board-model';
import type { BoardMoveRecord } from '../../rules/board/board-move';
import type { BoardOutcome } from '../../rules/board/board-result';
import type { DrawOfferState } from '../../rules/board/match-controls';
import type { BattleshipOptions, BsFleet, BsShip, BsShotOutcome } from '../../rules/battleship';

/**
 * One public shot at the opponent's sea. A hit never says which ship it struck; a sinking names the ship and
 * its cells, which both seats and every replay may see.
 */
export interface BattleshipShot extends BoardMoveRecord {
  readonly seat: GameSeat;
  readonly to: NodeId;
  readonly result: BsShotOutcome;
  /** The ship that sank */
  readonly ship?: BsShip;
  /** Cells of the sunk ship, bow first */
  readonly sunkCells?: readonly NodeId[];
  readonly timestamp: number;
}

export type BattleshipPhase = 'placing' | 'playing' | 'scoring';

export interface BattleshipMatchResult extends BoardOutcome {
  readonly gameType: 'battleship';
  /** The two seats in play order: the first shoots first */
  readonly seats: GameSeat[];
  /** Shots each seat fired */
  readonly shots: Partial<Record<GameSeat, number>>;
  /** Shots each seat landed on a ship */
  readonly hits: Partial<Record<GameSeat, number>>;
  /** Enemy ships each seat sank */
  readonly sunk: Partial<Record<GameSeat, number>>;
}

export interface BattleshipGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'battleship';
  readonly id: string;
  readonly startedAt: number;
  /** The two seats playing; the first in seat order shoots first */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  readonly options: BattleshipOptions;
  phase: BattleshipPhase;
  /** Both seats place their fleets against this shared deadline; a missing fleet is placed automatically */
  readonly placeDeadline: number;
  /** Submitted fleets; null until the seat submits */
  fleets: Partial<Record<GameSeat, BsFleet | null>>;
  /** Human seats whose fleet the server placed at the deadline */
  autoPlaced: GameSeat[];
  currentTurnSeat: GameSeat;
  drawOffer: DrawOfferState;
  log: BattleshipShot[];
  result: BattleshipMatchResult | null;
}

export interface BattleshipVisibleState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly observer?: ObserverRole;
  readonly gameType: 'battleship';
  readonly phase: BattleshipPhase;
  readonly mySeat: GameSeat;
  /** The two seats in play order */
  readonly seats: readonly GameSeat[];
  readonly options: BattleshipOptions;
  readonly placeDeadline: number;
  /** Seats that have submitted their fleet */
  readonly placed: readonly GameSeat[];
  readonly autoPlaced: readonly GameSeat[];
  /**
   * Fleets the recipient may see: its own once submitted, every fleet once the match is over, and every fleet
   * for unseated spectators. An opponent's fleet is otherwise never sent.
   */
  readonly fleets: Partial<Record<GameSeat, BsFleet>>;
  readonly currentTurnSeat: GameSeat;
  readonly drawOffer: DrawOfferState;
  readonly log: readonly BattleshipShot[];
  readonly result: BattleshipMatchResult | null;
}

export interface BattleshipGameContract {
  readonly state: BattleshipGameState;
  readonly visible: BattleshipVisibleState;
  readonly result: BattleshipMatchResult;
  readonly options: BattleshipOptions;
}
