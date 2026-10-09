import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, EmojiRecord, ProvidedEmoji } from '@shared/types';

// The real module reads window.location at import time for API URLs.
vi.mock('../../../client/src/media', () => ({
  mediaUrl: (id: string): string => `/api/media/${id}`,
}));

import { ChatMessageBody, EmojiPickerSections } from '../../../client/src/components/ChatEmoji';
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
  return render(createElement(EmojiPickerSections, {
    mode, query, personal: PERSONAL, provided, busy: false, onInsert: vi.fn(), onSendSticker: vi.fn(),
  }));
}

function message(fields: Partial<ChatMessage>): ChatMessage {
  return { id: 'm1', sender: SENDER, content: '', timestamp: 1, ...fields };
}

afterEach(() => {
  vi.unstubAllEnvs();
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

  it('should show a separate site section and hide names shadowed by the library when inserting', () => {
    useI18nStore.setState({ locale: 'en' });
    const insert = picker('emoji', [WAVE, CHEER]);
    expect(insert).toContain('My emoji</h3>');
    expect(insert).toContain('Site emoji</h3>');
    expect(insert).toContain(`/provided-emoji/${CHEER.file}`);
    expect(insert).not.toContain(WAVE.file);
    expect(insert).toContain(`/api/media/${MEDIA}`);

    const stickers = picker('sticker', [WAVE, CHEER]);
    expect(stickers).toContain(WAVE.file);
    expect(stickers).toContain(CHEER.file);

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
    expect(html).not.toContain('<h3');
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
