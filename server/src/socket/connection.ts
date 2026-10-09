import { RECONNECT_TIMEOUT_MS } from '@shared/constants';
import type { AccountProfile } from '@shared/types';
import type { SocketContext } from './context';
import { affectedAccounts, broadcastState, leaveCurrentRoom, playerSnapshot, runAction } from './context';
import * as playerManager from '../managers/player-manager';
import * as roomManager from '../managers/room-manager';
import { registerRoomHandlers } from './room-handler';
import { registerGameHandlers, systemLine } from './game-handler';
import { registerChatHandlers } from './chat-handler';
import { leaveVoice, reconcileVoiceMembership, registerVoiceHandlers } from './voice-handler';

interface RateWindow {
  count: number;
  resetAt: number;
}

type RateKind = 'action' | 'voice' | 'chat';

/** Per-account budgets shared by every tab; voice negotiation has its own larger budget. */
export const SOCKET_RATE_LIMITS: Readonly<Record<RateKind, { readonly limit: number; readonly windowMs: number }>> = {
  action: { limit: 240, windowMs: 60_000 },
  voice: { limit: 1200, windowMs: 60_000 },
  chat: { limit: 5, windowMs: 5_000 },
};

function packetKinds(event: unknown): RateKind[] {
  if (typeof event === 'string' && event.startsWith('voice:')) return ['voice'];
  return event === 'chat:send' ? ['action', 'chat'] : ['action'];
}

export function setupConnectionHandler(context: SocketContext): () => void {
  const { io, auth, runtime } = context;
  let closing = false;
  const rates = new Map<string, Map<RateKind, RateWindow>>();

  /** Counts the packet only when every applicable budget still has room. */
  function allowPacket(accountId: string, kinds: readonly RateKind[], now: number): boolean {
    let windows = rates.get(accountId);
    if (!windows) rates.set(accountId, windows = new Map());
    const current = kinds.map((kind) => {
      let window = windows.get(kind);
      if (!window || now >= window.resetAt) {
        window = { count: 0, resetAt: now + SOCKET_RATE_LIMITS[kind].windowMs };
        windows.set(kind, window);
      }
      return { kind, window };
    });
    if (current.some(({ kind, window }) => window.count >= SOCKET_RATE_LIMITS[kind].limit)) return false;
    for (const { window } of current) window.count += 1;
    return true;
  }
  io.use((socket, next) => {
    void auth.resolveSession(socket.handshake.headers.cookie).then((session) => {
      if (!session) { next(new Error('Sign in to play.')); return; }
      socket.data = {
        accountId: session.account.id, tokenHash: session.session.tokenHash,
        cookie: socket.handshake.headers.cookie ?? '', expiresAt: session.session.expiresAt,
      };
      next();
    }).catch(() => next(new Error('Unable to authenticate.')));
  });

  io.on('connection', (socket) => {
    void socket.join(`account:${socket.data.accountId}`);
    const expiry = setTimeout(() => socket.disconnect(true),
      Math.max(0, socket.data.expiresAt - Date.now()));
    expiry.unref();
    socket.use((packet, next) => {
      if (!allowPacket(socket.data.accountId, packetKinds(packet[0]), Date.now())) {
        const callback: unknown = packet[packet.length - 1];
        if (typeof callback === 'function') callback({ success: false, error: 'Too many actions. Please slow down.' });
        return;
      }
      next();
    });

    registerRoomHandlers(context, socket);
    registerGameHandlers(context, socket);
    registerChatHandlers(context, socket);
    registerVoiceHandlers(context, socket);
    socket.on('player:resume', (callback) => runAction(context, socket, callback, () =>
      playerSnapshot(socket.data.accountId), { skipUnchanged: true }));

    socket.on('disconnect', () => {
      clearTimeout(expiry);
      if (closing) { context.voice.leave(socket.id); return; }
      leaveVoice(context, socket.id, 'Voice connection closed.');
      const recipients = new Set<string>();
      void runtime.mutate(() => {
        for (const id of affectedAccounts(socket.data.accountId)) recipients.add(id);
        playerManager.markDisconnected(socket.id);
      }, { skipUnchanged: true, afterCommit: () => broadcastState(io, recipients) })
        .catch((error: unknown) => console.error('[disconnect]', error));
    });
  });

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [accountId, windows] of rates) {
      if ([...windows.values()].every((window) => now >= window.resetAt)) rates.delete(accountId);
    }
    if (closing || (playerManager.getExpiredPlayers(RECONNECT_TIMEOUT_MS).length === 0
      && !roomManager.hasExpiredAbortVote(Date.now()))) return;
    const recipients = new Set<string>();
    void runtime.mutate(() => {
      for (const { code, startedBy } of roomManager.expireAbortVotes(Date.now())) {
        for (const id of roomManager.getRoomMemberIds(code)) recipients.add(id);
        systemLine(code, startedBy, 'abortVote.failed');
      }
      for (const player of playerManager.getExpiredPlayers(RECONNECT_TIMEOUT_MS)) {
        for (const id of affectedAccounts(player.info.id)) recipients.add(id);
        leaveCurrentRoom(player.info.id);
        playerManager.removePlayer(player.info.id);
      }
    }, { skipUnchanged: true,
      afterCommit: () => {
        reconcileVoiceMembership(context, recipients);
        broadcastState(io, recipients);
      },
    }).catch((error: unknown) => console.error('[cleanup]', error));
  }, 5_000);
  cleanup.unref();

  return (): void => {
    closing = true;
    clearInterval(cleanup);
  };
}

export async function updateConnectedProfile(
  context: SocketContext,
  account: AccountProfile,
): Promise<void> {
  const recipients = new Set<string>();
  const info = playerManager.toPlayerInfo(account);
  await context.runtime.mutate(() => {
    for (const id of affectedAccounts(account.id)) recipients.add(id);
    playerManager.updatePlayerInfo(info);
    roomManager.updateRoomPlayer(info,
      playerManager.getPlayerState(account.id)?.currentRoomCode ?? null);
  }, { skipUnchanged: true, afterCommit: () => broadcastState(context.io, recipients) });
}
