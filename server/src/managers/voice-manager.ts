import { randomUUID } from 'node:crypto';
import { MAX_ROOM_MEMBERS } from '@shared/constants';
import type { VoiceParticipant, VoiceRoomState, VoiceSettings } from '@shared/types';

export interface VoicePeer extends VoiceParticipant {
  readonly socketId: string;
  readonly roomCode: string;
}

type JoinResult = { success: true; peer: VoicePeer } | { success: false; error: string };

export interface VoiceManager {
  join(socketId: string, accountId: string, roomCode: string, settings: VoiceSettings): JoinResult;
  settings(socketId: string, settings: VoiceSettings): VoicePeer | null;
  leave(socketId: string): VoicePeer | null;
  bySocket(socketId: string): VoicePeer | null;
  byPeer(peerId: string): VoicePeer | null;
  byAccount(accountId: string): VoicePeer | null;
  state(roomCode: string): VoiceRoomState;
  peers(roomCode: string): VoicePeer[];
}

/** Per-application, ephemeral signaling presence. No audio or database records are retained. */
export function createVoiceManager(): VoiceManager {
  const peers = new Map<string, VoicePeer>();
  const bySocket = new Map<string, string>();
  const byAccount = new Map<string, string>();

  function findSocket(socketId: string): VoicePeer | null {
    const peerId = bySocket.get(socketId);
    return peerId ? peers.get(peerId) ?? null : null;
  }

  function roomPeers(roomCode: string): VoicePeer[] {
    return [...peers.values()].filter((peer) => peer.roomCode === roomCode);
  }

  return {
    join(socketId, accountId, roomCode, settings): JoinResult {
      const existingId = byAccount.get(accountId);
      const existing = existingId ? peers.get(existingId) : undefined;
      if (existing && (existing.socketId !== socketId || existing.roomCode !== roomCode)) {
        return { success: false, error: 'Voice is already active in another tab. Leave it there first.' };
      }
      if (!existing && roomPeers(roomCode).length >= MAX_ROOM_MEMBERS) {
        return { success: false, error: 'This voice room is full.' };
      }
      const peer: VoicePeer = { peerId: existing?.peerId ?? randomUUID(), socketId,
        accountId, roomCode, muted: settings.muted, deafened: settings.deafened };
      peers.set(peer.peerId, peer);
      bySocket.set(socketId, peer.peerId);
      byAccount.set(accountId, peer.peerId);
      return { success: true, peer };
    },
    settings(socketId, settings): VoicePeer | null {
      const previous = findSocket(socketId);
      if (!previous) return null;
      const peer = { ...previous, muted: settings.muted, deafened: settings.deafened };
      peers.set(peer.peerId, peer);
      return peer;
    },
    leave(socketId): VoicePeer | null {
      const peer = findSocket(socketId);
      if (!peer) return null;
      peers.delete(peer.peerId);
      bySocket.delete(socketId);
      byAccount.delete(peer.accountId);
      return peer;
    },
    bySocket: findSocket,
    byPeer: (peerId): VoicePeer | null => peers.get(peerId) ?? null,
    byAccount: (accountId): VoicePeer | null => {
      const peerId = byAccount.get(accountId);
      return peerId ? peers.get(peerId) ?? null : null;
    },
    peers: roomPeers,
    state: (roomCode): VoiceRoomState => ({
      roomCode,
      participants: roomPeers(roomCode).map(({ peerId, accountId, muted, deafened }) => ({
        peerId, accountId, muted, deafened,
      })),
    }),
  };
}
