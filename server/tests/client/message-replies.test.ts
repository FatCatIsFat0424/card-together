import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@shared/types/chat';
import { messageReplyPreview, replyNotifies } from '../../../client/src/messages/message-replies';
import { ReplyAction, ReplyComposer, ReplyQuote } from '../../../client/src/components/MessageReply';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const source: ChatMessage = {
  id: 'original', content: '<script>hello</script>', timestamp: 1,
  sender: { id: 'author', username: 'alice', nickname: 'Alice', color: '#123456', avatar: 'cat', avatarImage: null },
};

afterEach(() => useI18nStore.setState({ locale: 'zh-TW' }));

describe('message replies', () => {
  it('bounds text previews and identifies stickers without copying media URLs', () => {
    expect(messageReplyPreview({ ...source, content: 'x'.repeat(500) })).toEqual({
      senderId: 'author', nickname: 'Alice', timestamp: 1, content: 'x'.repeat(160), kind: 'text',
    });
    const sticker = { ...source, content: '', sticker: { id: 'image', name: 'wave', mediaId: 'private.png' } };
    expect(messageReplyPreview(sticker)).toEqual({ senderId: 'author', nickname: 'Alice', timestamp: 1, content: '', kind: 'sticker' });
  });

  it('notifies only the canonical source author when the sender enables it', () => {
    const reply = { ...source, reply: { messageId: 'original', notify: true }, replyPreview: messageReplyPreview(source) };
    expect(replyNotifies(reply, 'author')).toBe(true);
    expect(replyNotifies(reply, 'same-name-player')).toBe(false);
    expect(replyNotifies(reply, null)).toBe(false);
    expect(replyNotifies({ ...reply, reply: { ...reply.reply, notify: false } }, 'author')).toBe(false);
    expect(replyNotifies({ ...reply, replyPreview: undefined }, 'author')).toBe(false);
  });

  it('escapes source content and labels source jumps only while a preview exists', () => {
    const html = renderToStaticMarkup(createElement(ReplyQuote, { preview: messageReplyPreview(source), onJump: vi.fn() }));
    expect(html).toContain('aria-label="查看 Alice 的原訊息"');
    expect(html).toContain('&lt;script&gt;hello&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    const expired = renderToStaticMarkup(createElement(ReplyQuote, { preview: undefined, onJump: vi.fn() }));
    expect(expired).toContain('原訊息已無法查看');
    expect(expired).not.toContain('<button');
  });

  it('localizes stickers, cancellation and the optional author notification', () => {
    useI18nStore.setState({ locale: 'en' });
    const html = renderToStaticMarkup(createElement(ReplyComposer, {
      preview: { ...messageReplyPreview(source), kind: 'sticker' }, onCancel: vi.fn(), notify: false, onNotifyChange: vi.fn(),
    }));
    expect(html).toContain('Replying to Alice');
    expect(html).toContain('[Sticker]');
    expect(html).toContain('Cancel reply');
    expect(html).toContain('Notify the author');
    expect(html).not.toContain('checked=""');
    const action = renderToStaticMarkup(createElement(ReplyAction, { onReply: vi.fn(), disabled: true }));
    expect(action).toContain('aria-label="Reply to message"');
    expect(action).toContain('disabled=""');
  });
});
