import type { Card, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { PlayerInfo, Seat } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

export interface GongZhuPlay { readonly seat: Seat; readonly card: Card }
export interface GongZhuTrick { readonly plays: readonly GongZhuPlay[]; readonly winner: Seat }
export interface GongZhuHand {
  readonly hand: number;
  readonly captures: Record<Seat, Card[]>;
  readonly scores: Record<Seat, number>;
}
export type GongZhuLogEntry =
  | { readonly type: 'deal'; readonly hand: number; readonly first: Seat; readonly timestamp: number }
  | { readonly type: 'play'; readonly seat: Seat; readonly card: Card; readonly timestamp: number }
  | { readonly type: 'trick'; readonly winner: Seat; readonly plays: readonly GongZhuPlay[]; readonly timestamp: number }
  | { readonly type: 'settle'; readonly hand: number; readonly scores: Record<Seat, number>; readonly timestamp: number };
export interface GongZhuMatchResult {
  readonly gameType: 'gongzhu';
  readonly scores: Record<Seat, number>;
  readonly winners: Seat[];
  readonly hands: number;
  readonly handResults: GongZhuHand[];
}
export interface GongZhuGameState {
  readonly gameType: 'gongzhu';
  readonly id: string;
  readonly roomCode: RoomCode;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: Seat[];
  returnedViewers?: string[];
  phase: 'playing' | 'scoring';
  hand: number;
  hands: Record<Seat, Card[]>;
  captures: Record<Seat, Card[]>;
  trick: GongZhuPlay[];
  tricks: GongZhuTrick[];
  currentTurnSeat: Seat;
  scores: Record<Seat, number>;
  handResults: GongZhuHand[];
  log: GongZhuLogEntry[];
  result: GongZhuMatchResult | null;
}
export interface GongZhuVisibleState extends ObserverView<Card> {
  readonly gameType: 'gongzhu';
  readonly phase: 'playing' | 'scoring';
  readonly mySeat: Seat;
  readonly myHand: readonly Card[];
  readonly validCards: readonly Card[];
  readonly handCounts: Record<Seat, number>;
  readonly hand: number;
  readonly captures: Readonly<Record<Seat, readonly Card[]>>;
  readonly trick: readonly GongZhuPlay[];
  readonly tricks: readonly GongZhuTrick[];
  readonly currentTurnSeat: Seat;
  readonly scores: Readonly<Record<Seat, number>>;
  readonly handResults: readonly GongZhuHand[];
  readonly log: readonly GongZhuLogEntry[];
  readonly result: GongZhuMatchResult | null;
  clock?: GameClock;
  presentation?: GamePresentation;
}
export interface GongZhuGameContract {
  readonly state: GongZhuGameState;
  readonly visible: GongZhuVisibleState;
  readonly result: GongZhuMatchResult;
  readonly options: Record<string, never>;
}
