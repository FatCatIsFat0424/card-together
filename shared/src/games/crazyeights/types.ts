import type { Card, GameClock, GamePresentation, ObserverView, Suit } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

export interface CrazyEightsOptions {
  /** 2 = next player draws 2, Q = skip the next player, A = reverse direction */
  readonly actionCards: boolean;
}

export type CrazyEightsDirection = 'ccw' | 'cw';

/** What an action card did to the table */
export type CrazyEightsEffect = 'skip' | 'reverse' | 'draw';

/**
 * hand = a hand was dealt and `starter` turned up; play = a card played (`suit` is the declared suit of an 8);
 * draw = one card drawn from the stock; pass = the turn passed without a play;
 * handEnd = `winner` emptied their hand and every seat's remaining-card `points` were added to its total.
 */
export type CrazyEightsLogEntry =
  | {
    readonly type: 'hand';
    readonly hand: number;
    readonly first: GameSeat;
    readonly starter: Card;
    readonly timestamp: number;
  }
  | {
    readonly type: 'play';
    readonly seat: GameSeat;
    readonly card: Card;
    readonly suit: Suit | null;
    readonly effect: CrazyEightsEffect | null;
    /** Seat the effect skipped or penalised */
    readonly target: GameSeat | null;
    /** Cards the penalised seat drew */
    readonly drawn: number;
    readonly timestamp: number;
  }
  | { readonly type: 'draw'; readonly seat: GameSeat; readonly timestamp: number }
  | { readonly type: 'pass'; readonly seat: GameSeat; readonly timestamp: number }
  | {
    readonly type: 'handEnd';
    readonly hand: number;
    readonly winner: GameSeat;
    readonly points: Record<GameSeat, number>;
    readonly timestamp: number;
  };

/** Lowest total of remaining-card points wins; seats on the same total tie. */
export interface CrazyEightsMatchResult {
  readonly seats?: GameSeat[];
  readonly gameType: 'crazyeights';
  readonly scores: Record<GameSeat, number>;
  readonly winners: GameSeat[];
  /** Hands played, equal to the match length */
  readonly hands: number;
  /** Who emptied their hand in each hand */
  readonly handWinners: GameSeat[];
}

export type CrazyEightsPhase = 'playing' | 'scoring';

export interface CrazyEightsGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  readonly options: CrazyEightsOptions;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'crazyeights';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: CrazyEightsPhase;
  /** 1-based number of the hand in play */
  hand: number;
  /**
   * Cards are plain suit/rank values; a two-deck game holds two interchangeable copies of each, and every
   * move removes exactly one copy.
   */
  hands: Record<GameSeat, Card[]>;
  /** Server only; stock[0] is the top of the pile */
  stock: Card[];
  /** The last card is the most recently played */
  discard: Card[];
  /** Suit the next card must match unless it is an 8 or shares the top rank */
  activeSuit: Suit;
  direction: CrazyEightsDirection;
  currentTurnSeat: GameSeat;
  /** The current seat already drew this turn, so it may play or pass */
  drawn: boolean;
  /** Remaining-card points added over finished hands; lower is better */
  scores: Record<GameSeat, number>;
  log: CrazyEightsLogEntry[];
  result: CrazyEightsMatchResult | null;
}

export interface CrazyEightsVisibleState extends ObserverView<Card> {
  /** Occupied seats in seat order */
  readonly seats: readonly GameSeat[];
  readonly options: CrazyEightsOptions;
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'crazyeights';
  readonly phase: CrazyEightsPhase;
  readonly mySeat: GameSeat;
  readonly myHand: readonly Card[];
  readonly handCounts: Record<GameSeat, number>;
  readonly hand: number;
  readonly scores: Record<GameSeat, number>;
  readonly direction: CrazyEightsDirection;
  readonly currentTurnSeat: GameSeat;
  readonly drawn: boolean;
  readonly lastPlayed: Card | null;
  readonly activeSuit: Suit;
  readonly stockCount: number;
  /** Cards below the top discard, which refill an empty stock */
  readonly reserveCount: number;
  readonly log: readonly CrazyEightsLogEntry[];
  readonly result: CrazyEightsMatchResult | null;
}

export interface CrazyEightsGameContract {
  readonly state: CrazyEightsGameState;
  readonly visible: CrazyEightsVisibleState;
  readonly result: CrazyEightsMatchResult;
  readonly options: CrazyEightsOptions;
}
