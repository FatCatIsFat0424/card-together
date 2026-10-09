import type { EmojiRecord } from '@shared/types';
import { isEmojiName } from '@shared/constants';
import type { SocketContext, TypedSocket } from './context';
import { actionError, requireRoom, runAction } from './context';
import * as playerManager from '../managers/player-manager';
import * as chatManager from '../managers/chat-manager';

export function registerChatHandlers(context: SocketContext, socket: TypedSocket): void {
  socket.on('chat:send', (payload, callback) => {
    if (typeof callback !== 'function') return;
    // A library read failure only drops emoji images; the message itself still sends.
    void context.listEmojis(socket.data.accountId).catch((): EmojiRecord[] => [])
      .then((library) => runAction(context, socket, callback, () => {
        const player = playerManager.getPlayerInfo(socket.data.accountId);
        if (!player) throw actionError('Player not found.');
        const roomCode = requireRoom(socket);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          throw actionError('Invalid chat payload.');
        }
        if ('stickerId' in payload) {
          if (typeof payload.stickerId !== 'string' || !payload.stickerId ||
            Object.keys(payload).some((key) => key !== 'stickerId')) {
            throw actionError('Invalid sticker payload.');
          }
          if (!chatManager.addSticker(roomCode, player, payload.stickerId, library)) {
            throw actionError('Sticker is not in your library.');
          }
        } else if ('providedSticker' in payload) {
          if (!isEmojiName(payload.providedSticker) ||
            Object.keys(payload).some((key) => key !== 'providedSticker')) {
            throw actionError('Invalid sticker payload.');
          }
          if (!chatManager.addProvidedSticker(roomCode, player, payload.providedSticker, context.providedEmojis)) {
            throw actionError('Sticker is not available.');
          }
        } else {
          const content = payload.message;
          if (typeof content !== 'string' || !content.trim() || content.trim().length > 500) {
            throw actionError('Messages must contain 1–500 characters.');
          }
          chatManager.addMessage(roomCode, player, content.trim(), library, context.providedEmojis);
        }
        return { success: true };
      }));
  });
}
