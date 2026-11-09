import type { GameClock, GamePresentation, ObserverRole } from '../../types/game';
import type { GameSeat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';
import type { CbCode, CbVariant, CodeBreakerOptions } from '../../rules/codebreaker';

/** One resolved guess with the feedback it earned. */
export interface CodeBreakerGuess {
  readonly round: number;
  readonly code: CbCode;
  readonly exact: number;
  readonly partial: number;
  /** The server made this guess when the round timer ran out */
  readonly auto: boolean;
}

/** What every recipient may see of a resolved guess: who guessed in which round, and whether it cracked the code. */
export interface CodeBreakerPublicEntry {
  readonly seat: GameSeat;
  readonly round: number;
  readonly solved: boolean;
  readonly timestamp: number;
}

/** Server-side log entry; the guess itself stays private to its seat until the match ends. */
export type CodeBreakerLogEntry = CodeBreakerPublicEntry & CodeBreakerGuess;

export type CodeBreakerPhase = 'playing' | 'scoring';

export interface CodeBreakerMatchResult {
  readonly gameType: 'codebreaker';
  /** Seats that played, ordered N, E, S, W, P5–P8 */
  readonly seats: GameSeat[];
  readonly variant: CbVariant;
  readonly secret: number[];
  /** Guesses each seat used */
  readonly guesses: Partial<Record<GameSeat, number>>;
  /** Seats that cracked the code */
  readonly solved: GameSeat[];
  /** Solvers with the fewest guesses; empty when nobody solved */
  readonly winners: GameSeat[];
  readonly rounds: number;
}

export interface CodeBreakerGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'codebreaker';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly roomCode: RoomCode;
  readonly options: CodeBreakerOptions;
  phase: CodeBreakerPhase;
  /** Server only; the one code every seat is cracking, drawn fresh for each match */
  readonly secret: number[];
  /** 1-based round that is collecting guesses */
  round: number;
  readonly roundMs: number;
  roundDeadline: number;
  /** Server only; guesses submitted this round, held until the round resolves */
  pending: Partial<Record<GameSeat, number[] | null>>;
  /** Seats whose pending guess the server made at the deadline */
  pendingAuto: GameSeat[];
  /** Server only; resolved guesses in round and seat order */
  log: CodeBreakerLogEntry[];
  result: CodeBreakerMatchResult | null;
}

/** What others see of one seat: guesses used, whether it cracked the code, and whether it has guessed this round. */
export interface CodeBreakerProgress {
  readonly used: number;
  readonly solved: boolean;
  readonly submitted: boolean;
}

export interface CodeBreakerVisibleState {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly observer?: ObserverRole;
  readonly gameType: 'codebreaker';
  readonly phase: CodeBreakerPhase;
  readonly mySeat: GameSeat;
  /** Seats that play, ordered N, E, S, W, P5–P8 */
  readonly seats: readonly GameSeat[];
  readonly options: CodeBreakerOptions;
  readonly round: number;
  readonly roundDeadline: number;
  readonly progress: Partial<Record<GameSeat, CodeBreakerProgress>>;
  /** The recipient's own guess waiting for the round to resolve; null for seats outside the match */
  readonly pendingGuess: CbCode | null;
  /**
   * Resolved guesses the recipient may see: its own, every seat's once the match is over, and every seat's for
   * unseated spectators. Another seat's guesses are otherwise never sent.
   */
  readonly histories: Partial<Record<GameSeat, readonly CodeBreakerGuess[]>>;
  /** The code: revealed when the match is over and to unseated spectators, null before */
  readonly secret: CbCode | null;
  readonly log: readonly CodeBreakerPublicEntry[];
  readonly result: CodeBreakerMatchResult | null;
}

export interface CodeBreakerGameContract {
  readonly state: CodeBreakerGameState;
  readonly visible: CodeBreakerVisibleState;
  readonly result: CodeBreakerMatchResult;
  readonly options: CodeBreakerOptions;
}
