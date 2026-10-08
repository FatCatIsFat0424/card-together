// ─── 房間型別定義 ───

import type { PlayerInfo, Seat } from './player';

/** 房間代碼（6 碼英數字） */
export type RoomCode = string;

/** 遊戲類型 */
export type GameType = 'bridge' | 'bigtwo' | 'redpoints' | 'ninetynine';

/** 房間狀態 */
export type RoomStatus = 'waiting' | 'playing';

/** 座位資訊 */
export interface SeatInfo {
  readonly player: PlayerInfo | null;
  readonly isReady: boolean;
}

/** 座位表：四個方位的座位狀態 */
export type SeatMap = Record<Seat, SeatInfo>;

/** 進行中的投票終止對局（帳號 id） */
export interface AbortVoteInfo {
  readonly startedBy: string;
  readonly startedAt: number;
  readonly expiresAt: number;
  readonly yes: readonly string[];
  readonly no: readonly string[];
}

export interface TimeControl {
  readonly baseSeconds: number;
  readonly bankSeconds: number;
}

/** 房間資訊（對外暴露） */
export interface RoomInfo {
  /** Missing only on legacy snapshots. */
  readonly timeControl?: TimeControl;
  readonly code: RoomCode;
  readonly gameType: GameType;
  readonly status: RoomStatus;
  readonly seats: SeatMap;
  readonly createdAt: number;
  /** 房主：建立者；離開時改由加入順序中下一位成員擔任 */
  readonly hostId: string;
  readonly abortVote: AbortVoteInfo | null;
  readonly abortVoteCooldownUntil: number | null;
}
