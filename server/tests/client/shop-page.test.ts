import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile } from '@shared/types';
import { SHOP_ITEMS, SHOP_STICKERS, ownsShopItem } from '@shared/constants';

const state = vi.hoisted(() => ({ account: {} as Partial<AccountProfile> }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: Partial<AccountProfile> }) => unknown) => select(state),
}));
vi.mock('../../../client/src/components/ShopProductArt', () => ({ ShopProductArt: () => null }));

import { ShopPage } from '../../../client/src/pages/ShopPage';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

function render(query = ''): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [`/shop${query}`] },
    createElement(ShopPage)));
}

describe('shop categories and inventory', () => {
  beforeEach(() => {
    useI18nStore.getState().setLocale('en');
    state.account = { id: 'shopper', avatar: 'cat', color: '#4a9eff', coins: 200,
      ownedAvatarBorders: ['copper'], ownedShopItems: [] };
  });

  it('shows all products with accessible category controls and catalog counts', () => {
    const html = render();
    expect(html).toContain('id="shop-categories-title">Product categories</h2>');
    expect(html).toContain('aria-labelledby="shop-categories-title"');
    expect(html).toContain('30 products');
    expect(html.match(/<li[^>]*class="[^"]*product[^"]*"/g)).toHaveLength(30);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true" aria-controls="shop-catalog"[^>]*><span>All products<\/span>/);
    expect(html).toContain('aria-label="Equip Brushed copper"');
    expect(html).toContain('aria-label="Buy Golden hour"');
  });

  it.each([
    ['ears', 'Playful', 6, 'Cat ears', 'Brushed copper'],
    ['metal', 'Metal', 3, 'Brushed copper', 'Cat ears'],
    ['special', 'Glow', 7, 'Lunar eclipse', 'Cat ears'],
  ] as const)('restores the %s series from the URL', (series, label, count, included, excluded) => {
    const html = render(`?series=${series}`);
    expect(html).toContain(`id="shop-catalog-title">${label}</h2>`);
    expect(html).toContain(`${count} products`);
    expect(html.match(/<li[^>]*class="[^"]*product[^"]*"/g)).toHaveLength(count);
    expect(html).toContain(`<h3>${included}</h3>`);
    expect(html).not.toContain(`<h3>${excluded}</h3>`);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
  });

  it.each(['?series=unknown', '?type=unknown', '?series=', '?unrelated=metal'])('falls back to all products for %s', (query) => {
    const html = render(query);
    expect(html).toContain('30 products');
    expect(html).toContain('id="shop-catalog-title">All products</h2>');
  });

  it('translates navigation, selected series, and products into Traditional Chinese', () => {
    useI18nStore.getState().setLocale('zh-TW');
    const html = render('?series=metal');
    for (const text of ['商品種類', '頭像邊框', '全部系列', '俏皮造型', '金屬系列', '光環系列', '3 項商品', '霧光銅框']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('id="shop-catalog-title">金屬系列</h2>');
  });

  it.each([
    ['avatarBorder', 'Avatar borders', 16, 'Sakura wreath', 'Aurora weave'],
    ['cardBack', 'Card backs', 3, 'Aurora weave', 'Cat ears'],
    ['tableBackground', 'Table backgrounds', 3, 'Midnight aurora', 'Aurora weave'],
    ['seatBackground', 'Seat backgrounds', 3, 'Aurora window', 'Midnight aurora'],
    ['nameplate', 'Titles &amp; nameplates', 3, 'Night voyager nameplate', 'Cat ears'],
    ['stickerPack', 'Sticker packs', 2, 'Table talk', 'Cat ears'],
  ] as const)('restores the %s product type from the URL', (type, label, count, included, excluded) => {
    const html = render(`?type=${type}`);
    expect(html).toContain(`id="shop-catalog-title">${label}</h2>`);
    expect(html).toContain(`${count} products`);
    expect(html.match(/<li[^>]*class="[^"]*product[^"]*"/g)).toHaveLength(count);
    expect(html).toContain(`<h3>${included}</h3>`);
    expect(html).not.toContain(`<h3>${excluded}</h3>`);
  });

  it('ignores border series when browsing a different product type', () => {
    const html = render('?type=cardBack&series=ears');
    expect(html.match(/<li[^>]*class="[^"]*product[^"]*"/g)).toHaveLength(3);
    expect(html).toContain('Aurora weave');
  });

  it('offers equipment for owned cosmetics and disables equipped products or owned packs', () => {
    state.account = { ...state.account, cardBackStyle: 'card-back-aurora',
      ownedShopItems: ['card-back-aurora', 'table-tide', 'stickers-table-talk'] };
    const html = render();
    expect(html).toMatch(/disabled=""[^>]*aria-label="Aurora weave \(equipped\)"[^>]*>Equipped<\/button>/);
    expect(html).toContain('aria-label="Equip Quiet lagoon"');
    expect(html).toMatch(/disabled=""[^>]*aria-label="Table talk \(owned\)"[^>]*>Owned<\/button>/);
  });

  it('explains visibility once beside the selected category heading, not on product cards', () => {
    expect(render()).not.toContain('Only you see this card back.');
    const cardBacks = render('?type=cardBack');
    expect(cardBacks.match(/Only you see this card back\./g)).toHaveLength(1);
    expect(cardBacks).toMatch(/<h2 id="shop-catalog-title">Card backs<\/h2><p[^>]*>Only you see this card back\./);
    expect(render('?type=stickerPack')).toContain('Use in room chat and private messages.');
    expect(render('?type=avatarBorder')).not.toMatch(/<h2 id="shop-catalog-title">[^<]*<\/h2><p/);
  });

  it.each(['en', 'zh-TW'] as const)('translates every product and its visibility (%s)', (locale) => {
    useI18nStore.getState().setLocale(locale);
    const html = render();
    for (const prefix of ['shop.item.', 'shop.visibility.', 'shop.type.']) expect(html).not.toContain(prefix);
    for (const type of ['cardBack', 'tableBackground', 'seatBackground', 'nameplate', 'stickerPack']) {
      expect(render(`?type=${type}`)).not.toContain('shop.visibility.');
    }
    if (locale === 'zh-TW') {
      for (const text of ['商品種類', '牌背', '稱號與名牌', '貼圖包', '櫻花花冠', '30 項商品']) expect(html).toContain(text);
    }
  });

  it('keeps legacy border ownership separate from the new inventory', () => {
    const copper = SHOP_ITEMS.find((item) => item.id === 'copper');
    const aurora = SHOP_ITEMS.find((item) => item.id === 'card-back-aurora');
    if (!copper || !aurora) throw new Error('Missing catalog fixtures');
    expect(ownsShopItem({ ownedAvatarBorders: ['copper'] }, copper)).toBe(true);
    expect(ownsShopItem({ ownedShopItems: ['copper'] }, copper)).toBe(false);
    expect(ownsShopItem({ ownedShopItems: ['card-back-aurora'] }, aurora)).toBe(true);
  });

  it('defines unique products and four distinct stickers per pack', () => {
    expect(new Set(SHOP_ITEMS.map(({ id }) => id)).size).toBe(SHOP_ITEMS.length);
    expect(SHOP_ITEMS.every(({ price }) => Number.isSafeInteger(price) && price > 0)).toBe(true);
    expect(new Set(SHOP_STICKERS.map(({ id }) => id)).size).toBe(8);
    for (const pack of SHOP_ITEMS.filter((item) => item.type === 'stickerPack')) {
      expect(SHOP_STICKERS.filter((sticker) => sticker.packId === pack.id)).toHaveLength(4);
    }
  });
});
