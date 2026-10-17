import type { AnyGameState, ChatMessage, PlayerInfo, RoomInfo } from '@shared/types';

export interface PersistedPlayer {
  info: PlayerInfo;
  currentRoomCode: string | null;
  disconnectedAt: number | null;
  /** Overrides activity inferred from disconnectedAt; null marks a restore-only grace period. */
  lastSeenAt?: number | null;
}

export interface PersistedRoom {
  info: RoomInfo;
  memberIds: string[];
}

export interface RuntimeSnapshot {
  players: PersistedPlayer[];
  rooms: PersistedRoom[];
  games: AnyGameState[];
  chat: { roomCode: string; messages: ChatMessage[] }[];
}
