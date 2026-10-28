import type { Card, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

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

export interface HoldemGameContract {
  readonly state: HoldemGameState;
  readonly visible: HoldemVisibleState;
  readonly result: HoldemMatchResult;
  readonly options: Record<string, never>;
}
