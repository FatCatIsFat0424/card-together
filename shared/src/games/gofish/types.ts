import type { Card, GameClock, GamePresentation, ObserverView, Rank } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

/**
 * What the draw after an unsuccessful ask was: `lucky` = the drawn card had the asked rank, so the turn goes on;
 * `miss` = any other card, so the turn passes; `empty` = the stock had no card to draw.
 */
export type GoFishFish = 'lucky' | 'miss' | 'empty';

/**
 * The log is public and never names a hidden card.
 * hand = a hand was dealt; ask = `seat` asked `target` for `rank` and received `given` cards, or went fishing when
 * `given` is 0; book = `seat` laid down the four cards of `rank`; refill = `seat` ran out of cards and drew one;
 * handEnd = every book of the hand is down and `books` lists how many each seat made.
 */
export type GoFishLogEntry =
  | {
    readonly type: 'hand';
    readonly hand: number;
    readonly first: GameSeat;
    readonly timestamp: number;
  }
  | {
    readonly type: 'ask';
    readonly seat: GameSeat;
    readonly target: GameSeat;
    readonly rank: Rank;
    readonly given: number;
    /** Null when the target handed cards over */
    readonly fished: GoFishFish | null;
    readonly timestamp: number;
  }
  | { readonly type: 'book'; readonly seat: GameSeat; readonly rank: Rank; readonly timestamp: number }
  | { readonly type: 'refill'; readonly seat: GameSeat; readonly timestamp: number }
  | {
    readonly type: 'handEnd';
    readonly hand: number;
    readonly books: Record<GameSeat, number>;
    readonly timestamp: number;
  };

/** Most books over the whole match wins; seats on the same total tie. */
export interface GoFishMatchResult {
  readonly seats?: GameSeat[];
  readonly gameType: 'gofish';
  /** Books made over all hands */
  readonly scores: Record<GameSeat, number>;
  readonly winners: GameSeat[];
  /** Hands played, equal to the match length */
  readonly hands: number;
  /** Books each seat made in each hand */
  readonly handBooks: Record<GameSeat, number>[];
}

export type GoFishPhase = 'playing' | 'scoring';

export interface GoFishGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'gofish';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: GoFishPhase;
  /** 1-based number of the hand in play */
  hand: number;
  hands: Record<GameSeat, Card[]>;
  /** Server only; stock[0] is the top of the pile */
  stock: Card[];
  /** Ranks each seat has laid down in the hand in play, in the order they were made */
  books: Record<GameSeat, Rank[]>;
  /** Books from finished hands */
  scores: Record<GameSeat, number>;
  currentTurnSeat: GameSeat;
  log: GoFishLogEntry[];
  result: GoFishMatchResult | null;
}

export interface GoFishVisibleState extends ObserverView<Card> {
  /** Occupied seats in seat order */
  readonly seats: readonly GameSeat[];
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'gofish';
  readonly phase: GoFishPhase;
  readonly mySeat: GameSeat;
  readonly myHand: readonly Card[];
  readonly handCounts: Record<GameSeat, number>;
  readonly hand: number;
  readonly books: Record<GameSeat, readonly Rank[]>;
  /** Books from finished hands; the hand in play adds `books` */
  readonly scores: Record<GameSeat, number>;
  readonly currentTurnSeat: GameSeat;
  readonly stockCount: number;
  readonly log: readonly GoFishLogEntry[];
  readonly result: GoFishMatchResult | null;
}

export interface GoFishGameContract {
  readonly state: GoFishGameState;
  readonly visible: GoFishVisibleState;
  readonly result: GoFishMatchResult;
  readonly options: Record<string, never>;
}
