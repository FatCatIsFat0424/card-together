import { randomUUID } from 'node:crypto';
import type { DirectMessage, MessageHistory, SocialOverview } from '@shared/types/direct-message';
import type { PublicAccount } from '@shared/types';
import { isEmojiName } from '@shared/constants';
import type { DirectMessageRecord, Repository } from '../database/repository';
import type { ProvidedEmojiCatalog } from '../media/provided-emoji';
import { resolveMessageEmojis } from '../media/message-content';
import { publicProfile } from './friend-service';

export interface MessageService {
  overview(accountId: string): Promise<SocialOverview>;
  history(accountId: string, otherId: string, before?: string): Promise<MessageHistory>;
  send(accountId: string, otherId: string, payload: unknown): Promise<DirectMessage>;
}

export function messageError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function peerId(accountId: string, otherId: string): void {
  if (!otherId || otherId.length > 128 || accountId === otherId) {
    throw messageError(400, 'Choose another account.');
  }
}

/** Resolve identities from authenticated accounts, never from client-provided profiles. */
export function createMessageService(
  repository: Repository, provided: ProvidedEmojiCatalog,
): MessageService {
  async function profile(id: string): Promise<PublicAccount> {
    const account = await repository.getAccountById(id);
    if (!account) throw messageError(404, 'Account not found.');
    return publicProfile(account);
  }

  async function message(record: DirectMessageRecord): Promise<DirectMessage> {
    const { senderId, ...content } = record;
    return { ...content, sender: await profile(senderId) };
  }

  async function acceptedPeers(accountId: string): Promise<Set<string>> {
    const relationships = await repository.listFriendships(accountId);
    return new Set(relationships.filter((entry) => entry.status === 'accepted')
      .map((entry) => entry.requesterId === accountId ? entry.recipientId : entry.requesterId));
  }

  async function retainedRetry(
    accountId: string, otherId: string, body: Record<string, unknown>,
  ): Promise<DirectMessage | null> {
    const existing = (await repository.listDirectMessages(accountId)).find((entry) =>
      entry.senderId === accountId && entry.clientId === body.clientId);
    if (!existing) return null;
    const sameContent = 'message' in body
      ? typeof body.message === 'string' && !existing.sticker && !existing.providedSticker
        && existing.content === body.message.trim()
      : 'stickerId' in body ? existing.sticker?.id === body.stickerId
        : 'providedSticker' in body && existing.providedSticker?.name === body.providedSticker;
    if (existing.recipientId !== otherId || !sameContent) {
      throw messageError(409, 'This message ID was already used for another message.');
    }
    return message(existing);
  }

  return {
    async overview(accountId): Promise<SocialOverview> {
      const [relationships, records, reads, notifications] = await Promise.all([
        repository.listFriendships(accountId), repository.listDirectMessages(accountId),
        repository.listMessageReads(accountId), repository.listFriendNotifications(accountId),
      ]);
      const peers = new Set(relationships.filter((entry) => entry.status === 'accepted')
        .map((entry) => entry.requesterId === accountId ? entry.recipientId : entry.requesterId));
      const grouped = new Map<string, DirectMessageRecord[]>();
      for (const record of records) {
        const otherId = record.senderId === accountId ? record.recipientId : record.senderId;
        const history = grouped.get(otherId) ?? [];
        history.push(record);
        grouped.set(otherId, history);
      }
      const incoming = await Promise.all(relationships
        .filter((entry) => entry.status === 'pending' && entry.recipientId === accountId)
        .map(async (entry) => ({ id: entry.id, createdAt: entry.createdAt,
          requester: await profile(entry.requesterId), recipient: await profile(entry.recipientId) })));
      const accepted = await Promise.all(notifications.map(async (entry) => ({
        id: entry.id, account: await profile(entry.actorId), createdAt: entry.createdAt,
      })));
      const conversations = await Promise.all([...grouped].map(async ([otherId, history]) => {
        const cursor = reads.find((entry) => entry.otherId === otherId)?.messageId;
        const lastRead = cursor ? history.findIndex((entry) => entry.id === cursor) : -1;
        return {
          account: await profile(otherId), lastMessage: await message(history[history.length - 1]),
          unreadCount: history.slice(lastRead + 1).filter((entry) => entry.recipientId === accountId).length,
          canSend: peers.has(otherId),
        };
      }));
      conversations.sort((first, second) => second.lastMessage.timestamp - first.lastMessage.timestamp);
      incoming.sort((first, second) => second.createdAt - first.createdAt);
      accepted.sort((first, second) => second.createdAt - first.createdAt);
      return { incoming, accepted, conversations };
    },

    async history(accountId, otherId, before): Promise<MessageHistory> {
      peerId(accountId, otherId);
      const [records, peers, account] = await Promise.all([
        repository.listDirectMessages(accountId, otherId), acceptedPeers(accountId), profile(otherId),
      ]);
      if (!peers.has(otherId) && records.length === 0) throw messageError(404, 'Conversation not found.');
      const end = before === undefined ? records.length : records.findIndex((entry) => entry.id === before);
      if (end < 0) throw messageError(400, 'Invalid message cursor. Refresh this conversation.');
      const start = Math.max(0, end - 50);
      return { account, messages: await Promise.all(records.slice(start, end).map(message)),
        hasMore: start > 0, canSend: peers.has(otherId) };
    },

    async send(accountId, otherId, payload): Promise<DirectMessage> {
      peerId(accountId, otherId);
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw messageError(400, 'Invalid message payload.');
      }
      const body = payload as Record<string, unknown>;
      if (typeof body.clientId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(body.clientId)
        || Object.keys(body).length !== 2) throw messageError(400, 'Invalid message payload.');
      // A retry confirms the original intent even if its emoji library has since changed.
      const retry = await retainedRetry(accountId, otherId, body);
      if (retry) return retry;
      const library = await repository.listEmojis(accountId);
      let content: Pick<DirectMessageRecord, 'content' | 'emojis' | 'providedEmojis' | 'sticker' | 'providedSticker'>;
      if ('message' in body) {
        if (typeof body.message !== 'string' || !body.message.trim() || body.message.trim().length > 500) {
          throw messageError(400, 'Messages must contain 1–500 characters.');
        }
        const text = body.message.trim();
        const resolved = resolveMessageEmojis(text, library, provided);
        content = { content: text,
          ...(Object.keys(resolved.emojis).length > 0 && { emojis: resolved.emojis }),
          ...(Object.keys(resolved.providedEmojis).length > 0 && { providedEmojis: resolved.providedEmojis }) };
      } else if ('stickerId' in body) {
        const asset = library.find((entry) => entry.id === body.stickerId && entry.accountId === accountId);
        if (!asset) throw messageError(400, 'Sticker is not in your library.');
        content = { content: '', sticker: { id: asset.id, name: asset.name, mediaId: asset.mediaId } };
      } else if ('providedSticker' in body && isEmojiName(body.providedSticker)) {
        const asset = provided.get(body.providedSticker);
        if (!asset) throw messageError(400, 'Sticker is not available.');
        content = { content: '', providedSticker: { name: asset.name, file: asset.file } };
      } else throw messageError(400, 'Invalid message payload.');
      try {
        const saved = await repository.createDirectMessage({
          id: randomUUID(), clientId: body.clientId, senderId: accountId,
          recipientId: otherId, timestamp: Date.now(), ...content,
        });
        return await message(saved);
      } catch (error: unknown) {
        // Concurrent retries may resolve different media while sharing the same intent.
        if (error instanceof Error && 'code' in error && error.code === 'MESSAGE_CONFLICT') {
          const committed = await retainedRetry(accountId, otherId, body);
          if (committed) return committed;
        }
        throw error;
      }
    },
  };
}
