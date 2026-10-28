import type { Card, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

/** A ten-and-a-half hand: special hands outrank every ordinary total. */
export type TenHalfHandKind = 'bust' | 'points' | 'tenhalf' | 'fivesmall' | 'tianwang' | 'renwuxiao';

export type TenHalfAction = 'hit' | 'stand';

/** A tie goes to the banker, so a player either beats the banker or loses; a bust loses first. */
export type TenHalfOutcome = 'win' | 'lose' | 'bust';

/**
 * Bets stay hidden until the deal. Hole cards never enter the log until the showdown reveals them;
 * a hit records only whether it ended the drawer's hand, which turn passing makes public anyway.
 */
export type TenHalfLogEntry =
  | { readonly type: 'bet'; readonly seat: GameSeat; readonly auto: boolean; readonly timestamp: number }
  | {
    readonly type: 'deal';
    readonly hand: number;
    readonly banker: GameSeat;
    /** 0 for the banker and seats sitting out */
    readonly bets: Record<GameSeat, number>;
    readonly timestamp: number;
  }
  | {
    readonly type: 'hit';
    readonly seat: GameSeat;
    /** Drawn face up */
    readonly card: Card;
    /** The draw ended the hand: a bust, exactly 10.5, or the fifth card */
    readonly done: boolean;
    readonly timestamp: number;
  }
  | { readonly type: 'stand'; readonly seat: GameSeat; readonly timestamp: number }
  /** Every dealt seat's hole card; null for the rest */
  | { readonly type: 'showdown'; readonly hand: number; readonly holes: Record<GameSeat, Card | null>; readonly timestamp: number }
  | {
    readonly type: 'settle';
    readonly hand: number;
    /** Null for the banker and seats sitting out */
    readonly outcomes: Record<GameSeat, TenHalfOutcome | null>;
    /** Chips after the hand minus chips before it, the stake included */
    readonly net: Record<GameSeat, number>;
    readonly chips: Record<GameSeat, number>;
    readonly timestamp: number;
  };

export interface TenHalfMatchResult {
  readonly gameType: 'tenhalf';
  /** Seats that took part, ordered N, E, S, W */
  readonly seats: GameSeat[];
  /** 0 for empty seats */
  readonly chips: Record<GameSeat, number>;
  readonly hands: number;
  /** Most chips (ties included) among the seats that took part, ordered N, E, S, W */
  readonly winners: GameSeat[];
}

export type TenHalfPhase = 'betting' | 'playing' | 'scoring';

export interface TenHalfGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'tenhalf';
  readonly id: string;
  readonly startedAt: number;
  /** Missing for empty seats, which never bet, act, or appear in results */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: TenHalfPhase;
  /** Hands dealt so far; betting is for hand `hand + 1` */
  hand: number;
  /** The banker of the hand being played, or while betting the next one */
  banker: GameSeat;
  /** Chips not staked on the table */
  chips: Record<GameSeat, number>;
  /** Server only while betting; null until the seat bets or when it sits out or banks */
  pendingBets: Record<GameSeat, number | null>;
  /** Chips staked on the hand being played, kept on the table after settling */
  bets: Record<GameSeat, number>;
  /** Chips each seat held before the hand's stakes */
  stacks: Record<GameSeat, number>;
  /** Length of the shared betting window */
  readonly betMs: number;
  /** Null until the previous hand's presentation ends and betting opens */
  betDeadline: number | null;
  /** Server only; the undealt part of this hand's shuffled deck */
  deck: Card[];
  /** Seats dealt into the latest hand (banker included), ordered N, E, S, W */
  dealt: GameSeat[];
  /** Server only until the showdown; each dealt seat's face-down first card */
  holes: Record<GameSeat, Card | null>;
  /** Face-up cards each seat drew after its hole card */
  ups: Record<GameSeat, Card[]>;
  /** Seats whose hand is finished */
  done: Record<GameSeat, boolean>;
  /** The seat to act while playing */
  currentTurnSeat: GameSeat;
  log: TenHalfLogEntry[];
  result: TenHalfMatchResult | null;
}

export interface TenHalfVisibleState extends ObserverView<Card> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'tenhalf';
  readonly phase: TenHalfPhase;
  readonly mySeat: GameSeat;
  /** Seats taking part, ordered N, E, S, W */
  readonly seats: readonly GameSeat[];
  readonly hand: number;
  /** Hands in this match */
  readonly totalHands: number;
  readonly banker: GameSeat;
  readonly chips: Record<GameSeat, number>;
  /** This seat's pending bet while betting */
  readonly myBet: number | null;
  readonly betPlaced: Record<GameSeat, boolean>;
  readonly betDeadline: number | null;
  readonly bets: Record<GameSeat, number>;
  readonly dealt: readonly GameSeat[];
  /** Seats holding a face-down card; the card itself shows only for this seat or after the showdown */
  readonly holeSeats: readonly GameSeat[];
  /** This seat's own hole card, plus every revealed hole card after the showdown */
  readonly holes: Record<GameSeat, Card | null>;
  readonly ups: Record<GameSeat, readonly Card[]>;
  readonly done: Record<GameSeat, boolean>;
  readonly currentTurnSeat: GameSeat;
  readonly log: readonly TenHalfLogEntry[];
  readonly result: TenHalfMatchResult | null;
}

export interface TenHalfGameContract {
  readonly state: TenHalfGameState;
  readonly visible: TenHalfVisibleState;
  readonly result: TenHalfMatchResult;
  readonly options: Record<string, never>;
}
