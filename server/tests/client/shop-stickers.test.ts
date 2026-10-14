import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile, ChatMessage } from '@shared/types';
import { SHOP_STICKERS } from '@shared/constants';

const accountFixture = vi.hoisted(() => ({ account: null as AccountProfile | null }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (selector: (state: typeof accountFixture) => unknown): unknown => selector(accountFixture),
}));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string): string => `/api/media/${id}` }));

import { useI18nStore } from '../../../client/src/stores/i18n-store';
import { ChatMessageBody, EmojiPickerSections } from '../../../client/src/components/ChatEmoji';
import { shopStickerUrl } from '../../../client/src/shop-stickers';

function picker(mode: 'emoji' | 'sticker' = 'sticker', query = '', busy = false): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(EmojiPickerSections, {
    mode, query, personal: [], provided: [], busy, onInsert: vi.fn(), onSendSticker: vi.fn(),
  })));
}

function inventory(ids: AccountProfile['ownedShopItems']): void {
  accountFixture.account = { id: 'alice', ownedShopItems: ids } as AccountProfile;
}

afterEach(() => {
  accountFixture.account = null;
  useI18nStore.setState({ locale: 'zh-TW' });
});

describe('official shop sticker UI', () => {
  it('uses one trusted bundled vector URL per stable catalog identifier', () => {
    expect(new Set(SHOP_STICKERS.map(({ id }) => shopStickerUrl(id))).size).toBe(8);
    for (const { id } of SHOP_STICKERS) expect(shopStickerUrl(id)).toMatch(/\.svg(?:\?no-inline)?$/);
  });

  it('renders received stickers without requiring recipient ownership', () => {
    useI18nStore.setState({ locale: 'en' });
    const message: ChatMessage = { id: 'm1', content: '', timestamp: 1, shopSticker: 'forest-cheer', sender: {
      id: 'bob', username: 'bob', nickname: 'Bob', color: '#123456', avatar: 'fox', avatarImage: null,
    } };
    const html = renderToStaticMarkup(createElement(ChatMessageBody, { message }));
    expect(html).toContain(shopStickerUrl('forest-cheer'));
    expect(html).toContain('alt="');
  });

  it('only exposes owned packs in sticker mode and updates when account inventory changes', () => {
    expect(picker()).toContain('/shop?type=stickerPack');
    expect(picker()).not.toContain(shopStickerUrl('table-hello'));
    inventory(['stickers-table-talk']);
    expect(picker()).toContain(shopStickerUrl('table-hello'));
    expect(picker()).not.toContain(shopStickerUrl('forest-cheer'));
    expect(picker('emoji')).not.toContain(shopStickerUrl('table-hello'));
    inventory(['stickers-table-talk', 'stickers-forest-friends']);
    expect(picker()).toContain(shopStickerUrl('forest-cheer'));
  });

  it('searches translated names and IDs and disables sending while busy', () => {
    useI18nStore.setState({ locale: 'en' });
    inventory(['stickers-table-talk']);
    expect(picker('sticker', 'table-hello')).toContain(shopStickerUrl('table-hello'));
    expect(picker('sticker', 'table-hello')).not.toContain(shopStickerUrl('table-nice'));
    expect(picker('sticker', 'zzzz')).not.toContain(shopStickerUrl('table-hello'));
    expect(picker('sticker', '', true).match(/disabled=""/g)).toHaveLength(4);
    useI18nStore.setState({ locale: 'zh-TW' });
    expect(picker('sticker', '嗨')).toContain(shopStickerUrl('table-hello'));
    expect(picker('sticker', '嗨')).not.toContain(shopStickerUrl('table-nice'));
  });
});
