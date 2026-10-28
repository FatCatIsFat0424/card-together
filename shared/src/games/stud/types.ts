import type { Card, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { HoldemAction, HoldemPot } from '../holdem/types';

/** Cards each seat holds when the street's betting opens: 2 (hole plus first up card) through 5. */
export type StudStreet = 2 | 3 | 4 | 5;

/** Betting uses the Hold'em contract: `raise` sets this street's total stake to `to`. */
export type StudAction = HoldemAction;

export type StudPot = HoldemPot;

type SeatCards = Record<GameSeat, Card[]>;

/** The hole card never enters the log until a showdown reveals it. */
export type StudLogEntry =
  | {
    readonly type: 'hand';
    readonly hand: number;
    readonly button: GameSeat;
    readonly ante: number;
    readonly minBet: number;
    /** Chips each seat posted as an ante; a short stack posts all it has */
    readonly antes: Record<GameSeat, number>;
    readonly timestamp: number;
  }
  /** One face-up card per unfolded seat (empty for the rest); street 2 deals the first up card. */
  | { readonly type: 'street'; readonly street: StudStreet; readonly cards: SeatCards; readonly timestamp: number }
  | {
    readonly type: 'action';
    readonly seat: GameSeat;
    readonly action: 'fold' | 'check' | 'call' | 'bet' | 'raise';
    /** The seat's total stake on this street after the action */
    readonly to: number;
    readonly allIn: boolean;
    readonly timestamp: number;
  }
  /** Hole card of every unfolded seat; empty for the rest */
  | { readonly type: 'showdown'; readonly cards: SeatCards; readonly timestamp: number }
  | {
    readonly type: 'award';
    readonly pots: StudPot[];
    readonly chips: Record<GameSeat, number>;
    /** Seats that lost their last chip this hand, in elimination order */
    readonly eliminated: GameSeat[];
    readonly timestamp: number;
  };

export interface StudMatchResult {
  readonly gameType: 'stud';
  /** Seats that took part, ordered by seat number */
  readonly seats?: GameSeat[];
  /** 0 for empty seats */
  readonly chips: Record<GameSeat, number>;
  readonly hands: number;
  /** Most chips (ties included) */
  readonly winners: GameSeat[];
  /** Seats that lost every chip, in elimination order */
  readonly eliminationOrder: GameSeat[];
}

export type StudPhase = 'playing' | 'scoring';

export interface StudGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'stud';
  readonly id: string;
  readonly startedAt: number;
  /** Missing for empty seats, which hold no chips and are never dealt in */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: StudPhase;
  hand: number;
  /** Only decides who gets odd chips when a pot splits */
  button: GameSeat;
  ante: number;
  /** Smallest opening bet, and the smallest raise increment on a fresh street */
  minBet: number;
  /** Chips not yet staked this hand */
  chips: Record<GameSeat, number>;
  streetBets: Record<GameSeat, number>;
  /** Chips staked this hand, including antes and this street */
  totalBets: Record<GameSeat, number>;
  /** Seats dealt into this hand, ordered by seat number */
  dealt: GameSeat[];
  folded: GameSeat[];
  street: StudStreet;
  /** Face-up cards each seat holds, in deal order */
  up: Record<GameSeat, Card[]>;
  currentBet: number;
  minRaise: number;
  acted: GameSeat[];
  /** Hole cards a showdown revealed this hand */
  revealed: Record<GameSeat, Card[]>;
  eliminated: GameSeat[];
  currentTurnSeat: GameSeat;
  /** Server only */
  deck: Card[];
  /** Server only; each seat's hole card */
  hands: Record<GameSeat, Card[]>;
  log: StudLogEntry[];
  result: StudMatchResult | null;
}

export interface StudVisibleState extends ObserverView<Card> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'stud';
  readonly phase: StudPhase;
  readonly mySeat: GameSeat;
  /** Seats taking part, ordered by seat number */
  readonly seats: readonly GameSeat[];
  /** The viewer's own hole card; empty when not dealt in */
  readonly myHand: readonly Card[];
  readonly hand: number;
  readonly button: GameSeat;
  readonly ante: number;
  readonly minBet: number;
  readonly chips: Record<GameSeat, number>;
  readonly streetBets: Record<GameSeat, number>;
  readonly totalBets: Record<GameSeat, number>;
  readonly dealt: readonly GameSeat[];
  readonly folded: readonly GameSeat[];
  readonly street: StudStreet;
  readonly up: Record<GameSeat, readonly Card[]>;
  readonly currentBet: number;
  readonly minRaise: number;
  readonly acted: readonly GameSeat[];
  readonly revealed: Record<GameSeat, readonly Card[]>;
  readonly eliminated: readonly GameSeat[];
  readonly currentTurnSeat: GameSeat;
  readonly log: readonly StudLogEntry[];
  readonly result: StudMatchResult | null;
}

export interface StudGameContract {
  readonly state: StudGameState;
  readonly visible: StudVisibleState;
  readonly result: StudMatchResult;
  readonly options: Record<string, never>;
}
