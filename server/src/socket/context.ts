import type { Server, Socket } from 'socket.io';
import type { ChatMessage, ClientToServerEvents, EmojiRecord, ServerToClientEvents } from '@shared/types';
import type { PlayerSnapshot } from '@shared/types/socket-events';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import type { AuthService } from '../auth/auth-service';
import type { RuntimeCoordinator, RuntimeMutationOptions } from '../runtime/coordinator';
import type { VoiceManager } from '../managers/voice-manager';
import type { FriendService } from '../social/friend-service';
import type { ProvidedEmojiCatalog } from '../media/provided-emoji';
import { reconcileVoiceMembership } from './voice-handler';
import * as playerManager from '../managers/player-manager';
import * as roomManager from '../managers/room-manager';
import * as gameManager from '../managers/game-manager';
import * as chatManager from '../managers/chat-manager';

export interface ConnectionData {
  accountId: string;
  tokenHash: string;
  cookie: string;
  expiresAt: number;
}

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, ConnectionData>;
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, ConnectionData>;

export interface ActionResponse extends PlayerSnapshot {
  roomCode?: string;
}

export interface SocketContext {
  io: TypedServer;
  runtime: RuntimeCoordinator;
  auth: AuthService;
  voice: VoiceManager;
  /** Sender's custom emoji library, read before a chat message is stored. */
  listEmojis: (accountId: string) => Promise<EmojiRecord[]>;
  /** Site-provided emoji every sender may use; the sender's library wins on name clashes. */
  providedEmojis: ProvidedEmojiCatalog;
  friends: FriendService;
}

export function actionError(message: string): Error & { publicMessage: string } {
  return Object.assign(new Error(message), { publicMessage: message });
}

export function requireSuccess(result: { success: boolean; reason?: string }): void {
  if (!result.success) throw actionError(result.reason ?? 'Unable to complete this action.');
}

/**
 * Accounts with god view during a match: human spectators and seats whose elimination
 * every player has already seen. Empty outside a match.
 */
export function observerIds(code: string): string[] {
  const room = roomManager.getRoomInfo(code);
  if (room?.status !== 'playing') return [];
  const eliminated = SEAT_ORDER_CLOCKWISE.flatMap((seat) => {
    const player = room.seats[seat].player;
    return player && !player.isBot && gameManager.isEliminationShown(code, seat) ? [player.id] : [];
  });
  return [...roomManager.getSpectatorIds(code), ...eliminated];
}

/** Seats still playing a match never receive observers' messages. */
function hidesObserverChat(code: string, accountId: string, observers: readonly string[]): boolean {
  return roomManager.getRoomInfo(code)?.status === 'playing' && roomManager.getPlayerSeat(code, accountId) !== null
    && !observers.includes(accountId);
}

/** The room history this account may read. */
export function visibleChatHistory(code: string, accountId: string): ChatMessage[] {
  const history = chatManager.getChatHistory(code);
  return hidesObserverChat(code, accountId, observerIds(code))
    ? history.filter((message) => message.audience !== 'observers') : history;
}

/** Full snapshot; `includeChat` false omits history so broadcasts can send chat deltas. */
export function playerSnapshot(accountId: string, includeChat = true): PlayerSnapshot {
  const state = playerManager.getPlayerState(accountId);
  if (!state) return { success: false, error: 'Player is not connected.' };
  const info = state.currentRoomCode ? roomManager.getRoomInfo(state.currentRoomCode) : null;
  const seat = info ? roomManager.getPlayerSeat(info.code, accountId) : null;
  const viewing = info && (seat ? gameManager.isViewingGame(info.code, seat, accountId)
    : gameManager.isSpectating(info.code, accountId));
  const gameState = info && viewing ? gameManager.getRecipientVisibleState(info.code, seat) : null;
  const room = info && {
    ...info,
    spectators: roomManager.getSpectatorIds(info.code).flatMap((id) => playerManager.getPlayerInfo(id) ?? []),
    observerIds: observerIds(info.code),
  };
  return {
    success: true, player: state.info, room: room ?? undefined,
    gameState: gameState ?? undefined,
    ...(includeChat ? { chatHistory: room ? visibleChatHistory(room.code, accountId) : [] } : {}),
  };
}

/** Last chat state delivered to each account's channel, per server instance. */
interface ChatCursor {
  readonly roomCode: string | null;
  readonly lastId: string | null;
  /** Whether observers' messages were withheld; a change resends the full history. */
  readonly filtered: boolean;
}

const chatCursors = new WeakMap<TypedServer, Map<string, ChatCursor>>();

/** Returns the full history when the room changed or the cursor fell out of history. */
function chatUpdate(
  cursor: ChatCursor | undefined, roomCode: string | null, history: readonly ChatMessage[], filtered: boolean,
): { readonly history: ChatMessage[] } | { readonly messages: ChatMessage[] } {
  if (!cursor || cursor.roomCode !== roomCode || cursor.filtered !== filtered) return { history: [...history] };
  if (cursor.lastId === null) return { messages: [...history] };
  const index = history.findIndex((message) => message.id === cursor.lastId);
  return index < 0 ? { history: [...history] } : { messages: history.slice(index + 1) };
}

/** Live presence for friend lists, read in runtime queue order. */
export function readPresence(
  runtime: RuntimeCoordinator, accountIds: readonly string[],
): Promise<Map<string, { online: boolean; inRoom: boolean }>> {
  return runtime.inspect(() => new Map(accountIds.map((id) => {
    const state = playerManager.getPlayerState(id);
    return [id, { online: state?.connectionStatus === 'connected', inRoom: Boolean(state?.currentRoomCode) }];
  })));
}

export function affectedAccounts(accountId: string): Set<string> {
  const accounts = new Set([accountId]);
  const code = playerManager.getPlayerState(accountId)?.currentRoomCode;
  if (code) {
    for (const id of roomManager.getRoomMemberIds(code)) accounts.add(id);
  }
  return accounts;
}

/**
 * Sends each account its filtered snapshot. Chat history is included only when the room
 * changes; otherwise new messages follow as `chat:message` deltas.
 */
export function broadcastState(io: TypedServer, accountIds: Iterable<string>): void {
  let cursors = chatCursors.get(io);
  if (!cursors) chatCursors.set(io, cursors = new Map());
  for (const accountId of new Set(accountIds)) {
    const channel = `account:${accountId}`;
    if (!io.sockets.adapter.rooms.has(channel)) {
      // Reconnecting tabs resume with full history, so the next broadcast starts fresh.
      cursors.delete(accountId);
      continue;
    }
    const snapshot = playerSnapshot(accountId, false);
    const roomCode = snapshot.room?.code ?? null;
    const filtered = roomCode !== null && hidesObserverChat(roomCode, accountId, snapshot.room?.observerIds ?? []);
    const history = roomCode ? chatManager.getChatHistory(roomCode)
      .filter((message) => !filtered || message.audience !== 'observers') : [];
    const update = snapshot.success ? chatUpdate(cursors.get(accountId), roomCode, history, filtered) : null;
    if (update && 'history' in update) snapshot.chatHistory = update.history;
    if (snapshot.success) cursors.set(accountId, { roomCode, lastId: history.at(-1)?.id ?? null, filtered });
    else cursors.delete(accountId);
    io.to(channel).emit('player:state', snapshot);
    if (roomCode && update && 'messages' in update) {
      for (const message of update.messages) io.to(channel).emit('chat:message', { roomCode, message });
    }
  }
}

export function runAction(
  context: SocketContext,
  socket: TypedSocket,
  callback: (response: ActionResponse) => void,
  action: () => ActionResponse,
  options: RuntimeMutationOptions = {},
): void {
  if (typeof callback !== 'function') return;
  const recipients = new Set<string>();
  void context.runtime.mutate(async (): Promise<ActionResponse> => {
    const session = await context.auth.resolveSession(socket.data.cookie);
    if (!session || session.account.id !== socket.data.accountId || !socket.connected) {
      throw actionError('Your session has expired. Please sign in again.');
    }
    const info = playerManager.toPlayerInfo(session.account);
    if (!playerManager.getPlayerIdBySocketId(socket.id)) {
      playerManager.attachPlayer(socket.id, info);
    }
    for (const id of affectedAccounts(session.account.id)) recipients.add(id);
    playerManager.updatePlayerInfo(info);
    roomManager.updateRoomPlayer(info,
      playerManager.getPlayerState(session.account.id)?.currentRoomCode ?? null);
    const response = action();
    for (const id of affectedAccounts(session.account.id)) recipients.add(id);
    return response;
  }, { ...options, afterCommit: () => {
    reconcileVoiceMembership(context, recipients);
    // Broadcast while the queue still holds this committed state.
    broadcastState(context.io, recipients);
    options.afterCommit?.();
  } }).then((response) => {
    callback(response);
  }).catch((error: unknown) => {
    if (error instanceof Error && 'publicMessage' in error && typeof error.publicMessage === 'string') {
      callback({ success: false, error: error.publicMessage });
    } else {
      console.error('[socket] Failed to commit action:', error);
      callback({ success: false, error: 'Unable to save your changes. Please try again.' });
    }
  });
}

export function requireRoom(socket: TypedSocket): string {
  const state = playerManager.getPlayerState(socket.data.accountId);
  if (!state?.currentRoomCode) throw actionError('Join a room first.');
  return state.currentRoomCode;
}

/** Rooms left without any human member; normally removed on leave, swept as a safety net. */
export function findAbandonedRooms(): string[] {
  return roomManager.findAbandonedRooms((accountId, code) =>
    playerManager.getPlayerState(accountId)?.currentRoomCode === code);
}

export function removeAbandonedRooms(): string[] {
  const codes = findAbandonedRooms();
  for (const code of codes) {
    gameManager.removeGame(code);
    roomManager.removeRoom(code);
    chatManager.clearRoomChat(code);
  }
  return codes;
}

export function leaveCurrentRoom(accountId: string): void {
  const code = playerManager.getPlayerState(accountId)?.currentRoomCode;
  if (!code) return;
  const seat = roomManager.getPlayerSeat(code, accountId);
  // A spectator's departure never affects the match.
  if (seat && roomManager.getRoomInfo(code)?.status === 'playing') {
    gameManager.abortGame(code);
    roomManager.setRoomStatus(code, 'waiting');
    roomManager.resetAllReady(code);
  }
  if (seat) gameManager.returnFromResult(code, seat);
  const { roomEmpty } = roomManager.leaveRoom(code, accountId);
  playerManager.setPlayerRoom(accountId, null);
  if (roomEmpty) {
    gameManager.removeGame(code);
    chatManager.clearRoomChat(code);
  }
}
