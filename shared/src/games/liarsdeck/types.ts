import type { GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { PlayerInfo, Seat } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

export type LiarTableFace = 'K' | 'Q' | 'A';

export type LiarFace = LiarTableFace | 'joker';

/** `id` identifies one of the 20 deck cards; several cards share each face. */
export interface LiarCard {
  readonly id: number;
  readonly face: LiarFace;
}

/** Plays never name their cards; only the challenged play is revealed. */
export type LiarsDeckLogEntry =
  | {
    readonly type: 'round';
    readonly round: number;
    readonly tableFace: LiarTableFace;
    readonly starter: Seat;
    readonly timestamp: number;
  }
  | { readonly type: 'play'; readonly seat: Seat; readonly count: number; readonly timestamp: number }
  | {
    readonly type: 'challenge';
    readonly seat: Seat;
    readonly target: Seat;
    readonly revealed: LiarFace[];
    readonly lied: boolean;
    readonly timestamp: number;
  }
  /** `shot` is the seat's trigger pull count including this one */
  | { readonly type: 'shot'; readonly seat: Seat; readonly shot: number; readonly survived: boolean; readonly timestamp: number };

export interface LiarsDeckMatchResult {
  readonly gameType: 'liarsdeck';
  readonly winnerSeat: Seat;
  /** In elimination order */
  readonly eliminationOrder: Seat[];
  readonly shots: Record<Seat, number>;
  readonly rounds: number;
}

export type LiarsDeckPhase = 'playing' | 'scoring';

export interface LiarsDeckLastPlay {
  readonly seat: Seat;
  readonly count: number;
}

export interface LiarsDeckGameState {
  /** Server-only recording, absent on games started without recording. */
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: Seat[];
  /** Spectator account ids that already left the finished board for the room. */
  returnedViewers?: string[];
  readonly gameType: 'liarsdeck';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: LiarsDeckPhase;
  hands: Record<Seat, LiarCard[]>;
  /** Server only; this round's face-down cards in play order, so the last play is its tail */
  pile: LiarCard[];
  lastPlay: LiarsDeckLastPlay | null;
  tableFace: LiarTableFace;
  round: number;
  currentTurnSeat: Seat;
  /** Server only; the trigger pull (1–6) that fires each seat's bullet */
  bullets: Record<Seat, number>;
  shots: Record<Seat, number>;
  /** In elimination order */
  eliminated: Seat[];
  log: LiarsDeckLogEntry[];
  result: LiarsDeckMatchResult | null;
}

export interface LiarsDeckVisibleState extends ObserverView<LiarCard> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'liarsdeck';
  readonly phase: LiarsDeckPhase;
  readonly mySeat: Seat;
  readonly myHand: readonly LiarCard[];
  /** Cards this seat played face down during the current round */
  readonly myPlayed: readonly LiarCard[];
  readonly handCounts: Record<Seat, number>;
  readonly pileCount: number;
  readonly lastPlay: LiarsDeckLastPlay | null;
  readonly tableFace: LiarTableFace;
  readonly round: number;
  readonly currentTurnSeat: Seat;
  readonly shots: Record<Seat, number>;
  readonly eliminated: readonly Seat[];
  readonly log: readonly LiarsDeckLogEntry[];
  readonly result: LiarsDeckMatchResult | null;
}

export interface LiarsDeckGameContract {
  readonly state: LiarsDeckGameState;
  readonly visible: LiarsDeckVisibleState;
  readonly result: LiarsDeckMatchResult;
  readonly options: Record<string, never>;
}
