import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import type { GameStateOf, VisibleStateOf } from '@shared/games/game-definition';
import type { GameActionMap } from '@shared/games/actions';
import { isCompassSeat } from '@shared/rules/seats';
import type {
  Card, GameOptions, GameSeat, GameType, MatchResult, ObserverRole, ObserverView, PlayerInfo, RoomCode, Seat, TimeControl,
} from '@shared/types';

export type GameActionResult = { success: true } | { success: false; reason: string };

/** Facade-owned policies injected into game actions without importing the facade. */
export interface GameActionContext {
  readonly automatic: boolean;
  readonly settings: TimeControl;
  /** Rejects manual auto-play/timeouts and advances the single-seat clock on success. */
  readonly timed: (operation: () => GameActionResult) => GameActionResult;
  /** Rejects overlapping presentations and presents successful log changes. */
  readonly present: (operation: () => GameActionResult) => GameActionResult;
  /** Rejects manual auto-play without charging a single-seat clock. */
  readonly simultaneous: (operation: () => GameActionResult) => GameActionResult;
  /** Refills reserves and starts the new hand's clock after its presentation. */
  readonly resetClock: () => void;
}

/** Room rules a match starts with; each game reads only its own field. */
export type GameStartOptions = GameOptions;

export interface GameStartRequest {
  readonly roomCode: RoomCode;
  /** Already checked against the game's seat rules */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  /** The room's timer, or the default for rooms saved without one */
  readonly settings: TimeControl;
  readonly options: GameStartOptions;
}

/** How one committed action moves the turn clock; omitted fields are false. */
export interface ClockAdvance {
  /** The same seat keeps deciding, so its unused base time carries over */
  readonly sameTurn?: boolean;
  /** A new deal began, which refills every reserve */
  readonly redealt?: boolean;
  /** The seat had no real decision, so its reserve is not charged */
  readonly forced?: boolean;
}

/** One window of simultaneous decisions against a single durable deadline. */
export interface SharedDeadlineWindow {
  /** Identifies the window, so a later hand of the same match schedules a fresh timer */
  readonly key: string;
  readonly deadline: number;
}

export interface SharedDeadlineRules<K extends GameType> {
  /** The open window, or null while the game is not collecting simultaneous decisions against a deadline */
  readonly window: (game: GameStateOf<K>) => SharedDeadlineWindow | null;
  /** Seats that still owe a decision once the window has expired */
  readonly pendingSeats: (game: GameStateOf<K>) => readonly GameSeat[];
  /**
   * Seats that owe a simultaneous decision right now, in seat order, which bots submit one at a
   * time; null while turns pass from seat to seat.
   */
  readonly owingSeats: (game: GameStateOf<K>) => readonly GameSeat[] | null;
}

/**
 * Runtime hooks for one game type. The game-manager facade, clocks, bots, and timeout schedulers
 * look these up instead of branching on the game type. Games keep their own state stores.
 */
export interface GameAdapter<K extends GameType> {
  readonly gameType: K;
  readonly getGameState: (roomCode: RoomCode) => GameStateOf<K> | null;
  readonly exportGames: () => GameStateOf<K>[];
  readonly restoreGames: (records: GameStateOf<K>[]) => void;
  /** Ends a game without a match record */
  readonly abortGame: (roomCode: RoomCode) => void;
  /** Deals a new match; the facade has already removed any previous game */
  readonly start: (request: GameStartRequest) => GameActionResult;
  readonly applyAction: (
    roomCode: RoomCode, seat: GameSeat, action: GameActionMap[K], context: GameActionContext,
  ) => GameActionResult;
  /** The opening deal is presented, so the first turn waits for it */
  readonly presentsOpening?: boolean;
  /** One seat's own filtered view, or null when the seat cannot take part */
  readonly getPlayerVisibleState: (roomCode: RoomCode, seat: GameSeat) => VisibleStateOf<K> | null;
  /** Adds god view for a spectator or a seat permanently out of the match */
  readonly withObserverView: (visible: VisibleStateOf<K>, game: GameStateOf<K>, observer: ObserverRole) => VisibleStateOf<K>;
  /** Log index of the entry that knocked the seat out for good, or -1; games without elimination omit it */
  readonly eliminationIndex?: (game: GameStateOf<K>, seat: GameSeat) => number;
  /** Seat whose turn clock runs outside scoring, or null while no single seat decides */
  readonly turnSeat: (game: GameStateOf<K>) => GameSeat | null;
  /** Reads the game before an action and returns how the action, once applied, moves the clock */
  readonly clockBeforeAction?: (game: GameStateOf<K>, seat: GameSeat) => (after: GameStateOf<K>) => ClockAdvance;
  /** A separate durable scheduler owns the current turn, so bots and turn timeouts wait */
  readonly forcedActionPending?: (game: GameStateOf<K>) => boolean;
  /** Runs once a committed action has started a presentation ending at `endsAt` */
  readonly afterPresentation?: (game: GameStateOf<K>, endsAt: number) => void;
  /** Simultaneous decisions against one durable deadline */
  readonly sharedDeadline?: SharedDeadlineRules<K>;
  /** The durable history record of a finished match */
  readonly matchResult: (game: GameStateOf<K>) => MatchResult | null;
}

export function isFullTable(players: Partial<Record<GameSeat, PlayerInfo>>): players is Record<Seat, PlayerInfo> {
  return SEAT_ORDER_CLOCKWISE.every((seat) => players[seat] !== undefined);
}

/** Starts a game that seats exactly N, E, S, and W. */
export function startFullTable(
  players: Partial<Record<GameSeat, PlayerInfo>>, start: (players: Record<Seat, PlayerInfo>) => void,
): GameActionResult {
  if (!isFullTable(players)) return { success: false, reason: 'All four seats must be filled.' };
  start(players);
  return { success: true };
}

/** Compass-seat games have no view for additional seats. */
export function compassView<V>(seat: GameSeat, view: (seat: Seat) => V | null): V | null {
  return isCompassSeat(seat) ? view(seat) : null;
}

/** Compass-seat games reject additional seats before applying any runtime policy. */
export function compassAction(seat: GameSeat, run: (seat: Seat) => GameActionResult): GameActionResult {
  return isCompassSeat(seat) ? run(seat) : { success: false, reason: 'This game uses four seats.' };
}

/** God view that adds every seat's private hand. */
export function withObservedHands<V extends ObserverView<T>, T = Card>(
  visible: V, hands: Readonly<Partial<Record<GameSeat, readonly T[]>>>, observer: ObserverRole,
): V {
  return { ...visible, observer, observedHands: hands };
}
