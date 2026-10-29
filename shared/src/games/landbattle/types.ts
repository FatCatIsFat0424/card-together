import type { GameClock, GamePresentation, ObserverRole } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { NodeId } from '../../rules/board/board-model';
import type { BoardMoveRecord } from '../../rules/board/board-move';
import type { BoardOutcome } from '../../rules/board/board-result';
import type { DrawOfferState } from '../../rules/board/match-controls';
import type { LbRank, LbSide } from '../../rules/landbattle';

/**
 * One public move. The record names the stations and the public battle outcome only, never an identity:
 * every seat and replay sees it.
 */
export interface LandBattleMove extends BoardMoveRecord {
  readonly seat: GameSeat;
  readonly from: NodeId;
  readonly to: NodeId;
  /** Railway stations passed through, when the move ran more than one step */
  readonly path?: readonly NodeId[];
  /** The move attacked a piece */
  readonly capture?: boolean;
  /** The attacker's battle outcome: it won, lost, or both pieces were removed */
  readonly battle?: 'win' | 'lose' | 'tie';
  /** Seats whose marshal fell in this battle, so their flag is now shown */
  readonly flagShown?: readonly GameSeat[];
  readonly timestamp: number;
}

export type LandBattlePhase = 'deploying' | 'playing' | 'scoring';

/** A piece on the board; `origin` is the station it was deployed on, which every seat saw. */
export interface LandBattleStoredPiece {
  readonly side: LbSide;
  readonly rank: LbRank;
  readonly origin: NodeId;
  readonly node: NodeId;
}

export interface LandBattleMatchResult extends BoardOutcome {
  readonly gameType: 'landbattle';
  /** The two seats in play order: the first moves first and deploys at the bottom */
  readonly seats: GameSeat[];
  /** Pieces each seat still had on the board when the match ended */
  readonly remaining: Partial<Record<GameSeat, number>>;
  /** Moves made after deployment */
  readonly moves: number;
}

export interface LandBattleGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'landbattle';
  readonly id: string;
  readonly startedAt: number;
  /** The two seats playing; the first in seat order deploys at the bottom and moves first */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: LandBattlePhase;
  /** Both seats deploy against this shared deadline; a missing deployment is made automatically */
  readonly deployDeadline: number;
  /** Submitted deployments in slot order (`LB_SLOT_POSITIONS`); null until the seat submits */
  layouts: Partial<Record<GameSeat, LbRank[] | null>>;
  /** Human seats whose deployment the server made at the deadline */
  autoDeployed: GameSeat[];
  /** Pieces still on the board, in deployment order; empty while deploying */
  pieces: LandBattleStoredPiece[];
  currentTurnSeat: GameSeat;
  drawOffer: DrawOfferState;
  /** Moves since the last battle */
  quietMoves: number;
  /** Seats whose marshal has fallen, so their flag is shown to everyone */
  flagsShown: GameSeat[];
  log: LandBattleMove[];
  result: LandBattleMatchResult | null;
}

/** A piece as one recipient sees it. */
export interface LandBattleVisiblePiece {
  readonly side: LbSide;
  readonly node: NodeId;
  readonly origin: NodeId;
  /**
   * Own pieces, a shown flag, every piece once the match is over, and every piece for unseated spectators;
   * absent otherwise.
   */
  readonly rank?: LbRank;
}

export interface LandBattleVisibleState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly observer?: ObserverRole;
  readonly gameType: 'landbattle';
  readonly phase: LandBattlePhase;
  readonly mySeat: GameSeat;
  /** The two seats in play order */
  readonly seats: readonly GameSeat[];
  readonly deployDeadline: number;
  /** Seats that have submitted their deployment */
  readonly deployed: readonly GameSeat[];
  readonly autoDeployed: readonly GameSeat[];
  /** The viewer's own submitted deployment in slot order, or null */
  readonly myLayout: readonly LbRank[] | null;
  /** While deploying, the submitted deployments; afterwards the pieces still on the board */
  readonly pieces: readonly LandBattleVisiblePiece[];
  readonly flagsShown: readonly GameSeat[];
  readonly currentTurnSeat: GameSeat;
  readonly drawOffer: DrawOfferState;
  readonly quietMoves: number;
  readonly log: readonly LandBattleMove[];
  readonly result: LandBattleMatchResult | null;
}

export interface LandBattleGameContract {
  readonly state: LandBattleGameState;
  readonly visible: LandBattleVisibleState;
  readonly result: LandBattleMatchResult;
  readonly options: Record<string, never>;
}
