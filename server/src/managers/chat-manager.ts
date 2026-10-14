// ─── Chat Manager ───

import type {
  RoomCode, ChatMessage, EmojiRecord, PlayerInfo, ProvidedEmoji, ShopStickerId,
} from '@shared/types';

/** `observers` limits a message to spectators and eliminated players during a match. */
export type ChatAudience = ChatMessage['audience'];
import { generateMessageId } from '../utils/id-generator';
import { resolveMessageEmojis } from '../media/message-content';
export { resolveMessageEmojis } from '../media/message-content';
export type { ResolvedMessageEmojis } from '../media/message-content';

// ─── Module-private state ───

/** roomCode → message list */
const chatHistory: Map<RoomCode, ChatMessage[]> = new Map();

// ─── Exported functions ───

/**
 * Initialize room chat
 */
export function initRoomChat(roomCode: RoomCode): void {
  chatHistory.set(roomCode, []);
}

/**
 * Add a chat message
 */
export function addMessage(
  roomCode: RoomCode,
  sender: PlayerInfo,
  content: string,
  library: readonly Pick<EmojiRecord, 'name' | 'mediaId'>[] = [],
  provided: ReadonlyMap<string, ProvidedEmoji> = new Map(),
  audience?: ChatAudience,
): ChatMessage {
  const { emojis, providedEmojis } = resolveMessageEmojis(content, library, provided);
  const message: ChatMessage = {
    id: generateMessageId(),
    sender,
    content,
    timestamp: Date.now(),
    ...(Object.keys(emojis).length > 0 && { emojis }),
    ...(Object.keys(providedEmojis).length > 0 && { providedEmojis }),
    ...(audience && { audience }),
  };

  append(roomCode, message);
  return message;
}

/** Adds a system line; `key` is translated by the client, `subject` is the player it concerns. */
export function addSystemMessage(roomCode: RoomCode, subject: PlayerInfo, key: string): void {
  append(roomCode, {
    id: generateMessageId(), sender: subject, content: key, timestamp: Date.now(), system: true,
  });
}

function append(roomCode: RoomCode, message: ChatMessage): void {
  const history = chatHistory.get(roomCode);
  if (history) {
    history.push(message);
    if (history.length > 200) history.splice(0, history.length - 200);
  }
}

/**
 * Get room chat history
 */
export function getChatHistory(roomCode: RoomCode): ChatMessage[] {
  return chatHistory.get(roomCode) ?? [];
}

/**
 * Clear room chat (when the room is destroyed)
 */
export function clearRoomChat(roomCode: RoomCode): void {
  chatHistory.delete(roomCode);
}

export function exportChat(): { roomCode: string; messages: ChatMessage[] }[] {
  return [...chatHistory].map(([roomCode, messages]) => ({ roomCode, messages }));
}

export function restoreChat(records: { roomCode: string; messages: ChatMessage[] }[]): void {
  chatHistory.clear();
  for (const record of records) chatHistory.set(record.roomCode, record.messages);
}

/** Resolves stickers exclusively from the authenticated sender's library. */
export function addSticker(
  roomCode: RoomCode, sender: PlayerInfo, stickerId: string, library: readonly EmojiRecord[],
  audience?: ChatAudience,
): ChatMessage | null {
  const asset = library.find((emoji) => emoji.id === stickerId && emoji.accountId === sender.id);
  if (!asset) return null;
  const message: ChatMessage = {
    id: generateMessageId(), sender, content: '', timestamp: Date.now(),
    sticker: { id: asset.id, name: asset.name, mediaId: asset.mediaId },
    ...(audience && { audience }),
  };
  append(roomCode, message);
  return message;
}

/** Resolves stickers exclusively from the site-provided catalog, by emoji name. */
export function addProvidedSticker(
  roomCode: RoomCode, sender: PlayerInfo, name: string, provided: ReadonlyMap<string, ProvidedEmoji>,
  audience?: ChatAudience,
): ChatMessage | null {
  const asset = provided.get(name);
  if (!asset) return null;
  const message: ChatMessage = {
    id: generateMessageId(), sender, content: '', timestamp: Date.now(),
    providedSticker: { name: asset.name, file: asset.file },
    ...(audience && { audience }),
  };
  append(roomCode, message);
  return message;
}

/** Ownership is checked against the durable account before appending. */
export function addShopSticker(
  roomCode: RoomCode, sender: PlayerInfo, shopSticker: ShopStickerId, audience?: ChatAudience,
): ChatMessage {
  const message: ChatMessage = {
    id: generateMessageId(), sender, content: '', timestamp: Date.now(), shopSticker,
    ...(audience && { audience }),
  };
  append(roomCode, message);
  return message;
}
