import type { Card, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { PlayerInfo, Seat } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { BigTwoComboType } from '../../rules/bigtwo';

export interface BigTwoPlay {
  readonly seat: Seat;
  readonly cards: Card[];
  readonly comboType: BigTwoComboType;
}

export type BigTwoLogEntry =
  | { readonly type: 'play'; readonly seat: Seat; readonly cards: Card[]; readonly comboType: BigTwoComboType; readonly timestamp: number }
  | { readonly type: 'pass'; readonly seat: Seat; readonly timestamp: number }
  | { readonly type: 'round_end'; readonly leaderSeat: Seat; readonly timestamp: number }
  | { readonly type: 'dragon'; readonly seat: Seat; readonly timestamp: number };

export interface BigTwoMatchResult {
  readonly gameType: 'bigtwo';
  readonly winnerSeat: Seat;
  readonly dragon: boolean;
  readonly cardsLeft: Record<Seat, number>;
  readonly twosLeft: Record<Seat, number>;
  /** The winner has 0 */
  readonly scores: Record<Seat, number>;
}

export type BigTwoPhase = 'playing' | 'scoring';

export interface BigTwoGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  /** Private persisted deadline; never included in player-visible state. */
  pendingAutoPass?: { readonly id: string; readonly seat: Seat; readonly executeAt: number };
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: Seat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'bigtwo';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: BigTwoPhase;
  hands: Record<Seat, Card[]>;
  currentTurnSeat: Seat;
  /** null = free lead */
  lastPlay: BigTwoPlay | null;
  lockedSeats: Seat[];
  /** The opening play must still include ♣3 */
  firstPlay: boolean;
  log: BigTwoLogEntry[];
  result: BigTwoMatchResult | null;
}

export interface BigTwoVisibleState extends ObserverView<Card> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'bigtwo';
  readonly phase: BigTwoPhase;
  readonly mySeat: Seat;
  readonly myHand: readonly Card[];
  readonly handCounts: Record<Seat, number>;
  readonly currentTurnSeat: Seat;
  readonly lastPlay: BigTwoPlay | null;
  readonly lockedSeats: readonly Seat[];
  readonly firstPlay: boolean;
  readonly log: readonly BigTwoLogEntry[];
  readonly result: BigTwoMatchResult | null;
  /** All hands are revealed at settlement */
  readonly revealedHands: Record<Seat, Card[]> | null;
}

export interface BigTwoGameContract {
  readonly state: BigTwoGameState;
  readonly visible: BigTwoVisibleState;
  readonly result: BigTwoMatchResult;
  readonly options: Record<string, never>;
}
