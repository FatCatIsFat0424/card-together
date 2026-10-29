import type { Card, CardOrJoker, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

/**
 * Only discarded pairs are public. A draw names the position taken from the neighbour's hand, never the
 * card: the drawer and the neighbour see it, and everyone else learns its rank only if it formed a pair.
 */
export type OldMaidLogEntry =
  | {
    readonly type: 'deal';
    readonly deal: number;
    readonly starter: GameSeat;
    /** Pairs each seat discarded after the deal, two cards per pair */
    readonly discards: Record<GameSeat, Card[]>;
    /** Cards each seat holds after discarding */
    readonly counts: Record<GameSeat, number>;
    /** Seats whose hands were already empty, in finishing order */
    readonly finished: GameSeat[];
    readonly timestamp: number;
  }
  | {
    readonly type: 'draw';
    readonly seat: GameSeat;
    /** The seat drawn from */
    readonly from: GameSeat;
    /** Position taken in the neighbour's hand, counted from the left */
    readonly index: number;
    /** The pair the drawn card completed, or empty */
    readonly discarded: Card[];
    /** Seats the draw left without cards, in finishing order */
    readonly finished: GameSeat[];
    readonly timestamp: number;
  }
  | {
    readonly type: 'settle';
    readonly deal: number;
    /** Finishing order, with the seat left holding the joker last */
    readonly order: GameSeat[];
    readonly loser: GameSeat;
    readonly points: Record<GameSeat, number>;
    readonly totals: Record<GameSeat, number>;
    readonly timestamp: number;
  };

export interface OldMaidMatchResult {
  readonly gameType: 'oldmaid';
  /** Seats that took part, ordered N, E, S, W, P5-P8 */
  readonly seats: GameSeat[];
  readonly deals: number;
  /** Placement points over all deals; 0 for empty seats */
  readonly totals: Record<GameSeat, number>;
  /** Finishing order of each deal, the joker holder last */
  readonly dealOrders: GameSeat[][];
  /** Most points (ties included), ordered like `seats` */
  readonly winners: GameSeat[];
}

export type OldMaidPhase = 'playing' | 'scoring';

export interface OldMaidGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'oldmaid';
  readonly id: string;
  readonly startedAt: number;
  /** Missing for empty seats, which hold no cards */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: OldMaidPhase;
  /** Deal being played, from 1 */
  deal: number;
  /** Server only; each seat's hand in the order its owner keeps it, empty for finished and empty seats */
  hands: Record<GameSeat, CardOrJoker[]>;
  /** Seats out of cards in this deal, in finishing order */
  finished: GameSeat[];
  /** The seat drawing */
  currentTurnSeat: GameSeat;
  totals: Record<GameSeat, number>;
  /** Finishing orders of the deals already played */
  dealOrders: GameSeat[][];
  log: OldMaidLogEntry[];
  result: OldMaidMatchResult | null;
}

export interface OldMaidVisibleState extends ObserverView<CardOrJoker> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'oldmaid';
  readonly phase: OldMaidPhase;
  readonly mySeat: GameSeat;
  /** Seats taking part, ordered N, E, S, W, P5-P8 */
  readonly seats: readonly GameSeat[];
  readonly deal: number;
  /** Deals in this match */
  readonly totalDeals: number;
  /** The viewer's own hand in its own order */
  readonly myHand: readonly CardOrJoker[];
  /** Cards each seat holds; the only thing shown about the other hands */
  readonly handCounts: Record<GameSeat, number>;
  readonly finished: readonly GameSeat[];
  readonly currentTurnSeat: GameSeat;
  /** The seat the drawer takes from, or null once the deal is over */
  readonly drawFrom: GameSeat | null;
  readonly totals: Record<GameSeat, number>;
  readonly log: readonly OldMaidLogEntry[];
  readonly result: OldMaidMatchResult | null;
}

export interface OldMaidGameContract {
  readonly state: OldMaidGameState;
  readonly visible: OldMaidVisibleState;
  readonly result: OldMaidMatchResult;
  readonly options: Record<string, never>;
}
