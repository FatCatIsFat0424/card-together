import type { Card, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

export interface NinetyNineOptions {
  readonly twoDecks: boolean;
}

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

export interface NinetyNineGameContract {
  readonly state: NinetyNineGameState;
  readonly visible: NinetyNineVisibleState;
  readonly result: NinetyNineMatchResult;
  readonly options: NinetyNineOptions;
}
