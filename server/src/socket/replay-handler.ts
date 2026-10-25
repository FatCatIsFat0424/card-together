import { isReplayRecordId } from '@shared/replay-session';
import type { SocketContext, TypedSocket } from './context';
import { actionError, requireRoom, requireSuccess, runAction } from './context';
import { MATCH_REPLAY_ERRORS } from '../social/match-history-access';
import { matchSummary } from '../http/match-summary';
import * as playerManager from '../managers/player-manager';
import * as roomManager from '../managers/room-manager';
import * as gameManager from '../managers/game-manager';
import * as chatManager from '../managers/chat-manager';

function announce(code: string, accountId: string, key: 'replay.sharedStarted' | 'replay.sharedEnded'): void {
  const player = playerManager.getPlayerInfo(accountId);
  if (player) chatManager.addSystemMessage(code, player, key);
}

/** Room-wide replay sessions: the host starts and controls playback; every member watches. */
export function registerReplayHandlers(context: SocketContext, socket: TypedSocket): void {
  socket.on('room:replay:start', (payload, callback) => runAction(context, socket, callback, async () => {
    if (!payload || !isReplayRecordId(payload.subjectId) || !isReplayRecordId(payload.matchId)) {
      throw actionError('Choose a match to replay.');
    }
    const accountId = socket.data.accountId;
    const code = requireRoom(socket);
    const room = roomManager.getRoomInfo(code);
    if (!room) throw actionError('Room not found.');
    if (room.hostId !== accountId) throw actionError('Only the host can control the replay.');
    if (room.status !== 'waiting') throw actionError('Replays start from the waiting room.');
    // The runtime queue is held during the lookup, so the room cannot change before the start.
    const lookup = await context.matchReplays.find(accountId, payload.subjectId, payload.matchId);
    if (lookup.status !== 'found') throw actionError(MATCH_REPLAY_ERRORS[lookup.status]);
    const { replay } = lookup;
    requireSuccess(roomManager.startReplay(code, accountId, {
      matchId: lookup.match.id, subjectId: payload.subjectId, gameType: replay.gameType, lastStep: replay.steps.length,
    }, Date.now()));
    // A finished board still on screen is historical; the replay takes its place for everyone.
    gameManager.removeGame(code);
    announce(code, accountId, 'replay.sharedStarted');
    return { success: true };
  }));

  socket.on('room:replay:control', (payload, callback) => runAction(context, socket, callback, () => {
    requireSuccess(roomManager.controlReplay(requireRoom(socket), socket.data.accountId, payload, Date.now()));
    return { success: true };
  }));

  socket.on('room:replay:end', (callback) => runAction(context, socket, callback, () => {
    const code = requireRoom(socket);
    requireSuccess(roomManager.endReplay(code, socket.data.accountId));
    announce(code, socket.data.accountId, 'replay.sharedEnded');
    return { success: true };
  }));

  // Members load the archive under the session's room-scoped authorization; the host's history
  // permission was checked when the session started. Archives never enter room broadcasts.
  socket.on('room:replay:load', (callback) => {
    if (typeof callback !== 'function') return;
    const accountId = socket.data.accountId;
    void (async () => {
      const session = await context.auth.resolveSession(socket.data.cookie);
      if (!session || session.account.id !== accountId || !socket.connected) {
        throw actionError('Your session has expired. Please sign in again.');
      }
      const replaySession = await context.runtime.inspect(() => {
        const code = playerManager.getPlayerState(accountId)?.currentRoomCode;
        if (!code || !roomManager.getRoomMemberIds(code).includes(accountId)) throw actionError('Join a room first.');
        const current = roomManager.getRoomInfo(code)?.replay;
        if (!current) throw actionError('No replay in progress.');
        return current;
      });
      const lookup = await context.matchReplays.find(null, replaySession.subjectId, replaySession.matchId);
      if (lookup.status !== 'found') throw actionError(MATCH_REPLAY_ERRORS.replayNotFound);
      const players = await context.matchReplays.players([lookup.match]);
      callback({ success: true, archive: { match: matchSummary(lookup.match), replay: lookup.replay, players } });
    })().catch((error: unknown) => {
      if (error instanceof Error && 'publicMessage' in error && typeof error.publicMessage === 'string') {
        callback({ success: false, error: error.publicMessage });
      } else {
        console.error('[room:replay:load]', error);
        callback({ success: false, error: 'Unable to load the replay. Please try again.' });
      }
    });
  });
}
