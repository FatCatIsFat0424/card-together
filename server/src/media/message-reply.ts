import type { MessageReply, ReplyPreview } from '@shared/types';

export function isMessageReply(value: unknown): value is MessageReply {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const reply = value as Record<string, unknown>;
  return Object.keys(reply).length === 2 && Object.keys(reply).every((key) => ['messageId', 'notify'].includes(key))
    && typeof reply.messageId === 'string' && reply.messageId.length > 0 && reply.messageId.length <= 128
    && reply.messageId.trim() === reply.messageId && typeof reply.notify === 'boolean';
}

/** Null rejects malformed options; undefined means no selected reply. */
export function parseMessageReply(body: object): MessageReply | null | undefined {
  if (!('replyTo' in body)) return 'replyNotify' in body ? null : undefined;
  const reply = { messageId: body.replyTo, notify: 'replyNotify' in body ? body.replyNotify : true };
  return isMessageReply(reply) ? reply : null;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Keep excerpts bounded in UTF-16 units without splitting a grapheme. */
export function replyPreview(
  senderId: string, nickname: string, source: {
    readonly content: string; readonly timestamp: number;
    readonly sticker?: unknown; readonly providedSticker?: unknown; readonly shopSticker?: unknown;
  },
): ReplyPreview {
  const sticker = Boolean(source.sticker || source.providedSticker || source.shopSticker);
  let content = sticker ? '[Sticker]' : source.content;
  if (content.length > 160) {
    let excerpt = '';
    for (const { segment } of segmenter.segment(content)) {
      if (excerpt.length + segment.length > 159) break;
      excerpt += segment;
    }
    content = `${excerpt}…`;
  }
  return { senderId, nickname, timestamp: source.timestamp, content, kind: sticker ? 'sticker' : 'text' };
}
