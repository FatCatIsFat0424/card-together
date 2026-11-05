import type { Card, GameClock, GamePresentation, ObserverView } from '../../types/game';
import type { Seat, PlayerInfo } from '../../types/player';
import type { RoomCode } from '../../types/room';
import type { ReplayRecording } from '../../types/replay';

export type SpadesTeam = 'NS' | 'EW';
export type SpadesAction = { readonly type: 'bid'; readonly bid: number } | { readonly type: 'play'; readonly card: Card };
export interface SpadesPlay { readonly seat: Seat; readonly card: Card }
export interface SpadesTrick { readonly plays: readonly SpadesPlay[]; readonly winner: Seat }
export interface SpadesPosition {
  readonly phase: 'bidding' | 'playing' | 'complete';
  readonly dealerSeat: Seat;
  readonly bids: Readonly<Record<Seat, number | null>>;
  readonly trick: readonly SpadesPlay[];
  readonly tricks: readonly SpadesTrick[];
  readonly taken: Readonly<Record<Seat, number>>;
  readonly broken: boolean;
  readonly currentTurnSeat: Seat | null;
}
export interface SpadesTeamScore {
  readonly contract: number;
  readonly tricks: number;
  readonly nilPoints: number;
  readonly contractPoints: number;
  readonly bagsAdded: number;
  readonly bagPenalty: number;
  readonly points: number;
  readonly bags: number;
}
export interface SpadesHandResult {
  readonly bids: Readonly<Record<Seat, number>>;
  readonly taken: Readonly<Record<Seat, number>>;
  readonly teams: Readonly<Record<SpadesTeam, SpadesTeamScore>>;
}
export interface SpadesMatchResult {
  readonly gameType: 'spades';
  readonly scores: Readonly<Record<SpadesTeam, number>>;
  readonly bags: Readonly<Record<SpadesTeam, number>>;
  readonly hands: readonly SpadesHandResult[];
  readonly winners: readonly Seat[];
}
export type SpadesLogEntry =
  | { readonly type: 'deal'; readonly dealerSeat: Seat; readonly timestamp: number }
  | { readonly type: 'bid'; readonly seat: Seat; readonly bid: number; readonly timestamp: number }
  | { readonly type: 'play'; readonly seat: Seat; readonly card: Card; readonly timestamp: number }
  | { readonly type: 'trick_end'; readonly winnerSeat: Seat; readonly cards: readonly Card[]; readonly cardSeats: readonly Seat[]; readonly timestamp: number }
  | { readonly type: 'hand_end'; readonly result: SpadesHandResult; readonly timestamp: number };
export interface SpadesGameState {
  replayRecording?: ReplayRecording;
  clock?: GameClock;
  presentation?: GamePresentation;
  returnedSeats?: Seat[];
  returnedViewers?: string[];
  readonly gameType: 'spades';
  readonly id: string;
  readonly startedAt: number;
  readonly players: Record<Seat, PlayerInfo>;
  readonly roomCode: RoomCode;
  phase: 'bidding' | 'playing' | 'scoring';
  position: SpadesPosition;
  hands: Record<Seat, Card[]>;
  scores: Record<SpadesTeam, number>;
  bags: Record<SpadesTeam, number>;
  handResults: SpadesHandResult[];
  log: SpadesLogEntry[];
  result: SpadesMatchResult | null;
}
export interface SpadesVisibleState extends ObserverView<Card> {
  clock?: GameClock;
  presentation?: GamePresentation;
  readonly gameType: 'spades';
  readonly phase: SpadesGameState['phase'];
  readonly mySeat: Seat;
  readonly myHand: readonly Card[];
  readonly handCounts: Readonly<Record<Seat, number>>;
  readonly position: SpadesPosition;
  readonly currentTurnSeat: Seat | null;
  readonly dealerSeat: Seat;
  readonly validCards: readonly Card[];
  readonly scores: Readonly<Record<SpadesTeam, number>>;
  readonly bags: Readonly<Record<SpadesTeam, number>>;
  readonly handResults: readonly SpadesHandResult[];
  readonly log: readonly SpadesLogEntry[];
  readonly result: SpadesMatchResult | null;
}
export interface SpadesGameContract {
  readonly state: SpadesGameState;
  readonly visible: SpadesVisibleState;
  readonly result: SpadesMatchResult;
  readonly options: Record<string, never>;
}
