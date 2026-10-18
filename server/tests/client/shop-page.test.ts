import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile } from '@shared/types';
import { SHOP_ITEMS, SHOP_STICKERS, SHOP_SERIES, shopItemSeries, ownsShopItem } from '@shared/constants';

const state = vi.hoisted(() => ({ account: {} as Partial<AccountProfile> }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: Partial<AccountProfile> }) => unknown) => select(state),
}));
vi.mock('../../../client/src/components/ShopProductArt', () => ({ ShopProductArt: () => null }));

import { shopSeriesQuery } from '../../../client/src/shop-filters';
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
    expect(html).toContain('<nav class="_sidebar');
    expect(html).toContain('aria-label="Product categories"');
    // Category buttons carry the totals, so the catalog header repeats a count only for series filters.
    expect(html).not.toContain(`${SHOP_ITEMS.length} products`);
    expect(html.match(/<li[^>]*class="[^"]*product[^"]*"/g)).toHaveLength(SHOP_ITEMS.length);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-pressed="true" aria-controls="shop-catalog"[^>]*><span>All products<\/span>/);
    expect(html).toContain('aria-label="Equip Brushed copper"');
    expect(html).toContain('aria-label="Buy Golden hour"');
  });

  it.each([
    ['ears', 'Playful', 6, 'Cat ears', 'Brushed copper'],
    ['metal', 'Metal', 3, 'Brushed copper', 'Cat ears'],
    ['special', 'Glow', 12, 'Lunar eclipse', 'Cat ears'],
  ] as const)('restores the %s series from the URL', (series, label, count, included, excluded) => {
    const html = render(`?series=${series}`);
    expect(html).toContain(`id="shop-catalog-title">${label}</h2>`);
    expect(html).toContain(`${count} products`);
    expect(html.match(/<li[^>]*class="[^"]*product[^"]*"/g)).toHaveLength(count);
    expect(html).toContain(`<h3>${included}</h3>`);
    expect(html).not.toContain(`<h3>${excluded}</h3>`);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(3);
  });

  it.each(['?series=unknown', '?type=unknown', '?series=', '?unrelated=metal'])('falls back to all products for %s', (query) => {
    const html = render(query);
    expect(html.match(/<li[^>]*class="[^"]*product[^"]*"/g)).toHaveLength(SHOP_ITEMS.length);
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
    ['avatarBorder', 'Avatar borders', 21, 'Sakura wreath', 'Aurora weave'],
    ['cardBack', 'Card backs', 15, 'Aurora weave', 'Cat ears'],
    ['tableBackground', 'Table backgrounds', 15, 'Midnight aurora', 'Aurora weave'],
    ['seatBackground', 'Seat backgrounds', 15, 'Aurora window', 'Midnight aurora'],
    ['nameplate', 'Titles &amp; nameplates', 15, 'Night voyager nameplate', 'Cat ears'],
    ['stickerPack', 'Sticker packs', 15, 'Table talk', 'Cat ears'],
  ] as const)('restores the %s product type from the URL', (type, label, count, included, excluded) => {
    const html = render(`?type=${type}`);
    expect(html).toContain(`id="shop-catalog-title">${label}</h2>`);
    expect(html).not.toContain(`${count} products`);
    expect(html.match(/<li[^>]*class="[^"]*product[^"]*"/g)).toHaveLength(count);
    expect(html).toContain(`<h3>${included}</h3>`);
    expect(html).not.toContain(`<h3>${excluded}</h3>`);
  });

  it('ignores border series when browsing a different product type', () => {
    const html = render('?type=cardBack&series=ears');
    expect(html.match(/<li[^>]*class="[^"]*product[^"]*"/g)).toHaveLength(15);
    expect(html).toContain('Aurora weave');
  });

  it.each(SHOP_SERIES)('restores the %s collection across categories', (series) => {
    const html = render(`?series=${series}`);
    const products = SHOP_ITEMS.filter((product) => shopItemSeries(product) === series);
    expect(html.match(/<li[^>]*class="[^"]*product[^"]*"/g)).toHaveLength(products.length);
    expect(html).toContain(`${products.length} products`);
    expect(html).toContain(`data-series="${series}" aria-pressed="true"`);
    expect(html).not.toContain('shop.series.');
    for (const type of new Set(products.map((item) => item.type))) {
      const selected = render(`?series=${series}&type=${type}`);
      const count = products.filter((item) => item.type === type).length;
      expect(selected.match(/<li[^>]*class="[^"]*product[^"]*"/g)).toHaveLength(count);
      expect(selected).toContain(`data-shop-series="${series}"`);
      expect(selected).toContain(`${count} products`);
    }
  });

  it('retains the visible border category when clearing or changing a legacy series-only URL', () => {
    const current = new URLSearchParams('series=ears&unrelated=keep');
    for (const series of ['all', ...SHOP_SERIES] as const) {
      const next = shopSeriesQuery(current, 'avatarBorder', series);
      expect(next.get('type')).toBe('avatarBorder');
      expect(next.get('unrelated')).toBe('keep');
      expect(current.toString()).toBe('series=ears&unrelated=keep');
      const html = render(`?${next}`);
      const expected = SHOP_ITEMS.filter((item) => item.type === 'avatarBorder'
        && (series === 'all' || shopItemSeries(item) === series)).length;
      expect(html.match(/<li[^>]*class="[^"]*product[^"]*"/g) ?? []).toHaveLength(expected);
      expect(html).toContain('id="shop-catalog-title">Avatar borders</h2>');
    }
  });

  it.each(['en', 'zh-TW'] as const)('explains an empty category without losing the selected collection (%s)', (locale) => {
    useI18nStore.getState().setLocale(locale);
    const html = render('?series=cats&type=cardBack');
    expect(html.match(/<li[^>]*class="[^"]*product[^"]*"/g) ?? []).toHaveLength(0);
    expect(html).toContain('data-series="cats" aria-pressed="true"');
    expect(html).toContain(`role="status">${useI18nStore.getState().t('shop.emptyCollection')}</p>`);
    expect(html).toContain(locale === 'en' ? '0 products' : '0 項商品');
    expect(html).toContain(locale === 'en' ? 'Cat Cafe' : '貓咪茶屋');
    expect(html).not.toContain('shop.series.');
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
      for (const text of ['商品種類', '牌背', '稱號與名牌', '貼圖包', '櫻花花冠']) expect(html).toContain(text);
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
    expect(new Set(SHOP_STICKERS.map(({ id }) => id)).size).toBe(SHOP_STICKERS.length);
    for (const pack of SHOP_ITEMS.filter((item) => item.type === 'stickerPack')) {
      expect(SHOP_STICKERS.filter((sticker) => sticker.packId === pack.id)).toHaveLength(4);
    }
  });
});
