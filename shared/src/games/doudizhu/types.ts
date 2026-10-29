import type { CardOrJoker, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { DdzBidEntry, DdzCombo, DdzVariant } from '../../rules/doudizhu';

/** Room rule: how the landlord is decided. */
export interface DouDizhuOptions {
  readonly variant: DdzVariant;
}

export interface DouDizhuPlay {
  readonly seat: GameSeat;
  readonly cards: CardOrJoker[];
  readonly combo: DdzCombo;
}

export type DouDizhuLogEntry =
  | { readonly type: 'deal'; readonly deal: number; readonly redeal: number; readonly firstCaller: GameSeat; readonly timestamp: number }
  | { readonly type: 'bid'; readonly seat: GameSeat; readonly score: 0 | 1 | 2 | 3; readonly timestamp: number }
  | { readonly type: 'claim'; readonly seat: GameSeat; readonly take: boolean; readonly timestamp: number }
  /** Every seat passed, so the cards are dealt again */
  | { readonly type: 'redeal'; readonly timestamp: number }
  | {
    readonly type: 'landlord';
    readonly seat: GameSeat;
    readonly base: number;
    /** Grabs made after the call, each doubling the stake */
    readonly grabs: number;
    /** The auction was void too often, so the first caller took the landlord without bidding */
    readonly forced: boolean;
    /** The three bottom cards, shown to everyone once the auction ends */
    readonly bottom: CardOrJoker[];
    readonly timestamp: number;
  }
  | { readonly type: 'play'; readonly seat: GameSeat; readonly cards: CardOrJoker[]; readonly combo: DdzCombo; readonly timestamp: number }
  | { readonly type: 'pass'; readonly seat: GameSeat; readonly timestamp: number }
  | { readonly type: 'round_end'; readonly leaderSeat: GameSeat; readonly timestamp: number }
  | {
    readonly type: 'deal_end';
    readonly deal: number;
    readonly landlord: GameSeat;
    readonly winner: GameSeat;
    readonly landlordWins: boolean;
    readonly base: number;
    /** Bombs and rockets played in the deal */
    readonly bombs: number;
    readonly grabs: number;
    readonly spring: boolean;
    readonly antiSpring: boolean;
    readonly multiplier: number;
    /** Points each seat gained or lost in the deal */
    readonly scores: Record<GameSeat, number>;
    /** Running totals after the deal */
    readonly totals: Record<GameSeat, number>;
    /** Cards each seat still held, now open to everyone */
    readonly hands: Record<GameSeat, CardOrJoker[]>;
    readonly timestamp: number;
  };

export interface DouDizhuMatchResult {
  readonly gameType: 'doudizhu';
  /** Seats that took part, ordered N, E, S, W */
  readonly seats: GameSeat[];
  /** Points after the last deal; 0 for empty seats */
  readonly scores: Record<GameSeat, number>;
  readonly deals: number;
  /** Highest total, ties included */
  readonly winners: GameSeat[];
}

export type DouDizhuPhase = 'calling' | 'playing' | 'scoring';

export interface DouDizhuGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'doudizhu';
  readonly id: string;
  readonly startedAt: number;
  /** Exactly three seats */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  readonly options: DouDizhuOptions;
  phase: DouDizhuPhase;
  /** Deal in progress, 1 to the match length */
  deal: number;
  /** Voided auctions in this deal so far */
  redeals: number;
  firstCaller: GameSeat;
  /** Server only until the auction ends; empty for seats not at the table */
  hands: Record<GameSeat, CardOrJoker[]>;
  /** Server only until the auction ends */
  bottom: CardOrJoker[];
  bids: DdzBidEntry[];
  landlord: GameSeat | null;
  base: number;
  grabs: number;
  bombs: number;
  lastPlay: DouDizhuPlay | null;
  /** Consecutive passes after the last play */
  passes: number;
  /** Plays each seat made in the deal, which decides spring and anti-spring */
  plays: Record<GameSeat, number>;
  currentTurnSeat: GameSeat;
  /** Points after the finished deals */
  totals: Record<GameSeat, number>;
  log: DouDizhuLogEntry[];
  result: DouDizhuMatchResult | null;
}

export interface DouDizhuVisibleState extends ObserverView<CardOrJoker> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'doudizhu';
  readonly phase: DouDizhuPhase;
  readonly mySeat: GameSeat;
  /** Seats taking part, in play order */
  readonly seats: readonly GameSeat[];
  readonly options: DouDizhuOptions;
  readonly deal: number;
  readonly totalDeals: number;
  readonly redeals: number;
  readonly firstCaller: GameSeat;
  readonly myHand: readonly CardOrJoker[];
  readonly handCounts: Record<GameSeat, number>;
  readonly bids: readonly DdzBidEntry[];
  readonly landlord: GameSeat | null;
  readonly base: number;
  readonly grabs: number;
  readonly bombs: number;
  /** The bottom cards, null until the auction has ended */
  readonly bottom: readonly CardOrJoker[] | null;
  readonly lastPlay: DouDizhuPlay | null;
  readonly passes: number;
  readonly currentTurnSeat: GameSeat;
  readonly totals: Record<GameSeat, number>;
  readonly log: readonly DouDizhuLogEntry[];
  readonly result: DouDizhuMatchResult | null;
}

export interface DouDizhuGameContract {
  readonly state: DouDizhuGameState;
  readonly visible: DouDizhuVisibleState;
  readonly result: DouDizhuMatchResult;
  readonly options: DouDizhuOptions;
}
