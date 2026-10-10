// ─── Game types ───

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

/** Why a recipient sees every hand: an unseated spectator or a permanently eliminated seat. */
export type ObserverRole = 'spectator' | 'eliminated';

/** God view, added only to spectators' and eliminated players' snapshots. */
export interface ObserverView<T> {
  readonly observer?: ObserverRole;
  /** Every seat's private hand */
  readonly observedHands?: Record<Seat, readonly T[]>;
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
  /** In elimination order */
  readonly eliminationOrder: Seat[];
  readonly finalTotal: number;
}

export type NinetyNinePhase = 'playing' | 'scoring';

export interface NinetyNineGameState {
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: Seat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'ninetynine';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: NinetyNinePhase;
  hands: Record<Seat, Card[]>;
  /** Server only; stock[0] is the top of the pile */
  stock: Card[];
  /** Server only; the last card is the most recently played */
  discard: Card[];
  total: number;
  direction: NinetyNineDirection;
  currentTurnSeat: Seat;
  /** In elimination order */
  eliminated: Seat[];
  log: NinetyNineLogEntry[];
  result: NinetyNineMatchResult | null;
}

export interface NinetyNineVisibleState extends ObserverView<Card> {
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

// ─── Sevens ───

export type SevensPhase = 'playing' | 'scoring';

/** Lowest and highest played order per suit (A=1 … K=13); null until that suit's 7 is played. */
export type SevensTable = Record<Suit, { readonly low: number; readonly high: number } | null>;

/** A cover entry never names the card; other playing seats cannot read it before settlement. */
export type SevensLogEntry =
  | { readonly type: 'play'; readonly seat: Seat; readonly card: Card; readonly timestamp: number }
  | { readonly type: 'cover'; readonly seat: Seat; readonly timestamp: number };

export interface SevensMatchResult {
  readonly gameType: 'sevens';
  /** Sum of covered cards, A=1 … K=13 */
  readonly penalties: Record<Seat, number>;
  readonly covered: Record<Seat, Card[]>;
  /** Lowest penalties (ties included), ordered N, E, S, W */
  readonly winners: Seat[];
}

export interface SevensGameState {
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

export type BlackjackOutcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

/**
 * Bets stay hidden until the deal, which makes every seat's cards and bet public. Hands are
 * indexed within the seat; a split inserts the new hand right after the split one.
 */
export type BlackjackLogEntry =
  | { readonly type: 'bet'; readonly seat: Seat; readonly auto: boolean; readonly timestamp: number }
  | {
    readonly type: 'deal';
    readonly hand: number;
    /** 0 for seats sitting out */
    readonly bets: Record<Seat, number>;
    readonly cards: Record<Seat, Card[]>;
    readonly upCard: Card;
    readonly timestamp: number;
  }
  | { readonly type: 'hit'; readonly seat: Seat; readonly handIndex: number; readonly card: Card; readonly timestamp: number }
  | { readonly type: 'stand'; readonly seat: Seat; readonly handIndex: number; readonly timestamp: number }
  | { readonly type: 'double'; readonly seat: Seat; readonly handIndex: number; readonly card: Card; readonly timestamp: number }
  /** `cards[0]` completes the split hand and `cards[1]` the new hand after it */
  | {
    readonly type: 'split';
    readonly seat: Seat;
    readonly handIndex: number;
    readonly cards: readonly [Card, Card];
    readonly timestamp: number;
  }
  | { readonly type: 'reveal'; readonly card: Card; readonly timestamp: number }
  | { readonly type: 'dealerHit'; readonly card: Card; readonly timestamp: number }
  | {
    readonly type: 'settle';
    readonly hand: number;
    /** Per hand, in seat hand order; empty for seats sitting out */
    readonly outcomes: Record<Seat, BlackjackOutcome[]>;
    /** Chips won minus chips staked this hand */
    readonly net: Record<Seat, number>;
    readonly chips: Record<Seat, number>;
    readonly timestamp: number;
  };

export interface BlackjackMatchResult {
  readonly gameType: 'blackjack';
  readonly chips: Record<Seat, number>;
  readonly hands: number;
  /** Most chips (ties included), ordered N, E, S, W */
  readonly winners: Seat[];
}

export type BlackjackPhase = 'betting' | 'playing' | 'scoring';

export interface BlackjackGameState {
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: Seat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'blackjack';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: BlackjackPhase;
  /** Hands dealt so far; betting is for hand `hand + 1` */
  hand: number;
  /** Chips not staked on the table */
  chips: Record<Seat, number>;
  /** Server only while betting; null until the seat bets or when it sits out */
  bets: Record<Seat, number | null>;
  /** Length of the shared betting window */
  readonly betMs: number;
  /** Null until the previous hand's presentation ends and betting opens */
  betDeadline: number | null;
  /** Server only; the undealt part of this hand's shuffled deck */
  deck: Card[];
  /** The latest hand's cards, kept on the table while the next hand is bet */
  hands: Record<Seat, BlackjackHand[]>;
  /** Face-up dealer cards: the up card, then the revealed hole card and draws */
  dealer: Card[];
  /** Server only; the face-down card until the dealer reveals it */
  hole: Card | null;
  currentTurnSeat: Seat;
  activeHand: number;
  log: BlackjackLogEntry[];
  result: BlackjackMatchResult | null;
}

export interface BlackjackVisibleState {
  readonly observer?: ObserverRole;
  /** God view of the face-down dealer card while it is hidden */
  readonly observedHole?: Card;
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'blackjack';
  readonly phase: BlackjackPhase;
  readonly mySeat: Seat;
  readonly hand: number;
  readonly chips: Record<Seat, number>;
  /** This seat's pending bet while betting */
  readonly myBet: number | null;
  readonly betPlaced: Record<Seat, boolean>;
  readonly betDeadline: number | null;
  readonly hands: Record<Seat, readonly BlackjackHand[]>;
  readonly dealer: readonly Card[];
  /** The dealer holds a face-down card */
  readonly holeHidden: boolean;
  readonly currentTurnSeat: Seat;
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
  readonly eligible: Seat[];
  readonly winners: Seat[];
}

/** Hole cards never enter the log until a showdown reveals them. */
export type HoldemLogEntry =
  | {
    readonly type: 'hand';
    readonly hand: number;
    readonly button: Seat;
    readonly smallBlind: number;
    readonly bigBlind: number;
    /** Chips each seat posted as a blind; a short stack posts all it has */
    readonly blinds: Record<Seat, number>;
    readonly timestamp: number;
  }
  | {
    readonly type: 'action';
    readonly seat: Seat;
    readonly action: 'fold' | 'check' | 'call' | 'bet' | 'raise';
    /** The seat's total stake on this street after the action */
    readonly to: number;
    readonly allIn: boolean;
    readonly timestamp: number;
  }
  | { readonly type: 'street'; readonly street: Exclude<HoldemStreet, 'preflop'>; readonly cards: Card[]; readonly timestamp: number }
  /** Hole cards of every unfolded seat; empty for the rest */
  | { readonly type: 'showdown'; readonly cards: Record<Seat, Card[]>; readonly timestamp: number }
  | {
    readonly type: 'award';
    readonly pots: HoldemPot[];
    readonly chips: Record<Seat, number>;
    /** Seats that lost their last chip this hand, in elimination order */
    readonly eliminated: Seat[];
    readonly timestamp: number;
  };

export interface HoldemMatchResult {
  readonly gameType: 'holdem';
  readonly chips: Record<Seat, number>;
  readonly hands: number;
  /** Most chips (ties included), ordered N, E, S, W */
  readonly winners: Seat[];
  /** Seats that lost every chip, in elimination order */
  readonly eliminationOrder: Seat[];
}

export type HoldemPhase = 'playing' | 'scoring';

export interface HoldemGameState {
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: Seat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'holdem';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: HoldemPhase;
  hand: number;
  button: Seat;
  smallBlind: number;
  bigBlind: number;
  /** Chips not yet staked this hand */
  chips: Record<Seat, number>;
  streetBets: Record<Seat, number>;
  /** Chips staked this hand, including this street */
  totalBets: Record<Seat, number>;
  /** Seats dealt into this hand, ordered N, E, S, W */
  dealt: Seat[];
  folded: Seat[];
  street: HoldemStreet;
  board: Card[];
  /** Highest street stake to match */
  currentBet: number;
  /** Smallest raise increment */
  minRaise: number;
  /** Seats that acted since the last full raise; others may still raise */
  acted: Seat[];
  /** Hole cards a showdown revealed this hand */
  revealed: Record<Seat, Card[]>;
  eliminated: Seat[];
  currentTurnSeat: Seat;
  /** Server only */
  deck: Card[];
  /** Server only; each seat's hole cards */
  hands: Record<Seat, Card[]>;
  log: HoldemLogEntry[];
  result: HoldemMatchResult | null;
}

export interface HoldemVisibleState extends ObserverView<Card> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'holdem';
  readonly phase: HoldemPhase;
  readonly mySeat: Seat;
  readonly myHand: readonly Card[];
  readonly hand: number;
  readonly button: Seat;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly chips: Record<Seat, number>;
  readonly streetBets: Record<Seat, number>;
  readonly totalBets: Record<Seat, number>;
  readonly dealt: readonly Seat[];
  readonly folded: readonly Seat[];
  readonly street: HoldemStreet;
  readonly board: readonly Card[];
  readonly currentBet: number;
  readonly minRaise: number;
  readonly acted: readonly Seat[];
  readonly revealed: Record<Seat, readonly Card[]>;
  readonly eliminated: readonly Seat[];
  readonly currentTurnSeat: Seat;
  readonly log: readonly HoldemLogEntry[];
  readonly result: HoldemMatchResult | null;
}

// ─── Cross-game ───

export type AnyGameState =
  | BridgeGameState
  | BigTwoGameState
  | RedPointsGameState
  | NinetyNineGameState
  | SevensGameState
  | ChinesePokerGameState
  | LiarsDeckGameState
  | BlackjackGameState
  | HoldemGameState;

export type PlayerVisibleGameState =
  | BridgeVisibleState
  | BigTwoVisibleState
  | RedPointsVisibleState
  | NinetyNineVisibleState
  | SevensVisibleState
  | ChinesePokerVisibleState
  | LiarsDeckVisibleState
  | BlackjackVisibleState
  | HoldemVisibleState;

export type MatchResult =
  | ({ readonly gameType: 'bridge' } & GameResult)
  | BigTwoMatchResult
  | RedPointsMatchResult
  | NinetyNineMatchResult
  | SevensMatchResult
  | ChinesePokerMatchResult
  | LiarsDeckMatchResult
  | BlackjackMatchResult
  | HoldemMatchResult;

export interface MatchSummary {
  readonly id: string;
  readonly roomCode: RoomCode;
  /** Ordered by seat N, E, S, W */
  readonly accountIds: readonly string[];
  readonly result: MatchResult;
  readonly finishedAt: number;
}
