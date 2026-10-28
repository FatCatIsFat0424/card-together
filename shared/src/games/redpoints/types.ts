import type { Card, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { PlayerInfo, Seat } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

/** play = from hand, flip = from the stock; captured lists table cards taken, null means the card stays on the table */
export interface RedPointsLogEntry {
  readonly type: 'play' | 'flip';
  readonly seat: Seat;
  readonly card: Card;
  readonly captured: Card | null;
  readonly timestamp: number;
}

export interface RedPointsMatchResult {
  readonly gameType: 'redpoints';
  readonly points: Record<Seat, number>;
  /** Highest scorers (ties included), ordered N, E, S, W */
  readonly winners: Seat[];
}

export type RedPointsPhase = 'playing' | 'scoring';

/** play = waiting for a play; flip-choose = the flipped card matches several table cards, waiting for a choice */
export type RedPointsStep = 'play' | 'flip-choose';

export interface RedPointsGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: Seat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'redpoints';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: RedPointsPhase;
  hands: Record<Seat, Card[]>;
  table: Card[];
  /** Server only; stock[0] is the top of the pile */
  stock: Card[];
  captured: Record<Seat, Card[]>;
  currentTurnSeat: Seat;
  step: RedPointsStep;
  pendingFlip: Card | null;
  log: RedPointsLogEntry[];
  result: RedPointsMatchResult | null;
}

export interface RedPointsVisibleState extends ObserverView<Card> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'redpoints';
  readonly phase: RedPointsPhase;
  readonly mySeat: Seat;
  readonly myHand: readonly Card[];
  readonly handCounts: Record<Seat, number>;
  readonly table: readonly Card[];
  readonly stockCount: number;
  readonly captured: Record<Seat, Card[]>;
  readonly currentTurnSeat: Seat;
  readonly step: RedPointsStep;
  readonly pendingFlip: Card | null;
  readonly log: readonly RedPointsLogEntry[];
  readonly result: RedPointsMatchResult | null;
}

export interface RedPointsGameContract {
  readonly state: RedPointsGameState;
  readonly visible: RedPointsVisibleState;
  readonly result: RedPointsMatchResult;
  readonly options: Record<string, never>;
}
