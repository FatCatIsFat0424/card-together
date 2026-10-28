import type { Card, Suit, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { PlayerInfo, Seat } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

/** Presentation shown when Dragon Slaying closes a row: a dragon cut down along it, or the fire alone. */
export type SevensSlayEffect = 'dragon' | 'fire';

export interface SevensOptions {
  readonly closeOnEnd: boolean;
  /** Missing means the dragon */
  readonly slayEffect?: SevensSlayEffect;
}

export type SevensPhase = 'playing' | 'scoring';

/** Lowest and highest played order per suit (A=1 … K=13); null until that suit's 7 is played. */
export type SevensTable = Record<Suit, { readonly low: number; readonly high: number } | null>;

/**
 * A cover entry never names the card; other playing seats cannot read it before settlement. `auto` marks the
 * covers the server makes at once after Dragon Slaying has closed all four suits and no card can be played.
 */
export type SevensLogEntry =
  | { readonly type: 'play'; readonly seat: Seat; readonly card: Card; readonly timestamp: number }
  | { readonly type: 'cover'; readonly seat: Seat; readonly timestamp: number; readonly auto?: true };

export interface SevensMatchResult {
  readonly gameType: 'sevens';
  /** Sum of covered cards, A=1 … K=13 */
  readonly penalties: Record<Seat, number>;
  readonly covered: Record<Seat, Card[]>;
  /** Lowest penalties (ties included), ordered N, E, S, W */
  readonly winners: Seat[];
}

export interface SevensGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  /** Missing on legacy snapshots; defaults to standard Sevens rules. */
  readonly options?: SevensOptions;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: Seat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'sevens';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: SevensPhase;
  hands: Record<Seat, Card[]>;
  table: SevensTable;
  /** Visible only to the owner and spectators until settlement */
  covered: Record<Seat, Card[]>;
  currentTurnSeat: Seat;
  log: SevensLogEntry[];
  result: SevensMatchResult | null;
}

export interface SevensVisibleState extends ObserverView<Card> {
  readonly options?: SevensOptions;
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'sevens';
  readonly phase: SevensPhase;
  readonly mySeat: Seat;
  readonly myHand: readonly Card[];
  readonly myCovered: readonly Card[];
  /** Every seat's covered cards, added only to spectator snapshots */
  readonly observedCovered?: Record<Seat, readonly Card[]>;
  readonly handCounts: Record<Seat, number>;
  readonly coveredCounts: Record<Seat, number>;
  readonly table: SevensTable;
  /** Cards the player may play now; empty means the player must cover */
  readonly validCards: readonly Card[];
  readonly currentTurnSeat: Seat;
  readonly log: readonly SevensLogEntry[];
  readonly result: SevensMatchResult | null;
}

export interface SevensGameContract {
  readonly state: SevensGameState;
  readonly visible: SevensVisibleState;
  readonly result: SevensMatchResult;
  readonly options: SevensOptions;
}
