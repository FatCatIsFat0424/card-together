// ─── 遊戲型別定義 ───

import type { RoomCode, TimeControl } from './room';
import type { PlayerInfo, Seat } from './player';
import type { BigTwoComboType } from '../rules/bigtwo';

export interface GameClock {
  readonly lastTimeout?: { readonly seat: Seat; readonly at: number };
  readonly settings: TimeControl;
  readonly bankRemainingMs: Record<Seat, number>;
  readonly turn: {
    readonly id: string;
    readonly seat: Seat;
    readonly startsAt: number;
    readonly baseRemainingMs: number;
    readonly deadline: number;
  } | null;
  /** Added to visible snapshots only. */
  readonly serverNow?: number;
}

export interface GamePresentation {
  /** Absent on legacy snapshots whose shorter deadlines must remain stable. */
  readonly timingVersion?: 2;
  readonly serverNow?: number;
  readonly id: string;
  readonly startedAt: number;
  readonly logStart: number;
}

/** 花色 */
export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';

/** 叫牌花色（含 NT） */
export type BidSuit = Suit | 'nt';

/** 牌面數字：2-14（11=J, 12=Q, 13=K, 14=A） */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

/** 一張牌 */
export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

/** 叫牌等級（1-7） */
export type BidLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 叫牌動作 */
export type BidAction =
  | { readonly type: 'bid'; readonly level: BidLevel; readonly suit: BidSuit }
  | { readonly type: 'pass' };

/** 合約（叫牌結束後確定） */
export interface Contract {
  readonly level: BidLevel;
  readonly suit: BidSuit;
  readonly declarer: Seat;
}

/** 遊戲階段 */
export type GamePhase =
  | 'dealing'
  | 'redeal_pending'
  | 'bidding'
  | 'playing'
  | 'scoring';

/** 一墩的記錄 */
export interface TrickRecord {
  readonly cards: Record<Seat, Card>;
  readonly leadSeat: Seat;
  readonly winnerSeat: Seat;
}

/** 遊戲動作日誌項目 */
export type GameLogEntry =
  | { readonly type: 'bid'; readonly seat: Seat; readonly action: BidAction; readonly timestamp: number }
  | { readonly type: 'play'; readonly seat: Seat; readonly card: Card; readonly timestamp: number }
  | { readonly type: 'trick_end'; readonly winnerSeat: Seat; readonly trickIndex: number; readonly timestamp: number }
  | { readonly type: 'redeal'; readonly seat: Seat; readonly accepted: boolean; readonly timestamp: number }
  | { readonly type: 'system'; readonly message: string; readonly timestamp: number };

/** 遊戲結算結果 */
export interface GameResult {
  readonly contract: Contract;
  readonly declarerTeamTricks: number;
  readonly defenderTeamTricks: number;
  readonly requiredTricks: number;
  readonly declarerTeamWins: boolean;
}

/** 隊伍劃分：東西 vs 南北 */
export type Team = 'EW' | 'NS';

/** 出牌階段狀態 */
export interface PlayingState {
  readonly currentTrick: Partial<Record<Seat, Card>>;
  readonly trickLeadSeat: Seat;
  readonly currentTurnSeat: Seat;
  readonly completedTricks: readonly TrickRecord[];
  readonly trickCountEW: number;
  readonly trickCountNS: number;
}

/** 叫牌階段狀態 */
export interface BiddingState {
  readonly bids: ReadonlyArray<{ readonly seat: Seat; readonly action: BidAction }>;
  readonly currentBidderSeat: Seat;
  readonly highestBid: { readonly level: BidLevel; readonly suit: BidSuit; readonly seat: Seat } | null;
  readonly consecutivePassCount: number;
  readonly isFirstRound: boolean;
}

/** 完整橋牌遊戲狀態（伺服器內部） */
export interface BridgeGameState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'bridge';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: GamePhase;
  hands: Record<Seat, Card[]>;
  readonly dealerSeat: Seat;
  bidding: BiddingState | null;
  contract: Contract | null;
  playing: PlayingState | null;
  result: GameResult | null;
  log: GameLogEntry[];
  redealPendingSeat: Seat | null;
  redealDeclinedSeats: Seat[];
}

/** 給特定玩家的可見橋牌狀態（隱藏他人手牌） */
export interface BridgeVisibleState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'bridge';
  readonly validCards: readonly Card[];
  readonly phase: GamePhase;
  readonly myHand: readonly Card[];
  readonly mySeat: Seat;
  readonly dealerSeat: Seat;
  readonly bidding: BiddingState | null;
  readonly contract: Contract | null;
  readonly playing: PlayingState | null;
  readonly result: GameResult | null;
  readonly log: readonly GameLogEntry[];
  readonly redealPendingSeat: Seat | null;
}

// ─── 大老二 ───

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
  /** 贏家為 0 */
  readonly scores: Record<Seat, number>;
}

export type BigTwoPhase = 'playing' | 'scoring';

export interface BigTwoGameState {
  /** Private persisted deadline; never included in player-visible state. */
  pendingAutoPass?: { readonly id: string; readonly seat: Seat; readonly executeAt: number };
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'bigtwo';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: BigTwoPhase;
  hands: Record<Seat, Card[]>;
  currentTurnSeat: Seat;
  /** null = 自由出牌 */
  lastPlay: BigTwoPlay | null;
  lockedSeats: Seat[];
  /** 首手仍須含 ♣3 */
  firstPlay: boolean;
  log: BigTwoLogEntry[];
  result: BigTwoMatchResult | null;
}

export interface BigTwoVisibleState {
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
  /** 結算時公開所有手牌 */
  readonly revealedHands: Record<Seat, Card[]> | null;
}

// ─── 撿紅點 ───

/** play = 手牌打出、flip = 牌堆翻開；captured 為吃走的桌面牌，null 表示留在桌上 */
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
  /** 最高分者（同分並列），依 N, E, S, W 排序 */
  readonly winners: Seat[];
}

export type RedPointsPhase = 'playing' | 'scoring';

/** play = 等待出牌；flip-choose = 翻牌有多張可吃，等待選擇 */
export type RedPointsStep = 'play' | 'flip-choose';

export interface RedPointsGameState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'redpoints';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: RedPointsPhase;
  hands: Record<Seat, Card[]>;
  table: Card[];
  /** 僅伺服器持有；stock[0] 為牌堆頂 */
  stock: Card[];
  captured: Record<Seat, Card[]>;
  currentTurnSeat: Seat;
  step: RedPointsStep;
  pendingFlip: Card | null;
  log: RedPointsLogEntry[];
  result: RedPointsMatchResult | null;
}

export interface RedPointsVisibleState {
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

// ─── 99 ───

export type NinetyNineDirection = 'ccw' | 'cw';

/** play = 出牌（total 為出牌後累計點數）；eliminated = 輪到時無牌可出而爆掉 */
export type NinetyNineLogEntry =
  | {
    readonly type: 'play';
    readonly seat: Seat;
    readonly card: Card;
    readonly choice: 'plus' | 'minus' | null;
    readonly target: Seat | null;
    readonly total: number;
    readonly timestamp: number;
  }
  | { readonly type: 'eliminated'; readonly seat: Seat; readonly timestamp: number };

export interface NinetyNineMatchResult {
  readonly gameType: 'ninetynine';
  readonly winnerSeat: Seat;
  /** 依淘汰先後 */
  readonly eliminationOrder: Seat[];
  readonly finalTotal: number;
}

export type NinetyNinePhase = 'playing' | 'scoring';

export interface NinetyNineGameState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'ninetynine';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: NinetyNinePhase;
  hands: Record<Seat, Card[]>;
  /** 僅伺服器持有；stock[0] 為牌堆頂 */
  stock: Card[];
  /** 僅伺服器持有；最後一張為最近打出的牌 */
  discard: Card[];
  total: number;
  direction: NinetyNineDirection;
  currentTurnSeat: Seat;
  /** 依淘汰先後 */
  eliminated: Seat[];
  log: NinetyNineLogEntry[];
  result: NinetyNineMatchResult | null;
}

export interface NinetyNineVisibleState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'ninetynine';
  readonly phase: NinetyNinePhase;
  readonly mySeat: Seat;
  readonly myHand: readonly Card[];
  readonly handCounts: Record<Seat, number>;
  readonly total: number;
  readonly direction: NinetyNineDirection;
  readonly currentTurnSeat: Seat;
  readonly lastPlayed: Card | null;
  readonly stockCount: number;
  readonly eliminated: readonly Seat[];
  readonly log: readonly NinetyNineLogEntry[];
  readonly result: NinetyNineMatchResult | null;
}

// ─── 跨遊戲 ───

export type AnyGameState = BridgeGameState | BigTwoGameState | RedPointsGameState | NinetyNineGameState;

export type PlayerVisibleGameState =
  | BridgeVisibleState
  | BigTwoVisibleState
  | RedPointsVisibleState
  | NinetyNineVisibleState;

export type MatchResult =
  | ({ readonly gameType: 'bridge' } & GameResult)
  | BigTwoMatchResult
  | RedPointsMatchResult
  | NinetyNineMatchResult;

export interface MatchSummary {
  readonly id: string;
  readonly roomCode: RoomCode;
  /** 依座位 N, E, S, W 排序 */
  readonly accountIds: readonly string[];
  readonly result: MatchResult;
  readonly finishedAt: number;
}
