import type { Card, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { PlayerInfo, Seat } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

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

export interface ChinesePokerGameContract {
  readonly state: ChinesePokerGameState;
  readonly visible: ChinesePokerVisibleState;
  readonly result: ChinesePokerMatchResult;
  readonly options: Record<string, never>;
}
