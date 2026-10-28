// ─── Common game types ───

import type { RoomCode, TimeControl } from './room';
import type { GameSeat, Seat } from './player';
import type { MatchResult } from '../games/type-registry';

export interface GameClock {
  readonly lastTimeout?: { readonly seat: GameSeat; readonly at: number };
  readonly settings: TimeControl;
  readonly bankRemainingMs: Record<Seat, number> & Partial<Record<GameSeat, number>>;
  readonly turn: {
    readonly id: string;
    readonly seat: GameSeat;
    readonly startsAt: number;
    readonly baseRemainingMs: number;
    readonly deadline: number;
  } | null;
  /** Added to visible snapshots only. */
  readonly serverNow?: number;
}

export interface GamePresentation {
  /**
   * Absent on legacy snapshots whose shorter deadlines must remain stable; 2 keeps the 2,400 ms
   * Sevens slay frame that games saved before the selectable slay effects were committed with.
   */
  readonly timingVersion?: 2 | 3;
  readonly serverNow?: number;
  readonly id: string;
  readonly startedAt: number;
  readonly logStart: number;
}

/** Why a recipient sees every hand: an unseated spectator or a permanently eliminated seat. */
export type ObserverRole = 'spectator' | 'eliminated';

/** God view, added only to spectators' and eliminated players' snapshots. */
export interface ObserverView<T> {
  readonly observer?: ObserverRole;
  /** Every seat's private hand */
  readonly observedHands?: Partial<Record<GameSeat, readonly T[]>>;
}

/** Suit */
export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';

/** Bid suit (including NT) */
export type BidSuit = Suit | 'nt';

/** Rank: 2-14 (11=J, 12=Q, 13=K, 14=A) */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

/** A card */
export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

/** The two jokers of a deck; the big joker is the colored one. */
export type JokerKind = 'big' | 'small';

/** A joker card. Kept apart from `Card` so suit/rank games never see one. */
export interface JokerCard {
  readonly joker: JokerKind;
}

/** A suit card or a joker, for games whose deck includes jokers. */
export type CardOrJoker = Card | JokerCard;

/** Match-scoped opt-in automation; omitted in older snapshots. */
export interface GameAutomation {
  autoPlaySeats?: GameSeat[];
  earlyLeaveSeats?: GameSeat[];
}

export interface MatchSummary {
  readonly id: string;
  readonly roomCode: RoomCode;
  /** Ordered by seat N, E, S, W; only the result's `seats` when it lists them */
  readonly accountIds: readonly string[];
  readonly result: MatchResult;
  readonly finishedAt: number;
  readonly hasReplay?: boolean;
}

export type {
  BidLevel,
  BidAction,
  Contract,
  GamePhase,
  TrickRecord,
  GameLogEntry,
  GameResult,
  Team,
  PlayingState,
  BiddingState,
  BridgeGameState,
  BridgeVisibleState,
} from '../games/bridge/types';

export type {
  BigTwoPlay,
  BigTwoLogEntry,
  BigTwoMatchResult,
  BigTwoPhase,
  BigTwoGameState,
  BigTwoVisibleState,
} from '../games/bigtwo/types';

export type {
  RedPointsLogEntry,
  RedPointsMatchResult,
  RedPointsPhase,
  RedPointsStep,
  RedPointsGameState,
  RedPointsVisibleState,
} from '../games/redpoints/types';

export type {
  NinetyNineDirection,
  NinetyNineLogEntry,
  NinetyNineMatchResult,
  NinetyNinePhase,
  NinetyNineGameState,
  NinetyNineVisibleState,
} from '../games/ninetynine/types';

export type {
  SevensPhase,
  SevensTable,
  SevensLogEntry,
  SevensMatchResult,
  SevensGameState,
  SevensVisibleState,
} from '../games/sevens/types';

export type {
  ChinesePokerRow,
  ChinesePokerArrangement,
  ChinesePokerCategory,
  ChinesePokerMatchup,
  ChinesePokerMatchResult,
  ChinesePokerPhase,
  ChinesePokerLogEntry,
  ChinesePokerGameState,
  ChinesePokerVisibleState,
} from '../games/chinesepoker/types';

export type {
  LiarTableFace,
  LiarFace,
  LiarCard,
  LiarsDeckLogEntry,
  LiarsDeckMatchResult,
  LiarsDeckPhase,
  LiarsDeckLastPlay,
  LiarsDeckGameState,
  LiarsDeckVisibleState,
} from '../games/liarsdeck/types';

export type {
  BlackjackHand,
  BlackjackAction,
  BlackjackDealerAction,
  BlackjackOutcome,
  BlackjackLogEntry,
  BlackjackMatchResult,
  BlackjackPhase,
  BlackjackGameState,
  BlackjackVisibleState,
} from '../games/blackjack/types';

export type {
  HoldemStreet,
  HoldemAction,
  HoldemPot,
  HoldemLogEntry,
  HoldemMatchResult,
  HoldemPhase,
  HoldemGameState,
  HoldemVisibleState,
} from '../games/holdem/types';

export type {
  DiceFace,
  LiarsDiceBid,
  LiarsDiceStandingBid,
  LiarsDiceLogEntry,
  LiarsDiceMatchResult,
  LiarsDicePhase,
  LiarsDiceGameState,
  LiarsDiceVisibleState,
} from '../games/liarsdice/types';

export type {
  NapoleonJoker,
  NapoleonCard,
  NapoleonBidLevel,
  NapoleonBidAction,
  NapoleonContract,
  NapoleonBiddingState,
  NapoleonSummon,
  NapoleonPlay,
  NapoleonTrick,
  NapoleonTrickRecord,
  NapoleonPhase,
  NapoleonAction,
  NapoleonLogEntry,
  NapoleonMatchResult,
  NapoleonGameState,
  NapoleonVisibleState,
} from '../games/napoleon/types';

export type {
  TenHalfHandKind,
  TenHalfAction,
  TenHalfOutcome,
  TenHalfLogEntry,
  TenHalfMatchResult,
  TenHalfPhase,
  TenHalfGameState,
  TenHalfVisibleState,
} from '../games/tenhalf/types';

export type { AnyGameState, PlayerVisibleGameState, MatchResult } from '../games/type-registry';
