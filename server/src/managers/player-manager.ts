import type { AccountProfile, PlayerId, PlayerInfo, RoomCode } from '@shared/types';
import type { PersistedPlayer } from '../runtime/types';

interface PlayerState extends PersistedPlayer {
  socketId: string;
  connectionStatus: 'connected' | 'disconnected';
}

const players = new Map<PlayerId, PlayerState>();
const socketToPlayer = new Map<string, PlayerId>();

/** Only table-visible fields; account settings stay out of room and chat broadcasts. */
export function toPlayerInfo(account: AccountProfile): PlayerInfo {
  const { id, username, nickname, color, avatar, avatarImage } = account;
  return { id, username, nickname, color, avatar, avatarImage,
    avatarBorder: account.avatarBorder ?? null,
    ...(account.seatBackground ? { seatBackground: account.seatBackground } : {}),
  };
}

export function attachPlayer(socketId: string, info: PlayerInfo): void {
  const existing = players.get(info.id);
  players.set(info.id, {
    info,
    currentRoomCode: existing?.currentRoomCode ?? null,
    disconnectedAt: null,
    connectionStatus: 'connected',
    socketId,
  });
  socketToPlayer.set(socketId, info.id);
}

export function getPlayerIdBySocketId(socketId: string): PlayerId | null {
  return socketToPlayer.get(socketId) ?? null;
}

export function getPlayerInfo(playerId: PlayerId): PlayerInfo | null {
  return players.get(playerId)?.info ?? null;
}

export function getPlayerState(playerId: PlayerId): PlayerState | null {
  return players.get(playerId) ?? null;
}

export function updatePlayerInfo(info: PlayerInfo): void {
  const player = players.get(info.id);
  if (player) player.info = info;
}

export function setPlayerRoom(playerId: PlayerId, roomCode: RoomCode | null): void {
  const player = players.get(playerId);
  if (player) player.currentRoomCode = roomCode;
}

export function markDisconnected(socketId: string): void {
  const playerId = socketToPlayer.get(socketId);
  socketToPlayer.delete(socketId);
  if (!playerId) return;
  const player = players.get(playerId);
  if (!player) return;
  const remaining = [...socketToPlayer].find(([, id]) => id === playerId);
  player.socketId = remaining?.[0] ?? '';
  if (!remaining) {
    player.connectionStatus = 'disconnected';
    player.disconnectedAt = Date.now();
  }
}

export function getExpiredPlayers(timeoutMs: number): PlayerState[] {
  return [...players.values()].filter((player) =>
    player.connectionStatus === 'disconnected'
    && player.disconnectedAt !== null
    && Date.now() - player.disconnectedAt >= timeoutMs,
  );
}

export function removePlayer(playerId: PlayerId): void {
  for (const [socketId, id] of socketToPlayer) {
    if (id === playerId) socketToPlayer.delete(socketId);
  }
  players.delete(playerId);
}

export function exportPlayers(): PersistedPlayer[] {
  return [...players.values()].map(({ info, currentRoomCode, disconnectedAt }) => ({
    info, currentRoomCode, disconnectedAt,
  }));
}

export function restorePlayers(records: PersistedPlayer[], restarting = false): void {
  players.clear();
  if (restarting) socketToPlayer.clear();
  const ids = new Set(records.map((record) => record.info.id));
  for (const [socketId, id] of socketToPlayer) {
    if (!ids.has(id)) socketToPlayer.delete(socketId);
  }
  for (const record of records) {
    const socketId = [...socketToPlayer].find(([, id]) => id === record.info.id)?.[0] ?? '';
    players.set(record.info.id, {
      ...record,
      socketId,
      connectionStatus: socketId ? 'connected' : 'disconnected',
      disconnectedAt: socketId ? null : (restarting || record.disconnectedAt === null
        ? Date.now() : record.disconnectedAt),
    });
  }
}
