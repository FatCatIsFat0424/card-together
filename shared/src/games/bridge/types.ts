import type { Card, BidSuit, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { PlayerInfo, Seat } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

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

export interface BridgeGameContract {
  readonly state: BridgeGameState;
  readonly visible: BridgeVisibleState;
  readonly result: { readonly gameType: 'bridge' } & GameResult;
  readonly options: Record<string, never>;
}
