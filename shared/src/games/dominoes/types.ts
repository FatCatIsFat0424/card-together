import type { GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

/** Pip count of one half of a tile; 0 is blank. */
export type DominoPip = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A tile as `[low, high]`, so the same tile always has the same value. */
export type DominoTile = readonly [DominoPip, DominoPip];

/** The end of the line a tile is added to. */
export type DominoSide = 'left' | 'right';

export type DominoTarget = 50 | 100 | 150;

export interface DominoesOptions {
  /** A match ends after the round in which a seat reaches this total */
  readonly targetScore: DominoTarget;
}

/** One tile on the line; `left` and `right` are the pips facing each side of the line. */
export interface DominoPlacement {
  readonly tile: DominoTile;
  readonly left: DominoPip;
  readonly right: DominoPip;
}

/** The numbers open at both ends of a line. */
export interface DominoEnds {
  readonly left: DominoPip;
  readonly right: DominoPip;
}

export type DominoRoundReason = 'domino' | 'blocked' | 'tie';

/**
 * round = tiles were dealt and `leader` opens; play = a tile joined the line (`side` is null for the first);
 * draw = a seat without a playable tile took one from the boneyard, never recorded with its face, and `ends`
 * is what it could not match; pass = the same with an empty boneyard;
 * roundEnd = scores were settled and every seat's remaining tiles are public.
 */
export type DominoesLogEntry =
  | {
    readonly type: 'round';
    readonly round: number;
    readonly leader: GameSeat;
    readonly counts: Record<GameSeat, number>;
    readonly boneyard: number;
    readonly timestamp: number;
  }
  | {
    readonly type: 'play';
    readonly seat: GameSeat;
    readonly tile: DominoTile;
    readonly side: DominoSide | null;
    readonly placement: DominoPlacement;
    readonly timestamp: number;
  }
  | { readonly type: 'draw'; readonly seat: GameSeat; readonly ends: DominoEnds; readonly timestamp: number }
  | { readonly type: 'pass'; readonly seat: GameSeat; readonly ends: DominoEnds; readonly timestamp: number }
  | {
    readonly type: 'roundEnd';
    readonly round: number;
    readonly reason: DominoRoundReason;
    /** Null when a blocked round tied for the lowest total */
    readonly winner: GameSeat | null;
    /** Points added to the winner's total */
    readonly points: number;
    /** Tiles left in each hand when the round ended */
    readonly hands: Record<GameSeat, DominoTile[]>;
    readonly scores: Record<GameSeat, number>;
    readonly timestamp: number;
  };

export interface DominoesMatchResult {
  readonly gameType: 'dominoes';
  /** Seats that took part, ordered N, E, S, W, P5–P8 */
  readonly seats: GameSeat[];
  readonly scores: Record<GameSeat, number>;
  /** Highest total; seats on the same total share the win */
  readonly winners: GameSeat[];
  readonly rounds: number;
  readonly targetScore: DominoTarget;
  /** Who won each round; null for a blocked round that scored nothing */
  readonly roundWinners: (GameSeat | null)[];
}

export type DominoesPhase = 'playing' | 'scoring';

export interface DominoesGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  readonly options: DominoesOptions;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'dominoes';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: DominoesPhase;
  /** 1-based number of the round in play */
  round: number;
  /** Server only; each seat's tiles, empty for empty seats */
  hands: Record<GameSeat, DominoTile[]>;
  /** Server only; the next tile drawn is the first */
  boneyard: DominoTile[];
  /** Left to right */
  line: DominoPlacement[];
  /** The seat that opened the round */
  leader: GameSeat;
  currentTurnSeat: GameSeat;
  /** Round-1 openers must play this tile: the highest double, or the heaviest tile when nobody holds one */
  openingTile: DominoTile | null;
  scores: Record<GameSeat, number>;
  log: DominoesLogEntry[];
  result: DominoesMatchResult | null;
}

export interface DominoesVisibleState extends ObserverView<DominoTile> {
  /** Occupied seats in play order */
  readonly seats: readonly GameSeat[];
  readonly options: DominoesOptions;
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'dominoes';
  readonly phase: DominoesPhase;
  readonly mySeat: GameSeat;
  readonly myHand: readonly DominoTile[];
  readonly handCounts: Record<GameSeat, number>;
  readonly boneyardCount: number;
  readonly line: readonly DominoPlacement[];
  readonly round: number;
  readonly leader: GameSeat;
  readonly currentTurnSeat: GameSeat;
  readonly openingTile: DominoTile | null;
  readonly scores: Record<GameSeat, number>;
  readonly log: readonly DominoesLogEntry[];
  readonly result: DominoesMatchResult | null;
}

export interface DominoesGameContract {
  readonly state: DominoesGameState;
  readonly visible: DominoesVisibleState;
  readonly result: DominoesMatchResult;
  readonly options: DominoesOptions;
}
