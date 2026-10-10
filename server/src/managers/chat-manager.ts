// ─── Chat Manager ───

import type {
  RoomCode, ChatMessage, EmojiRecord, MediaId, PlayerInfo, ProvidedEmoji,
} from '@shared/types';

/** `observers` limits a message to spectators and eliminated players during a match. */
export type ChatAudience = ChatMessage['audience'];
import { MAX_MESSAGE_EMOJIS, extractEmojiNames } from '@shared/constants';
import { generateMessageId } from '../utils/id-generator';

export interface ResolvedMessageEmojis {
  readonly emojis: Record<string, MediaId>;
  readonly providedEmojis: Record<string, ProvidedEmoji['file']>;
}

/**
 * Maps the first MAX_MESSAGE_EMOJIS known `:name:` tokens to images. The sender's library
 * wins over site-provided emoji with the same name; unknown names stay text.
 */
export function resolveMessageEmojis(
  content: string,
  library: readonly Pick<EmojiRecord, 'name' | 'mediaId'>[],
  provided: ReadonlyMap<string, ProvidedEmoji> = new Map(),
): ResolvedMessageEmojis {
  const owned = new Map(library.map((emoji) => [emoji.name, emoji.mediaId]));
  const used = extractEmojiNames(content).filter((name) => owned.has(name) || provided.has(name))
    .slice(0, MAX_MESSAGE_EMOJIS);
  const emojis: Record<string, MediaId> = {};
  const providedEmojis: Record<string, ProvidedEmoji['file']> = {};
  for (const name of used) {
    const mediaId = owned.get(name);
    if (mediaId) emojis[name] = mediaId;
    else providedEmojis[name] = (provided.get(name) as ProvidedEmoji).file;
  }
  return { emojis, providedEmojis };
}

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
