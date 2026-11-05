import type { Card, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { GameSeat, PlayerInfo, Seat } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

export type HeartsPass = 'left' | 'right' | 'across' | 'hold';
export type HeartsAction = { readonly type: 'pass'; readonly cards: readonly Card[] }
  | { readonly type: 'play'; readonly card: Card };
export interface HeartsPlay { readonly seat: Seat; readonly card: Card }
export interface HeartsTrick { readonly leadSeat: Seat; readonly plays: readonly HeartsPlay[] }
export interface HeartsTrickRecord extends HeartsTrick { readonly winner: Seat }
export interface HeartsHandScore {
  readonly penalties: Record<Seat, number>;
  readonly added: Record<Seat, number>;
  readonly moon: Seat | null;
}
export type HeartsLogEntry =
  | { readonly type: 'deal'; readonly hand: number; readonly timestamp: number }
  | { readonly type: 'pass'; readonly seat: Seat; readonly timestamp: number }
  | { readonly type: 'play'; readonly seat: Seat; readonly card: Card; readonly timestamp: number }
  | { readonly type: 'trick_end'; readonly trick: HeartsTrickRecord; readonly timestamp: number }
  | { readonly type: 'hand_end'; readonly hand: number; readonly score: HeartsHandScore;
      readonly totals: Record<Seat, number>; readonly timestamp: number };
export interface HeartsMatchResult {
  readonly gameType: 'hearts';
  readonly scores: Record<Seat, number>;
  readonly winners: Seat[];
  readonly hands: HeartsHandScore[];
}
/** Private evidence for restoring and validating every hand; never sent to participants or bots. */
export interface HeartsDeal {
  readonly hands: Record<Seat, Card[]>;
  readonly passes: Partial<Record<Seat, Card[]>>;
}
export interface HeartsGameState {
  readonly gameType: 'hearts';
  readonly id: string;
  readonly startedAt: number;
  readonly roomCode: RoomCode;
  readonly players: Record<Seat, PlayerInfo>;
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: GameSeat[];
  returnedViewers?: string[];
  phase: 'passing' | 'playing' | 'scoring';
  hand: number;
  hands: Record<Seat, Card[]>;
  deals: HeartsDeal[];
  passDeadline: number | null;
  readonly passDurationMs: number;
  heartsBroken: boolean;
  currentTurnSeat: Seat | null;
  trick: HeartsTrick | null;
  tricks: HeartsTrickRecord[];
  scores: Record<Seat, number>;
  log: HeartsLogEntry[];
  result: HeartsMatchResult | null;
}
export interface HeartsVisibleState extends ObserverView<Card> {
  readonly gameType: 'hearts';
  readonly phase: HeartsGameState['phase'];
  readonly mySeat: Seat;
  readonly myHand: readonly Card[];
  readonly handCounts: Record<Seat, number>;
  readonly hand: number;
  readonly passDirection: HeartsPass;
  readonly passedSeats: readonly Seat[];
  readonly myPass: readonly Card[];
  readonly passDeadline: number | null;
  readonly heartsBroken: boolean;
  readonly currentTurnSeat: Seat | null;
  readonly trick: HeartsTrick | null;
  readonly tricks: readonly HeartsTrickRecord[];
  readonly scores: Record<Seat, number>;
  readonly validCards: readonly Card[];
  readonly log: readonly HeartsLogEntry[];
  readonly result: HeartsMatchResult | null;
  clock?: GameClock;
  presentation?: GamePresentation;
}
export interface HeartsGameContract {
  readonly state: HeartsGameState;
  readonly visible: HeartsVisibleState;
  readonly result: HeartsMatchResult;
  readonly options: Record<string, never>;
}
