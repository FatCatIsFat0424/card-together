import type { Card, Suit, BidSuit, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

export interface NapoleonOptions {
  /** The led trump 2 and 3 may summon the big and small joker */
  readonly jokerSummon: boolean;
}

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

export interface NapoleonGameContract {
  readonly state: NapoleonGameState;
  readonly visible: NapoleonVisibleState;
  readonly result: NapoleonMatchResult;
  readonly options: NapoleonOptions;
}
