import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@shared/types';
import { CHAT_FRAMES } from '@shared/constants';

// The real module reads window.location at import time for API URLs.
vi.mock('../../../client/src/stores/account-store', async () => {
  const { create } = await import('zustand');
  return { useAccountStore: create(() => ({ account: null })) };
});
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string): string => `/api/media/${id}` }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/stores/chat-mention-store', () => ({
  useChatMentionStore: (select: (value: { unreadIds: readonly string[]; targetMessageId: null; requestJump: () => void }) => unknown) =>
    select({ unreadIds: [], targetMessageId: null, requestJump: () => {} }),
}));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));

const chat = vi.hoisted(() => ({ messages: [] as unknown[] }));
vi.mock('../../../client/src/stores/chat-store', () => ({
  useChatStore: (select: (value: typeof chat) => unknown) => select(chat),
}));

import { ChatPanel } from '../../../client/src/components/ChatPanel';
import { ChatFrame, resolveChatFrame } from '../../../client/src/cosmetics/chat-frames/ChatFrame';
import { ChatFramePreview } from '../../../client/src/cosmetics/chat-frames/ChatFramePreview';
import { chatFramesTranslations } from '../../../client/src/cosmetics/chat-frames/i18n';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const SENDER = {
  id: 'alice', username: 'alice', nickname: 'Alice', color: '#123456', avatar: 'cat', avatarImage: null,
} as const;

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, element));
}

function message(fields: Partial<ChatMessage>): ChatMessage {
  return { id: 'm1', sender: SENDER, content: 'hello', timestamp: 1, ...fields };
}

afterEach(() => {
  chat.messages = [];
  useI18nStore.setState({ locale: 'zh-TW' });
});

describe('resolveChatFrame', () => {
  it('accepts catalog ids and treats anything else as unequipped', () => {
    expect(resolveChatFrame('chat-frame-gilded')).toBe('chat-frame-gilded');
    expect(resolveChatFrame('chat-frame-retired')).toBeNull();
    expect(resolveChatFrame('nameplate-tide')).toBeNull();
    expect(resolveChatFrame(null)).toBeNull();
    expect(resolveChatFrame(undefined)).toBeNull();
  });
});

describe('ChatFrame', () => {
  it('renders exactly the plain element when nothing is equipped', () => {
    const plain = render(createElement('div', { className: 'body' }, 'hi'));
    expect(render(createElement(ChatFrame, { id: null, className: 'body', children: 'hi' }))).toBe(plain);
    expect(render(createElement(ChatFrame, { id: 'chat-frame-retired', className: 'body', children: 'hi' }))).toBe(plain);
    expect(render(createElement(ChatFrame, { id: undefined, as: 'article', className: 'body', children: 'hi' })))
      .toBe('<article class="body">hi</article>');
  });

  it.each(CHAT_FRAMES.map((frame) => frame.id))('wraps the body in %s with hidden decoration', (id) => {
    const html = render(createElement(ChatFrame, { id, className: 'body', children: 'hi' }));
    expect(html).toContain(`data-chat-frame="${id}"`);
    expect(html).toContain('class="body ');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).not.toMatch(/<svg(?![^>]*aria-hidden="true")/);
    expect(html).toContain('hi</div></div>');
  });

  it('keeps the body text out of the decorative layers', () => {
    const html = render(createElement(ChatFrame, { id: 'chat-frame-aurora', children: 'hi' }));
    expect(html.replace(/<svg.*?<\/svg>/g, '').replace(/<[^>]+>/g, '')).toBe('hi');
  });
});

describe('chat frame products', () => {
  it('translates every product in both locales', () => {
    for (const locale of ['en', 'zh-TW'] as const) {
      const dictionary: Record<string, string> = chatFramesTranslations[locale];
      for (const { id } of CHAT_FRAMES) {
        expect(dictionary[`shop.item.${id}.name`]?.trim()).toBeTruthy();
        expect(dictionary[`shop.item.${id}.description`]?.trim()).toBeTruthy();
      }
    }
  });

  it('previews a framed sample line with the shopper identity', () => {
    useI18nStore.setState({ locale: 'en' });
    const html = render(createElement(ChatFramePreview, {
      id: 'chat-frame-sakura', account: { avatar: 'fox', avatarImage: null, color: '#ff8800', nickname: 'Mina' },
    }));
    expect(html).toContain('Mina');
    expect(html).toContain('data-chat-frame="chat-frame-sakura"');
    expect(html).toContain(chatFramesTranslations.en['shop.chatFrame.sample']);
  });
});

describe('room chat frames', () => {
  it('frames only messages from senders with an equipped frame', () => {
    useI18nStore.setState({ locale: 'en' });
    chat.messages = [
      message({ id: 'm1', sender: { ...SENDER, chatFrame: 'chat-frame-ember' } }),
      message({ id: 'm2', sender: { ...SENDER, id: 'bob', nickname: 'Bob' }, content: 'plain' }),
      message({ id: 'm3', sender: { ...SENDER, chatFrame: 'chat-frame-ember' }, content: 'chat.playerJoined', system: true }),
    ];
    const html = render(createElement(ChatPanel));
    expect(html.match(/data-chat-frame=/g)).toHaveLength(1);
    expect(html).toContain('data-chat-frame="chat-frame-ember"');
  });
});
