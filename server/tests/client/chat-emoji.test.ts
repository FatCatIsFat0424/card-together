import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, EmojiRecord, ProvidedEmoji } from '@shared/types';

// The real module reads window.location at import time for API URLs.
vi.mock('../../../client/src/stores/account-store', async () => {
  const { create } = await import('zustand');
  return { useAccountStore: create(() => ({ account: null })) };
});

vi.mock('../../../client/src/media', () => ({
  mediaUrl: (id: string): string => `/api/media/${id}`,
}));

vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/stores/chat-mention-store', () => ({
  useChatMentionStore: (select: (value: { unreadIds: readonly string[]; targetMessageId: null; requestJump: () => void }) => unknown) =>
    select({ unreadIds: [], targetMessageId: null, requestJump: () => {} }),
}));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));

// Server rendering reads a Zustand store's initial state, so messages come from this stub.
const chat = vi.hoisted(() => ({ messages: [] as unknown[] }));
vi.mock('../../../client/src/stores/chat-store', () => ({
  useChatStore: (select: (value: typeof chat) => unknown) => select(chat),
}));

import { ChatMessageBody, EmojiPicker } from '../../../client/src/components/ChatEmoji';
import { ChatPanel } from '../../../client/src/components/ChatPanel';
import { PROVIDED_EMOJIS, providedEmojiUrl } from '../../../client/src/provided-emoji';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const MEDIA = `${'a'.repeat(64)}.png`;
const WAVE: ProvidedEmoji = { name: 'wave', file: 'wave-0123456789abcdef01234567.png' };
const CHEER: ProvidedEmoji = { name: 'cheer', file: 'cheer-89abcdef0123456789abcdef.gif' };
const PERSONAL: EmojiRecord[] = [{ id: 'emoji-1', accountId: 'alice', name: 'wave', mediaId: MEDIA, createdAt: 1 }];
const SENDER = {
  id: 'alice', username: 'alice', nickname: 'Alice', color: '#123456', avatar: 'cat', avatarImage: null,
} as const;

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, element));
}

function picker(mode: 'emoji' | 'sticker', provided: readonly ProvidedEmoji[], query = ''): string {
  return render(createElement(EmojiPicker, {
    initialMode: mode, initialQuery: query, personal: PERSONAL, provided, busy: false, onInsert: vi.fn(), onSendSticker: vi.fn(),
  }));
}

function message(fields: Partial<ChatMessage>): ChatMessage {
  return { id: 'm1', sender: SENDER, content: '', timestamp: 1, ...fields };
}

afterEach(() => {
  vi.unstubAllEnvs();
  chat.messages = [];
  useI18nStore.setState({ locale: 'zh-TW' });
});

describe('site-provided chat emoji UI', () => {
  it('should load an empty catalog when no emoji were imported', () => {
    expect(Array.isArray(PROVIDED_EMOJIS)).toBe(true);
  });

  it('should only build static URLs for importer file names', () => {
    vi.stubEnv('BASE_URL', '/card-together/');
    expect(providedEmojiUrl(WAVE.file)).toBe(`/card-together/provided-emoji/${WAVE.file}`);
    for (const file of ['https://example.com/a.png', '../wave.png', 'wave.png', `${WAVE.file}?x`]) {
      expect(providedEmojiUrl(file)).toBeNull();
    }
  });

  it('should show library and site emoji as tabs in one row and hide names shadowed by the library when inserting', () => {
    useI18nStore.setState({ locale: 'en' });
    const insert = picker('emoji', [WAVE, CHEER]);
    expect(insert).toMatch(/role="tab" aria-selected="true" aria-label="My emoji" title="My emoji">Mine<\/button>/);
    expect(insert).toMatch(/role="tab" aria-selected="false" aria-label="Site emoji" title="Site emoji">Site<\/button>/);
    expect(insert).toMatch(/aria-pressed="true">Emoji<\/button>/);
    expect(insert).toContain('aria-label="Search emoji"');
    expect(insert).toContain('href="/shop?type=stickerPack"');
    expect(insert).toContain(`/api/media/${MEDIA}`);
    expect(insert).not.toContain(CHEER.file);

    // Searching replaces the row with a field and lists matches from every category; shadowed names stay hidden.
    const searched = picker('emoji', [WAVE, CHEER], 'cheer');
    expect(searched).not.toContain('role="tab"');
    expect(searched).toContain('type="search"');
    expect(searched).toContain(`/provided-emoji/${CHEER.file}`);
    expect(picker('emoji', [WAVE, CHEER], 'wave')).not.toContain(WAVE.file);
    expect(picker('sticker', [WAVE, CHEER], 'wave')).toContain(`/api/media/${MEDIA}`);
    expect(picker('sticker', [CHEER], 'cheer')).toContain(CHEER.file);

    expect(picker('emoji', [WAVE, CHEER], 'zzz')).toContain('No matching emoji.');
  });

  it('should match mixed-case names with a lowercase query and build their static URLs', () => {
    vi.stubEnv('BASE_URL', '/card-together/');
    useI18nStore.setState({ locale: 'en' });
    const neko: ProvidedEmoji = { name: 'NEKO-3.v2', file: 'NEKO-3.v2-0123456789abcdef01234567.webp' };
    expect(providedEmojiUrl(neko.file)).toBe(`/card-together/provided-emoji/${neko.file}`);
    expect(picker('emoji', [neko, CHEER], 'neko')).toContain(neko.file);
    expect(picker('emoji', [neko, CHEER], 'neko')).not.toContain(CHEER.file);
  });

  it('should keep the personal-only picker when the site has no emoji', () => {
    useI18nStore.setState({ locale: 'en' });
    const html = picker('emoji', []);
    expect(html.match(/role="tab"/g)).toHaveLength(1);
    expect(html).not.toContain('Site emoji');
    expect(html).toContain(`/api/media/${MEDIA}`);
  });

  it('should render provided inline emoji and stickers from the static path', () => {
    useI18nStore.setState({ locale: 'en' });
    const inline = render(createElement(ChatMessageBody, { message: message({
      content: 'hi :wave: :cheer: :nope:', emojis: { wave: MEDIA }, providedEmojis: { cheer: CHEER.file },
    }) }));
    expect(inline).toContain(`src="/api/media/${MEDIA}" alt=":wave:"`);
    expect(inline).toContain(`src="/provided-emoji/${CHEER.file}" alt=":cheer:"`);
    expect(inline).toContain(':nope:');

    const sticker = render(createElement(ChatMessageBody, { message: message({ providedSticker: CHEER }) }));
    expect(sticker).toContain(`src="/provided-emoji/${CHEER.file}" alt="cheer"`);

    const forged = render(createElement(ChatMessageBody, { message: message({
      providedSticker: { name: 'cheer', file: 'https://example.com/a.png' },
    }) }));
    expect(forged).not.toContain('example.com');
    expect(forged).toContain('Image unavailable: cheer');
  });
});

describe('chat panel', () => {
  it('keeps localized system and observer labels alongside the original message timestamp', () => {
    const timestamp = new Date(2026, 9, 14, 16, 47).getTime();
    chat.messages = [
      message({ id: 'joined', content: 'chat.playerJoined', system: true, timestamp }),
      message({ id: 'observer', content: 'hello :wave:', audience: 'observers', emojis: { wave: MEDIA }, timestamp }),
    ];
    for (const locale of ['en', 'zh-TW'] as const) {
      useI18nStore.setState({ locale });
      const html = render(createElement(ChatPanel));
      const { t } = useI18nStore.getState();
      expect(html).toContain(t('chat.playerJoined', { name: 'Alice' }));
      expect(html).toContain(t('chat.observerTag'));
      expect(html).toContain(t('chat.observerTitle'));
      expect(html).toContain(`dateTime="${new Date(timestamp).toISOString()}"`);
      expect(html).toContain('2026/10/14 16:47');
      expect(html).toContain(`src="/api/media/${MEDIA}" alt=":wave:"`);
    }
  });

  it('should show the sender nameplate beside the nickname', () => {
    useI18nStore.setState({ locale: 'en' });
    chat.messages = [
      message({ id: 'm1', content: 'hi', sender: { ...SENDER, nameplate: 'nameplate-tide' } }),
      message({ id: 'm2', content: 'plain', sender: { ...SENDER, id: 'bob', nickname: 'Bob' } }),
    ];
    const html = render(createElement(ChatPanel));
    expect(html).toContain('Alice');
    expect(html).toContain('Bob');
    expect(html.match(/data-nameplate=/g)).toHaveLength(1);
    expect(html).toContain('data-nameplate="nameplate-tide"');
    expect(html).toContain(useI18nStore.getState().t('shop.title.nameplate-tide'));
  });
});
