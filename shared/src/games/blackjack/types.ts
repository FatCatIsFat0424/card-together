import type { Card, GameClock, GamePresentation, ObserverRole } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

export interface BlackjackOptions {
  /** Seats take turns as the dealer instead of the house */
  readonly playerDealer: boolean;
}

/** One player hand; a split seat holds two. */
export interface BlackjackHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  /** Created by a split, so a two-card 21 is not a blackjack */
  split: boolean;
  /** Stood, doubled, busted, reached 21, a natural, or a split ace */
  done: boolean;
}

export type BlackjackAction = 'hit' | 'stand' | 'double' | 'split';

/** A player dealer's choice once every player hand is finished */
export type BlackjackDealerAction = 'hit' | 'stand';

export type BlackjackOutcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

/**
 * Bets stay hidden until the deal, which makes every seat's cards and bet public. Hands are
 * indexed within the seat; a split inserts the new hand right after the split one.
 */
export type BlackjackLogEntry =
  | { readonly type: 'bet'; readonly seat: GameSeat; readonly auto: boolean; readonly timestamp: number }
  | {
    readonly type: 'deal';
    readonly hand: number;
    /** 0 for seats sitting out and the player dealer */
    readonly bets: Record<GameSeat, number>;
    readonly cards: Record<GameSeat, Card[]>;
    readonly upCard: Card;
    /** The seat dealing this hand; missing with the house dealer */
    readonly dealer?: GameSeat;
    readonly timestamp: number;
  }
  | { readonly type: 'hit'; readonly seat: GameSeat; readonly handIndex: number; readonly card: Card; readonly timestamp: number }
  | { readonly type: 'stand'; readonly seat: GameSeat; readonly handIndex: number; readonly timestamp: number }
  | { readonly type: 'double'; readonly seat: GameSeat; readonly handIndex: number; readonly card: Card; readonly timestamp: number }
  /** `cards[0]` completes the split hand and `cards[1]` the new hand after it */
  | {
    readonly type: 'split';
    readonly seat: GameSeat;
    readonly handIndex: number;
    readonly cards: readonly [Card, Card];
    readonly timestamp: number;
  }
  | { readonly type: 'reveal'; readonly card: Card; readonly timestamp: number }
  | { readonly type: 'dealerHit'; readonly card: Card; readonly timestamp: number }
  /** A player dealer stands; the house dealer's stand is implied by the settlement */
  | { readonly type: 'dealerStand'; readonly timestamp: number }
  | {
    readonly type: 'settle';
    readonly hand: number;
    /** Per hand, in seat hand order; empty for seats sitting out and the player dealer */
    readonly outcomes: Record<GameSeat, BlackjackOutcome[]>;
    /** Chips won minus chips staked this hand; for a player dealer, chips collected minus chips paid */
    readonly net: Record<GameSeat, number>;
    readonly chips: Record<GameSeat, number>;
    readonly timestamp: number;
  };

export interface BlackjackMatchResult {
  readonly gameType: 'blackjack';
  /** Seats that took part, ordered N, E, S, W; missing on legacy results, where all four did */
  readonly seats?: GameSeat[];
  /** 0 for empty seats */
  readonly chips: Record<GameSeat, number>;
  readonly hands: number;
  /** Most chips (ties included) among the seats that took part, ordered N, E, S, W */
  readonly winners: GameSeat[];
}

export type BlackjackPhase = 'betting' | 'playing' | 'scoring';

export interface BlackjackGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  /** Missing on legacy snapshots; defaults to the house dealer. */
  readonly options?: BlackjackOptions;
  /**
   * Player dealer only: the seat dealing the hand being played, or while betting the next one.
   * Missing with the house dealer.
   */
  dealerSeat?: GameSeat;
  /** Player dealer only: the dealer stood, ending its turn */
  dealerStood?: boolean;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'blackjack';
  readonly id: string;
  readonly startedAt: number;
  /** Missing for empty seats, which never bet, act, or appear in results */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: BlackjackPhase;
  /** Hands dealt so far; betting is for hand `hand + 1` */
  hand: number;
  /** Chips not staked on the table */
  chips: Record<GameSeat, number>;
  /** Server only while betting; null until the seat bets or when it sits out */
  bets: Record<GameSeat, number | null>;
  /** Length of the shared betting window */
  readonly betMs: number;
  /** Null until the previous hand's presentation ends and betting opens */
  betDeadline: number | null;
  /** Server only; the undealt part of this hand's shuffled deck */
  deck: Card[];
  /** The latest hand's cards, kept on the table while the next hand is bet */
  hands: Record<GameSeat, BlackjackHand[]>;
  /** Face-up dealer cards: the up card, then the revealed hole card and draws */
  dealer: Card[];
  /** Server only; the face-down card until the dealer reveals it */
  hole: Card | null;
  /** A player seat's hand, or the player dealer's seat once every player hand is finished */
  currentTurnSeat: GameSeat;
  activeHand: number;
  log: BlackjackLogEntry[];
  result: BlackjackMatchResult | null;
}

export interface BlackjackVisibleState {
  readonly observer?: ObserverRole;
  /** God view of the face-down dealer card while it is hidden */
  readonly observedHole?: Card;
  /** The player dealer's own face-down card while it is hidden from the others */
  readonly myHole?: Card;
  readonly options: BlackjackOptions;
  /** The player dealer of the hand being played, or while betting the next one; null with the house */
  readonly dealerSeat: GameSeat | null;
  /** Hands in this match */
  readonly totalHands: number;
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'blackjack';
  readonly phase: BlackjackPhase;
  readonly mySeat: GameSeat;
  /** Seats taking part, ordered N, E, S, W */
  readonly seats: readonly GameSeat[];
  readonly hand: number;
  readonly chips: Record<GameSeat, number>;
  /** This seat's pending bet while betting */
  readonly myBet: number | null;
  readonly betPlaced: Record<GameSeat, boolean>;
  readonly betDeadline: number | null;
  readonly hands: Record<GameSeat, readonly BlackjackHand[]>;
  readonly dealer: readonly Card[];
  /** The dealer holds a face-down card */
  readonly holeHidden: boolean;
  readonly currentTurnSeat: GameSeat;
  readonly activeHand: number;
  readonly log: readonly BlackjackLogEntry[];
  readonly result: BlackjackMatchResult | null;
}

export interface BlackjackGameContract {
  readonly state: BlackjackGameState;
  readonly visible: BlackjackVisibleState;
  readonly result: BlackjackMatchResult;
  readonly options: BlackjackOptions;
}
