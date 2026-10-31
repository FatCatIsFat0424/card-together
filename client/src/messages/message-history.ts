import type { DirectMessage } from '@shared/types/direct-message';
import { SOCIAL_HISTORY_RETENTION_MS } from '@shared/constants/social';

export function mergeDirectMessages(
  current: readonly DirectMessage[], incoming: readonly DirectMessage[],
  position: 'before' | 'after' = 'after', now: number = Date.now(),
): DirectMessage[] {
  const incomingIds = new Set(incoming.map((message) => message.id));
  const retained = current.filter((message) => !incomingIds.has(message.id));
  const combined = position === 'before' ? [...incoming, ...retained] : [...retained, ...incoming];
  const cutoff = now - SOCIAL_HISTORY_RETENTION_MS;
  const expiredIds = new Set(combined.filter((message) => message.timestamp <= cutoff).map((message) => message.id));
  // Stable sorting retains server insertion order when timestamps share a millisecond.
  return combined.filter((message) => message.timestamp > cutoff)
    .map((message) => {
      if (!message.reply || !message.replyPreview
        || (message.replyPreview.timestamp > cutoff && !expiredIds.has(message.reply.messageId))) return message;
      const { replyPreview: _preview, ...withoutPreview } = message;
      return withoutPreview;
    })
    .sort((first, second) => first.timestamp - second.timestamp);
}

export function latestIncomingMessageId(
  messages: readonly DirectMessage[], ownId: string, otherId: string,
): string | undefined {
  return messages.findLast((message) => message.sender.id === otherId && message.recipientId === ownId)?.id;
}
