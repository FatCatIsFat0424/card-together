// ─── Game types ───

import type { BlackjackOptions, NapoleonOptions, NinetyNineOptions, RoomCode, SevensOptions, TimeControl } from './room';
import type { GameSeat, PlayerInfo, Seat } from './player';
import type { ReplayRecording } from './replay';
import type { BigTwoComboType } from '../rules/bigtwo';

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

/** Bid level (1-7) */
export type BidLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Bidding action */
export type BidAction =
  | { readonly type: 'bid'; readonly level: BidLevel; readonly suit: BidSuit }
  | { readonly type: 'pass' };

/** Contract (fixed when bidding ends) */
export interface Contract {
  readonly level: BidLevel;
  readonly suit: BidSuit;
  readonly declarer: Seat;
}

/** Game phase */
export type GamePhase =
  | 'dealing'
  | 'redeal_pending'
  | 'bidding'
  | 'playing'
  | 'scoring';

/** Record of one trick */
export interface TrickRecord {
  readonly cards: Record<Seat, Card>;
  readonly leadSeat: Seat;
  readonly winnerSeat: Seat;
}

/** Game action log entry */
export type GameLogEntry =
  | { readonly type: 'bid'; readonly seat: Seat; readonly action: BidAction; readonly timestamp: number }
  | { readonly type: 'play'; readonly seat: Seat; readonly card: Card; readonly timestamp: number }
  | { readonly type: 'trick_end'; readonly winnerSeat: Seat; readonly trickIndex: number; readonly timestamp: number }
  | { readonly type: 'redeal'; readonly seat: Seat; readonly accepted: boolean; readonly timestamp: number }
  | { readonly type: 'system'; readonly message: string; readonly timestamp: number };

/** Game result */
export interface GameResult {
  readonly contract: Contract;
  readonly declarerTeamTricks: number;
  readonly defenderTeamTricks: number;
  readonly requiredTricks: number;
  readonly declarerTeamWins: boolean;
}

/** Teams: East-West vs North-South */
export type Team = 'EW' | 'NS';

/** Playing phase state */
export interface PlayingState {
  readonly currentTrick: Partial<Record<Seat, Card>>;
  readonly trickLeadSeat: Seat;
  readonly currentTurnSeat: Seat;
  readonly completedTricks: readonly TrickRecord[];
  readonly trickCountEW: number;
  readonly trickCountNS: number;
}

/** Bidding phase state */
export interface BiddingState {
  readonly bids: ReadonlyArray<{ readonly seat: Seat; readonly action: BidAction }>;
  readonly currentBidderSeat: Seat;
  readonly highestBid: { readonly level: BidLevel; readonly suit: BidSuit; readonly seat: Seat } | null;
  readonly consecutivePassCount: number;
  readonly isFirstRound: boolean;
}

/** Full Bridge game state (server internal) */
export interface BridgeGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  /** Seats whose players already left the finished board for the room. */
  returnedSeats?: Seat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
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

/** Bridge state visible to one player (other hands hidden) */
export interface BridgeVisibleState extends ObserverView<Card> {
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

// ─── Big Two ───

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

// ─── Red Points ───

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

// ─── 99 ───

export type NinetyNineDirection = 'ccw' | 'cw';

/** play = a card played (total is the running total afterwards); eliminated = no playable card on turn, so the player busts */
export type NinetyNineLogEntry =
  | {
    readonly type: 'play';
    readonly seat: GameSeat;
    readonly card: Card;
    readonly choice: 'plus' | 'minus' | null;
    readonly target: GameSeat | null;
    readonly total: number;
    readonly timestamp: number;
  }
  | { readonly type: 'eliminated'; readonly seat: GameSeat; readonly timestamp: number };

/**
 * The last survivor wins (`winnerSeat`, the only shape on legacy results); when a two-deck
 * stock runs out first, every survivor ties for first (`winners`, ordered N, E, S, W).
 */
export type NinetyNineMatchResult = {
  readonly seats?: GameSeat[];
  readonly gameType: 'ninetynine';
  /** In elimination order */
  readonly eliminationOrder: GameSeat[];
  readonly finalTotal: number;
} & ({ readonly winnerSeat: GameSeat } | { readonly winners: GameSeat[] });

export type NinetyNinePhase = 'playing' | 'scoring';

export interface NinetyNineGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  /** Missing on legacy snapshots; defaults to standard Ninety-Nine rules. */
  readonly options?: NinetyNineOptions;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'ninetynine';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: NinetyNinePhase;
  hands: Record<GameSeat, Card[]>;
  /** Server only; stock[0] is the top of the pile */
  stock: Card[];
  /** Server only; the last card is the most recently played */
  discard: Card[];
  total: number;
  direction: NinetyNineDirection;
  currentTurnSeat: GameSeat;
  /** In elimination order */
  eliminated: GameSeat[];
  log: NinetyNineLogEntry[];
  result: NinetyNineMatchResult | null;
}

export interface NinetyNineVisibleState extends ObserverView<Card> {
  readonly seats?: readonly GameSeat[];
  readonly options?: NinetyNineOptions;
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'ninetynine';
  readonly phase: NinetyNinePhase;
  readonly mySeat: GameSeat;
  readonly myHand: readonly Card[];
  readonly handCounts: Record<GameSeat, number>;
  readonly total: number;
  readonly direction: NinetyNineDirection;
  readonly currentTurnSeat: GameSeat;
  readonly lastPlayed: Card | null;
  readonly stockCount: number;
  readonly eliminated: readonly GameSeat[];
  readonly log: readonly NinetyNineLogEntry[];
  readonly result: NinetyNineMatchResult | null;
}

// ─── Sevens ───

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

// ─── Chinese Poker (13 cards) ───

export type ChinesePokerRow = 'front' | 'middle' | 'back';

export interface ChinesePokerArrangement {
  /** 3 cards */
  readonly front: Card[];
  /** 5 cards */
  readonly middle: Card[];
  /** 5 cards */
  readonly back: Card[];
}

export type ChinesePokerCategory =
  | 'highCard' | 'pair' | 'twoPair' | 'threeOfAKind' | 'straight'
  | 'flush' | 'fullHouse' | 'fourOfAKind' | 'straightFlush';

/** One pairing of two seats; values are from `seats[0]`'s side and `seats[1]` receives the negation. */
export interface ChinesePokerMatchup {
  readonly seats: readonly [Seat, Seat];
  /** Signed row points (front, middle, back) before multipliers */
  readonly rows: readonly [number, number, number];
  /** The seat that won all three rows against the other, if any */
  readonly shooter: Seat | null;
  /** Final signed points after shoot and home-run multipliers */
  readonly points: number;
}

export interface ChinesePokerMatchResult {
  readonly gameType: 'chinesepoker';
  readonly arrangements: Record<Seat, ChinesePokerArrangement>;
  /** Seats whose rows were not in non-decreasing strength, ordered N, E, S, W */
  readonly fouls: Seat[];
  /** All six pairings, in N/E/S/W pair order */
  readonly matchups: ChinesePokerMatchup[];
  /** The seat that shot all three opponents */
  readonly homeRun: Seat | null;
  /** Totals sum to zero */
  readonly scores: Record<Seat, number>;
  /** Highest scores (ties included), ordered N, E, S, W */
  readonly winners: Seat[];
}

export type ChinesePokerPhase = 'arranging' | 'scoring';

/** Submissions never include the arrangement; it becomes public only in the result. */
export type ChinesePokerLogEntry =
  | { readonly type: 'submit'; readonly seat: Seat; readonly timestamp: number }
  | { readonly type: 'reveal'; readonly row: ChinesePokerRow; readonly timestamp: number }
  | { readonly type: 'shoot'; readonly seat: Seat; readonly target: Seat; readonly timestamp: number }
  | { readonly type: 'homerun'; readonly seat: Seat; readonly timestamp: number };

export interface ChinesePokerGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: Seat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'chinesepoker';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: ChinesePokerPhase;
  /** The dealt 13 cards; unchanged by arranging */
  hands: Record<Seat, Card[]>;
  /** Server only until every seat has submitted */
  arrangements: Record<Seat, ChinesePokerArrangement | null>;
  /** Shared deadline for every seat's arrangement */
  arrangeDeadline: number;
  /** Human seats arranged by the server at the deadline, ordered N, E, S, W */
  autoArranged: Seat[];
  log: ChinesePokerLogEntry[];
  result: ChinesePokerMatchResult | null;
}

export interface ChinesePokerVisibleState extends ObserverView<Card> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'chinesepoker';
  readonly phase: ChinesePokerPhase;
  readonly mySeat: Seat;
  readonly myHand: readonly Card[];
  readonly myArrangement: ChinesePokerArrangement | null;
  readonly submitted: Record<Seat, boolean>;
  readonly arrangeDeadline: number;
  readonly autoArranged: readonly Seat[];
  readonly log: readonly ChinesePokerLogEntry[];
  readonly result: ChinesePokerMatchResult | null;
}

// ─── Liar's Deck ───

export type LiarTableFace = 'K' | 'Q' | 'A';

export type LiarFace = LiarTableFace | 'joker';

/** `id` identifies one of the 20 deck cards; several cards share each face. */
export interface LiarCard {
  readonly id: number;
  readonly face: LiarFace;
}

/** Plays never name their cards; only the challenged play is revealed. */
export type LiarsDeckLogEntry =
  | {
    readonly type: 'round';
    readonly round: number;
    readonly tableFace: LiarTableFace;
    readonly starter: Seat;
    readonly timestamp: number;
  }
  | { readonly type: 'play'; readonly seat: Seat; readonly count: number; readonly timestamp: number }
  | {
    readonly type: 'challenge';
    readonly seat: Seat;
    readonly target: Seat;
    readonly revealed: LiarFace[];
    readonly lied: boolean;
    readonly timestamp: number;
  }
  /** `shot` is the seat's trigger pull count including this one */
  | { readonly type: 'shot'; readonly seat: Seat; readonly shot: number; readonly survived: boolean; readonly timestamp: number };

export interface LiarsDeckMatchResult {
  readonly gameType: 'liarsdeck';
  readonly winnerSeat: Seat;
  /** In elimination order */
  readonly eliminationOrder: Seat[];
  readonly shots: Record<Seat, number>;
  readonly rounds: number;
}

export type LiarsDeckPhase = 'playing' | 'scoring';

export interface LiarsDeckLastPlay {
  readonly seat: Seat;
  readonly count: number;
}

export interface LiarsDeckGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: Seat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'liarsdeck';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: LiarsDeckPhase;
  hands: Record<Seat, LiarCard[]>;
  /** Server only; this round's face-down cards in play order, so the last play is its tail */
  pile: LiarCard[];
  lastPlay: LiarsDeckLastPlay | null;
  tableFace: LiarTableFace;
  round: number;
  currentTurnSeat: Seat;
  /** Server only; the trigger pull (1–6) that fires each seat's bullet */
  bullets: Record<Seat, number>;
  shots: Record<Seat, number>;
  /** In elimination order */
  eliminated: Seat[];
  log: LiarsDeckLogEntry[];
  result: LiarsDeckMatchResult | null;
}

export interface LiarsDeckVisibleState extends ObserverView<LiarCard> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'liarsdeck';
  readonly phase: LiarsDeckPhase;
  readonly mySeat: Seat;
  readonly myHand: readonly LiarCard[];
  /** Cards this seat played face down during the current round */
  readonly myPlayed: readonly LiarCard[];
  readonly handCounts: Record<Seat, number>;
  readonly pileCount: number;
  readonly lastPlay: LiarsDeckLastPlay | null;
  readonly tableFace: LiarTableFace;
  readonly round: number;
  readonly currentTurnSeat: Seat;
  readonly shots: Record<Seat, number>;
  readonly eliminated: readonly Seat[];
  readonly log: readonly LiarsDeckLogEntry[];
  readonly result: LiarsDeckMatchResult | null;
}

// ─── Blackjack ───

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

// ─── Texas Hold'em ───

export type HoldemStreet = 'preflop' | 'flop' | 'turn' | 'river';

/** `raise` sets this street's total stake to `to`; it is a bet when nothing has been bet yet. */
export type HoldemAction =
  | { readonly type: 'fold' }
  | { readonly type: 'check' }
  | { readonly type: 'call' }
  | { readonly type: 'raise'; readonly to: number };

export interface HoldemPot {
  readonly amount: number;
  /** Unfolded seats that staked enough to win this pot, ordered N, E, S, W */
  readonly eligible: GameSeat[];
  readonly winners: GameSeat[];
}

/** Hole cards never enter the log until a showdown reveals them. */
export type HoldemLogEntry =
  | {
    readonly type: 'hand';
    readonly hand: number;
    readonly button: GameSeat;
    readonly smallBlind: number;
    readonly bigBlind: number;
    /** Chips each seat posted as a blind; a short stack posts all it has */
    readonly blinds: Record<GameSeat, number>;
    readonly timestamp: number;
  }
  | {
    readonly type: 'action';
    readonly seat: GameSeat;
    readonly action: 'fold' | 'check' | 'call' | 'bet' | 'raise';
    /** The seat's total stake on this street after the action */
    readonly to: number;
    readonly allIn: boolean;
    readonly timestamp: number;
  }
  | { readonly type: 'street'; readonly street: Exclude<HoldemStreet, 'preflop'>; readonly cards: Card[]; readonly timestamp: number }
  /** Hole cards of every unfolded seat; empty for the rest */
  | { readonly type: 'showdown'; readonly cards: Record<GameSeat, Card[]>; readonly timestamp: number }
  | {
    readonly type: 'award';
    readonly pots: HoldemPot[];
    readonly chips: Record<GameSeat, number>;
    /** Seats that lost their last chip this hand, in elimination order */
    readonly eliminated: GameSeat[];
    readonly timestamp: number;
  };

export interface HoldemMatchResult {
  readonly gameType: 'holdem';
  /** Seats that took part, ordered N, E, S, W; missing on legacy results, where all four did */
  readonly seats?: GameSeat[];
  /** 0 for empty seats */
  readonly chips: Record<GameSeat, number>;
  readonly hands: number;
  /** Most chips (ties included), ordered N, E, S, W */
  readonly winners: GameSeat[];
  /** Seats that lost every chip, in elimination order */
  readonly eliminationOrder: GameSeat[];
}

export type HoldemPhase = 'playing' | 'scoring';

export interface HoldemGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'holdem';
  readonly id: string;
  readonly startedAt: number;
  /** Missing for empty seats, which hold no chips and are never dealt in */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: HoldemPhase;
  hand: number;
  button: GameSeat;
  smallBlind: number;
  bigBlind: number;
  /** Chips not yet staked this hand */
  chips: Record<GameSeat, number>;
  streetBets: Record<GameSeat, number>;
  /** Chips staked this hand, including this street */
  totalBets: Record<GameSeat, number>;
  /** Seats dealt into this hand, ordered N, E, S, W */
  dealt: GameSeat[];
  folded: GameSeat[];
  street: HoldemStreet;
  board: Card[];
  /** Highest street stake to match */
  currentBet: number;
  /** Smallest raise increment */
  minRaise: number;
  /** Seats that acted since the last full raise; others may still raise */
  acted: GameSeat[];
  /** Hole cards a showdown revealed this hand */
  revealed: Record<GameSeat, Card[]>;
  eliminated: GameSeat[];
  currentTurnSeat: GameSeat;
  /** Server only */
  deck: Card[];
  /** Server only; each seat's hole cards */
  hands: Record<GameSeat, Card[]>;
  log: HoldemLogEntry[];
  result: HoldemMatchResult | null;
}

export interface HoldemVisibleState extends ObserverView<Card> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'holdem';
  readonly phase: HoldemPhase;
  readonly mySeat: GameSeat;
  /** Seats taking part, ordered N, E, S, W */
  readonly seats: readonly GameSeat[];
  readonly myHand: readonly Card[];
  readonly hand: number;
  readonly button: GameSeat;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly chips: Record<GameSeat, number>;
  readonly streetBets: Record<GameSeat, number>;
  readonly totalBets: Record<GameSeat, number>;
  readonly dealt: readonly GameSeat[];
  readonly folded: readonly GameSeat[];
  readonly street: HoldemStreet;
  readonly board: readonly Card[];
  readonly currentBet: number;
  readonly minRaise: number;
  readonly acted: readonly GameSeat[];
  readonly revealed: Record<GameSeat, readonly Card[]>;
  readonly eliminated: readonly GameSeat[];
  readonly currentTurnSeat: GameSeat;
  readonly log: readonly HoldemLogEntry[];
  readonly result: HoldemMatchResult | null;
}

// ─── Napoleon ───

export type NapoleonJoker = 'big' | 'small';

/** A suit card or one of the two jokers; the big joker is the colored one. */
export type NapoleonCard = Card | { readonly joker: NapoleonJoker };

/** Napoleon contract levels count the point cards (A, K, Q, J) to win. */
export type NapoleonBidLevel = 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16;

export type NapoleonBidAction =
  | { readonly type: 'bid'; readonly level: NapoleonBidLevel; readonly suit: BidSuit }
  | { readonly type: 'pass' };

export interface NapoleonContract {
  readonly level: NapoleonBidLevel;
  /** Trump suit, or no trump */
  readonly suit: BidSuit;
  readonly napoleon: GameSeat;
}

export interface NapoleonBiddingState {
  readonly bids: ReadonlyArray<{ readonly seat: GameSeat; readonly action: NapoleonBidAction }>;
  readonly currentBidderSeat: GameSeat;
  readonly highestBid: { readonly level: NapoleonBidLevel; readonly suit: BidSuit; readonly seat: GameSeat } | null;
  readonly consecutivePassCount: number;
}

/** `secretary`: the Napoleon calls the secretary card; jokers: a led trump 2 or 3 calls them. */
export type NapoleonSummon = 'secretary' | 'bigJoker' | 'smallJoker';

export interface NapoleonPlay {
  readonly seat: GameSeat;
  readonly card: NapoleonCard;
}

export interface NapoleonTrick {
  readonly leadSeat: GameSeat;
  /** In play order */
  readonly plays: readonly NapoleonPlay[];
  /** The led card's suit, or the suit named with a led secretary card or joker; null before the lead */
  readonly leadSuit: Suit | null;
  readonly summon: NapoleonSummon | null;
}

export interface NapoleonTrickRecord extends NapoleonTrick {
  readonly leadSuit: Suit;
  readonly winnerSeat: GameSeat;
}

/**
 * `exchanging`: the Napoleon holds the table cards and discards as many; `reviewing`: with four
 * players everyone else acknowledges the public discards; `calling`: the Napoleon names the secretary card.
 */
export type NapoleonPhase = 'bidding' | 'exchanging' | 'reviewing' | 'calling' | 'playing' | 'scoring';

/** Every action a seat takes, sent as one Socket payload and returned by bots. */
export type NapoleonAction =
  | { readonly type: 'bid'; readonly action: NapoleonBidAction }
  | { readonly type: 'discard'; readonly cards: readonly NapoleonCard[] }
  | { readonly type: 'review' }
  | { readonly type: 'call'; readonly card: NapoleonCard }
  | {
    readonly type: 'play';
    readonly card: NapoleonCard;
    /** Required when leading the secretary card or a joker; forbidden otherwise */
    readonly leadSuit?: Suit;
    readonly summon?: NapoleonSummon;
  };

/** Public log; discards never enter it, so hidden discards cannot leak through history. */
export type NapoleonLogEntry =
  | { readonly type: 'deal'; readonly dealerSeat: GameSeat; readonly timestamp: number }
  | { readonly type: 'bid'; readonly seat: GameSeat; readonly action: NapoleonBidAction; readonly timestamp: number }
  | { readonly type: 'exchange'; readonly seat: GameSeat; readonly timestamp: number }
  | { readonly type: 'call'; readonly seat: GameSeat; readonly card: NapoleonCard; readonly timestamp: number }
  | {
    readonly type: 'play';
    readonly seat: GameSeat;
    readonly card: NapoleonCard;
    readonly leadSuit?: Suit;
    readonly summon?: NapoleonSummon;
    readonly timestamp: number;
  }
  | { readonly type: 'trick_end'; readonly winnerSeat: GameSeat; readonly trickIndex: number; readonly timestamp: number };

export interface NapoleonMatchResult {
  readonly gameType: 'napoleon';
  /** Seats that took part, ordered N, E, S, W, P5, P6 */
  readonly seats: GameSeat[];
  readonly contract: NapoleonContract;
  readonly secretaryCard: NapoleonCard;
  /** Null when the Napoleon held or discarded the secretary card */
  readonly secretarySeat: GameSeat | null;
  /** Point cards each seat won in tricks; 0 for seats that did not take part */
  readonly points: Record<GameSeat, number>;
  readonly discards: NapoleonCard[];
  /** Point cards among the discards, credited to the defenders */
  readonly discardPoints: number;
  readonly napoleonPoints: number;
  readonly defenderPoints: number;
  readonly napoleonWins: boolean;
  /** Winning side, ordered N, E, S, W, P5, P6 */
  readonly winners: GameSeat[];
}

export interface NapoleonGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'napoleon';
  readonly id: string;
  readonly startedAt: number;
  /** Missing for empty seats, which receive no cards or turns */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  readonly options: NapoleonOptions;
  /** Seats taking part, ordered N, E, S, W, P5, P6 */
  readonly seats: GameSeat[];
  phase: NapoleonPhase;
  /** Auction starts with the seat after the dealer; a redeal keeps the dealer */
  readonly dealerSeat: GameSeat;
  /** Server only; participants' hands */
  hands: Partial<Record<GameSeat, NapoleonCard[]>>;
  /** Server only; the face-down table cards, replaced by the Napoleon's discards after the exchange */
  kitty: NapoleonCard[];
  /** Server only during the exchange: the table cards the Napoleon picked up */
  pickedUp: NapoleonCard[];
  bidding: NapoleonBiddingState | null;
  contract: NapoleonContract | null;
  /** Seats that acknowledged the public discards (four players only); bots acknowledge at once */
  reviewed: GameSeat[];
  /** Shared acknowledgment deadline (epoch ms); null outside `reviewing` */
  reviewDeadline: number | null;
  secretaryCard: NapoleonCard | null;
  /** Server only; null when the Napoleon held or discarded the secretary card */
  secretarySeat: GameSeat | null;
  trick: NapoleonTrick | null;
  tricks: NapoleonTrickRecord[];
  /** Acting seat; null while reviewing or after the last trick */
  currentTurnSeat: GameSeat | null;
  log: NapoleonLogEntry[];
  result: NapoleonMatchResult | null;
}

export interface NapoleonVisibleState extends ObserverView<NapoleonCard> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'napoleon';
  readonly phase: NapoleonPhase;
  readonly options: NapoleonOptions;
  readonly mySeat: GameSeat;
  readonly seats: readonly GameSeat[];
  readonly dealerSeat: GameSeat;
  readonly myHand: readonly NapoleonCard[];
  readonly handCounts: Readonly<Partial<Record<GameSeat, number>>>;
  /** The Napoleon only, while exchanging */
  readonly pickedUp: readonly NapoleonCard[] | null;
  /** The Napoleon after the exchange; everyone else with four players or after settlement */
  readonly discards: readonly NapoleonCard[] | null;
  readonly bidding: NapoleonBiddingState | null;
  readonly contract: NapoleonContract | null;
  readonly reviewed: readonly GameSeat[];
  readonly reviewDeadline: number | null;
  readonly secretaryCard: NapoleonCard | null;
  /**
   * Shown to the secretary, to observers, and to everyone once the secretary card is played or the
   * match is settled; null otherwise and when there is no secretary.
   */
  readonly secretarySeat: GameSeat | null;
  readonly trick: NapoleonTrick | null;
  readonly tricks: readonly NapoleonTrickRecord[];
  readonly currentTurnSeat: GameSeat | null;
  /** Cards this seat may play now with some lead suit and summon choice */
  readonly validCards: readonly NapoleonCard[];
  readonly log: readonly NapoleonLogEntry[];
  readonly result: NapoleonMatchResult | null;
}

// ─── Cross-game ───

/** Match-scoped opt-in automation; omitted in older snapshots. */
export interface GameAutomation {
  autoPlaySeats?: GameSeat[];
  earlyLeaveSeats?: GameSeat[];
}

export type AnyGameState = GameAutomation & (
  | BridgeGameState
  | BigTwoGameState
  | RedPointsGameState
  | NinetyNineGameState
  | SevensGameState
  | ChinesePokerGameState
  | LiarsDeckGameState
  | BlackjackGameState
  | HoldemGameState
  | NapoleonGameState);

export type PlayerVisibleGameState = {
  readonly autoPlay?: boolean;
  readonly earlyLeaveSeats?: readonly GameSeat[];
} & (
  | BridgeVisibleState
  | BigTwoVisibleState
  | RedPointsVisibleState
  | NinetyNineVisibleState
  | SevensVisibleState
  | ChinesePokerVisibleState
  | LiarsDeckVisibleState
  | BlackjackVisibleState
  | HoldemVisibleState
  | NapoleonVisibleState);

export type MatchResult =
  | ({ readonly gameType: 'bridge' } & GameResult)
  | BigTwoMatchResult
  | RedPointsMatchResult
  | NinetyNineMatchResult
  | SevensMatchResult
  | ChinesePokerMatchResult
  | LiarsDeckMatchResult
  | BlackjackMatchResult
  | HoldemMatchResult
  | NapoleonMatchResult;

export interface MatchSummary {
  readonly id: string;
  readonly roomCode: RoomCode;
  /** Ordered by seat N, E, S, W; only the result's `seats` when it lists them */
  readonly accountIds: readonly string[];
  readonly result: MatchResult;
  readonly finishedAt: number;
  readonly hasReplay?: boolean;
}
