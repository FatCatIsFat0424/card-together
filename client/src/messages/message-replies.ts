import type { ChatMessage, ReplyPreview } from '@shared/types/chat';
import type { DirectMessage } from '@shared/types/direct-message';

/** Composer previews are local; the server resolves the authoritative source on send. */
export function messageReplyPreview(message: ChatMessage | DirectMessage): ReplyPreview {
  return {
    senderId: message.sender.id,
    nickname: message.sender.nickname,
    timestamp: message.timestamp,
    content: message.content.slice(0, 160),
    kind: message.sticker || message.providedSticker || message.shopSticker ? 'sticker' : 'text',
  };
}

export function replyNotifies(message: ChatMessage, accountId: string | null, sourceAuthorId?: string): boolean {
  return Boolean(accountId && message.reply?.notify && (message.replyPreview?.senderId ?? sourceAuthorId) === accountId);
}
