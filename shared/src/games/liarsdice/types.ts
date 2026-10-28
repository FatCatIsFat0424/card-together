import type { GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

/** One die shows 1 to 6. */
export type DiceFace = 1 | 2 | 3 | 4 | 5 | 6;

/** "`quantity` dice showing `face`" across every cup on the table. */
export interface LiarsDiceBid {
  readonly quantity: number;
  readonly face: DiceFace;
}

/** The table records who made the standing bid; actions name no seat. */
export interface LiarsDiceStandingBid extends LiarsDiceBid {
  readonly seat: GameSeat;
}

/** Dice stay out of the log until a challenge reveals every cup. */
export type LiarsDiceLogEntry =
  | {
    readonly type: 'round';
    readonly round: number;
    readonly starter: GameSeat;
    /** Dice each seat rolled this round; 0 for eliminated and empty seats */
    readonly counts: Record<GameSeat, number>;
    readonly timestamp: number;
  }
  | {
    readonly type: 'bid';
    readonly seat: GameSeat;
    readonly quantity: number;
    readonly face: DiceFace;
    readonly timestamp: number;
  }
  | {
    readonly type: 'challenge';
    readonly seat: GameSeat;
    /** The seat whose bid was challenged */
    readonly target: GameSeat;
    readonly quantity: number;
    readonly face: DiceFace;
    /** Ones counted as the bid face when the cups were lifted */
    readonly wild: boolean;
    /** Every seat's dice, revealed */
    readonly dice: Record<GameSeat, DiceFace[]>;
    /** Dice that matched the bid */
    readonly count: number;
    /** The bid held (`count` reached `quantity`), so the challenger lost */
    readonly bidTrue: boolean;
    readonly loser: GameSeat;
    /** The loser's last die went */
    readonly eliminated: boolean;
    readonly timestamp: number;
  };

export interface LiarsDiceMatchResult {
  readonly gameType: 'liarsdice';
  /** Seats that took part, ordered N, E, S, W, P5–P8 */
  readonly seats: GameSeat[];
  readonly winnerSeat: GameSeat;
  /** In elimination order */
  readonly eliminationOrder: GameSeat[];
  /** Dice left at the end; 0 for eliminated seats */
  readonly dice: Record<GameSeat, number>;
  readonly rounds: number;
}

export type LiarsDicePhase = 'playing' | 'scoring';

export interface LiarsDiceGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'liarsdice';
  readonly id: string;
  readonly startedAt: number;
  /** Missing for empty seats, which hold no dice */
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  phase: LiarsDicePhase;
  round: number;
  /** Server only; each seat's dice, empty for eliminated and empty seats */
  hands: Record<GameSeat, DiceFace[]>;
  bid: LiarsDiceStandingBid | null;
  /** Ones count as any face until someone bids on ones */
  onesWild: boolean;
  currentTurnSeat: GameSeat;
  /** In elimination order */
  eliminated: GameSeat[];
  log: LiarsDiceLogEntry[];
  result: LiarsDiceMatchResult | null;
}

export interface LiarsDiceVisibleState extends ObserverView<DiceFace> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'liarsdice';
  readonly phase: LiarsDicePhase;
  readonly mySeat: GameSeat;
  /** Seats taking part, ordered N, E, S, W, P5–P8 */
  readonly seats: readonly GameSeat[];
  readonly myDice: readonly DiceFace[];
  readonly diceCounts: Record<GameSeat, number>;
  readonly round: number;
  readonly bid: LiarsDiceStandingBid | null;
  readonly onesWild: boolean;
  readonly currentTurnSeat: GameSeat;
  readonly eliminated: readonly GameSeat[];
  readonly log: readonly LiarsDiceLogEntry[];
  readonly result: LiarsDiceMatchResult | null;
}

export interface LiarsDiceGameContract {
  readonly state: LiarsDiceGameState;
  readonly visible: LiarsDiceVisibleState;
  readonly result: LiarsDiceMatchResult;
  readonly options: Record<string, never>;
}
