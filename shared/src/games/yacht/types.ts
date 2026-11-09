import type { GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { YachtBox, YachtFace, YachtMode, YachtOptions, YachtScorecard } from '../../rules/yacht';

export type { YachtBox, YachtFace, YachtMode, YachtOptions, YachtScorecard } from '../../rules/yacht';

/** One seat's dice in the current round. */
export interface YachtTurn {
  /** Empty until the first roll */
  readonly dice: readonly YachtFace[];
  /** Dice kept for the next roll, by position */
  readonly held: readonly boolean[];
  /** Rolls made this round, 0 to 3 */
  readonly rolls: number;
  /** The dice are written into a box; the seat waits for the round to end */
  readonly done: boolean;
}

/** Public record of one scored box. */
export interface YachtLogEntry {
  readonly type: 'score';
  readonly round: number;
  readonly seat: GameSeat;
  readonly box: YachtBox;
  readonly score: number;
  /** The dice were an extra Yacht worth the 100-point bonus */
  readonly bonus: boolean;
  readonly dice: readonly YachtFace[];
  readonly rolls: number;
  readonly timestamp: number;
}

export interface YachtMatchResult {
  readonly gameType: 'yacht';
  /** Seats that took part, ordered N, E, S, W, P5–P8 */
  readonly seats: GameSeat[];
  readonly mode: YachtMode;
  /** Every seat holding the highest total */
  readonly winners: GameSeat[];
  readonly totals: Partial<Record<GameSeat, number>>;
  /** Seats whose upper section reached the bonus */
  readonly upperBonus: Partial<Record<GameSeat, boolean>>;
  /** Yachts each seat rolled and scored (the Yacht box plus extra ones) */
  readonly yachts: Partial<Record<GameSeat, number>>;
}

export type YachtPhase = 'playing' | 'scoring';

export interface YachtGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'yacht';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  readonly options: YachtOptions;
  phase: YachtPhase;
  /** 1 to 13 */
  round: number;
  /** The seat rolling in turn mode; null in simultaneous mode and after the last round */
  currentTurnSeat: GameSeat | null;
  /** Simultaneous mode: length of one round's window */
  readonly roundMs: number;
  /** Simultaneous mode: when the open round ends; null in turn mode */
  roundDeadline: number | null;
  turns: Partial<Record<GameSeat, YachtTurn>>;
  cards: Partial<Record<GameSeat, YachtScorecard>>;
  log: YachtLogEntry[];
  result: YachtMatchResult | null;
}

/** Everything at the table is public, so every recipient receives the same dice and cards. */
export interface YachtVisibleState extends ObserverView<never> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'yacht';
  readonly phase: YachtPhase;
  readonly mySeat: GameSeat;
  /** Seats taking part, ordered N, E, S, W, P5–P8 */
  readonly seats: readonly GameSeat[];
  readonly options: YachtOptions;
  readonly round: number;
  readonly currentTurnSeat: GameSeat | null;
  readonly roundDeadline: number | null;
  readonly turns: Readonly<Partial<Record<GameSeat, YachtTurn>>>;
  readonly cards: Readonly<Partial<Record<GameSeat, YachtScorecard>>>;
  readonly log: readonly YachtLogEntry[];
  readonly result: YachtMatchResult | null;
}

export interface YachtGameContract {
  readonly state: YachtGameState;
  readonly visible: YachtVisibleState;
  readonly result: YachtMatchResult;
  readonly options: YachtOptions;
}
