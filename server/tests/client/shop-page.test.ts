import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile, ShopItem } from '@shared/types';
import { SHOP_ITEMS, SHOP_STICKERS, SHOP_SERIES, shopItemSeries, ownsShopItem } from '@shared/constants';

const state = vi.hoisted(() => ({ account: {} as Partial<AccountProfile> }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: Partial<AccountProfile> }) => unknown) => select(state),
}));
vi.mock('../../../client/src/components/ShopProductArt', () => ({
  ShopProductArt: () => null,
  ShopProductPreview: ({ children }: { children: ReactNode }) => children,
}));

import {
  SHOP_GROUPS, resolveShopView, shopGroupQuery, shopSeriesQuery, shopTypeQuery, ungroupedShopTypes,
} from '../../../client/src/shop-filters';
import { ShopPage } from '../../../client/src/pages/ShopPage';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

function render(query = ''): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [`/shop${query}`] },
    createElement(ShopPage)));
}

const productCards = (html: string): string[] => html.match(/<li[^>]*class="[^"]*product[^"]*"/g) ?? [];
const names = (html: string): string[] => [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((match) => match[1]);
const selectedOption = (value: string): string => `<option value="${value}" selected="">`;
const groupItems = (group: string): ShopItem[] => {
  const types: readonly string[] = SHOP_GROUPS.find((entry) => entry.id === group)?.types ?? [];
  return SHOP_ITEMS.filter((item) => types.includes(item.type));
};
const unseried = (items: readonly ShopItem[]): ShopItem[] => items.filter((item) => shopItemSeries(item) === null);

describe('shop groups, type chips and inventory', () => {
  beforeEach(() => {
    useI18nStore.getState().setLocale('en');
    state.account = { id: 'shopper', avatar: 'cat', color: '#4a9eff', coins: 200,
      ownedAvatarBorders: ['copper'], ownedShopItems: [] };
  });

  it('shows the first group with group tabs, type chips and per-type counts', () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Shop sections"');
    expect(html).toContain('<nav class="_types');
    expect(html).toContain('aria-label="Product categories"');
    // Only the selected group's products render; the type chips carry the totals.
    expect(productCards(html)).toHaveLength(groupItems('personal').length);
    expect(html).not.toContain(`${SHOP_ITEMS.length} products`);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>All products<span[^>]*>66<\/span>/);
    expect(html).toContain('aria-label="Equip Brushed copper"');
    expect(html).toContain('aria-label="Buy Puppy ears"');
  });

  it('lists the groups that have products and hides empty future groups', () => {
    const html = render();
    for (const label of ['Personal', 'Table', 'Playing cards']) {
      expect(html).toMatch(new RegExp(`role="tab"[^>]*>${label}</button>`));
    }
    for (const label of ['Board games', 'Dice']) expect(html).not.toContain(label);
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(resolveShopView(new URLSearchParams(), SHOP_ITEMS).groups).toEqual(['personal', 'table', 'cards']);
    // A group appears as soon as one of its types has a product.
    const onlyCards = SHOP_ITEMS.filter((item) => item.type === 'cardBack');
    expect(resolveShopView(new URLSearchParams(), onlyCards).groups).toEqual(['cards']);
    expect(resolveShopView(new URLSearchParams(), []).groups).toEqual([]);
  });

  it('puts every product type in exactly one group', () => {
    expect(ungroupedShopTypes(SHOP_ITEMS)).toEqual([]);
    const types = SHOP_GROUPS.flatMap((group) => group.types);
    expect(new Set(types).size).toBe(types.length);
    expect(SHOP_GROUPS.reduce((sum, group) => sum + groupItems(group.id).length, 0)).toBe(SHOP_ITEMS.length);
  });

  it.each([
    ['personal', 66, 'Cat ears', 'Aurora weave', 'Personal'],
    ['table', 75, 'Midnight aurora', 'Aurora weave', 'Table'],
    ['cards', 46, 'Aurora weave', 'Midnight aurora', 'Playing cards'],
  ] as const)('restores the %s group from the URL', (group, count, included, excluded, label) => {
    const html = render(`?group=${group}`);
    expect(productCards(html)).toHaveLength(count);
    expect(names(html)).toContain(included);
    expect(names(html)).not.toContain(excluded);
    expect(html).toMatch(new RegExp(`aria-selected="true"[^>]*>${label}</button>`));
  });

  it('builds group and type queries that drop what no longer applies', () => {
    const current = new URLSearchParams('type=cardBack&series=ears&unrelated=keep&group=cards');
    const group = shopGroupQuery(current, 'table');
    expect([group.get('group'), group.get('type'), group.get('series'), group.get('unrelated')])
      .toEqual(['table', null, null, 'keep']);
    expect(current.toString()).toBe('type=cardBack&series=ears&unrelated=keep&group=cards');
    const type = shopTypeQuery(new URLSearchParams('group=table&series=aurora'), 'seatFrame', 'table');
    expect([type.get('type'), type.get('group'), type.get('series')]).toEqual(['seatFrame', null, 'aurora']);
    const all = shopTypeQuery(new URLSearchParams('type=seatFrame'), 'all', 'table');
    expect([all.get('type'), all.get('group')]).toEqual([null, 'table']);
  });

  it.each([
    ['ears', 'Playful', 6, 'Cat ears', 'Brushed copper'],
    ['metal', 'Metal', 3, 'Brushed copper', 'Cat ears'],
    ['special', 'Glow', 12, 'Lunar eclipse', 'Cat ears'],
  ] as const)('restores the %s series from the URL', (series, label, count, included, excluded) => {
    const html = render(`?series=${series}`);
    expect(html).toMatch(new RegExp(`id="shop-catalog-title"[^>]*>${label}</h2>`));
    expect(html).toContain(`${count} products`);
    expect(productCards(html)).toHaveLength(count);
    expect(names(html)).toContain(included);
    expect(names(html)).not.toContain(excluded);
    expect(html).toContain(selectedOption(series));
    expect(html).toMatch(/aria-pressed="true"[^>]*>Avatar borders</);
  });

  it.each(['?series=unknown', '?series=cats', '?series=forest', '?series=dog', '?series=rainbow', '?series=garden',
    '?type=unknown', '?series=', '?unrelated=metal', '?group=chess', '?group=unknown'])(
    'falls back to the first group for %s', (query) => {
      const html = render(query);
      expect(productCards(html)).toHaveLength(groupItems('personal').length);
      expect(html).toMatch(/id="shop-catalog-title"[^>]*>Personal<\/h2>/);
    });

  it('translates navigation, selected series, and products into Traditional Chinese', () => {
    useI18nStore.getState().setLocale('zh-TW');
    const html = render('?series=metal');
    for (const text of ['商品種類', '商店分類', '個人形象', '牌桌', '撲克牌', '系列：', '頭像邊框', '俏皮造型', '金屬系列',
      '光環系列', '3 項商品', '霧光銅框']) {
      expect(html).toContain(text);
    }
    expect(html).toMatch(/id="shop-catalog-title"[^>]*>金屬系列<\/h2>/);
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
    expect(html).toMatch(new RegExp(`id="shop-catalog-title"[^>]*>${label}</h2>`));
    expect(html).not.toContain(`${count} products`);
    expect(productCards(html)).toHaveLength(count);
    expect(names(html)).toContain(included);
    expect(names(html)).not.toContain(excluded);
  });

  it('ignores border series when browsing a different product type', () => {
    const html = render('?type=cardBack&series=ears');
    expect(productCards(html)).toHaveLength(15);
    expect(names(html)).toContain('Aurora weave');
    expect(html).toContain(selectedOption('all'));
  });

  it.each(SHOP_SERIES)('restores the %s collection within its group', (series) => {
    const html = render(`?series=${series}`);
    const view = resolveShopView(new URLSearchParams(`series=${series}`), SHOP_ITEMS);
    const products = groupItems(view.group).filter((product) => shopItemSeries(product) === series);
    expect(products.length).toBeGreaterThan(0);
    expect(productCards(html)).toHaveLength(products.length);
    expect(html).toContain(`${products.length} products`);
    expect(html).toContain(selectedOption(series));
    expect(html).not.toContain('shop.series.');
    for (const type of new Set(products.map((item) => item.type))) {
      const selected = render(`?series=${series}&type=${type}`);
      const count = products.filter((item) => item.type === type).length;
      expect(productCards(selected)).toHaveLength(count);
      expect(selected).toContain(`data-shop-series="${series}"`);
      expect(selected).toContain(`${count} products`);
    }
  });

  it('opens the first group that has products of a collection', () => {
    const view = resolveShopView(new URLSearchParams('series=starfleet'), SHOP_ITEMS);
    expect(groupItems(view.group).some((item) => shopItemSeries(item) === 'starfleet')).toBe(true);
    expect(resolveShopView(new URLSearchParams('series=starfleet&group=cards'), SHOP_ITEMS).group).toBe('cards');
  });

  it('retains the visible border category when clearing or changing a legacy series-only URL', () => {
    const current = new URLSearchParams('series=ears&unrelated=keep');
    for (const series of ['all', 'other', ...SHOP_SERIES] as const) {
      const next = shopSeriesQuery(current, 'avatarBorder', series);
      expect(next.get('type')).toBe('avatarBorder');
      expect(next.get('unrelated')).toBe('keep');
      expect(current.toString()).toBe('series=ears&unrelated=keep');
      const html = render(`?${next}`);
      const expected = SHOP_ITEMS.filter((item) => item.type === 'avatarBorder'
        && (series === 'all' || shopItemSeries(item) === (series === 'other' ? null : series))).length;
      expect(productCards(html)).toHaveLength(expected);
      expect(html).toMatch(/id="shop-catalog-title"[^>]*>Avatar borders<\/h2>/);
    }
  });

  it('ignores a removed series alongside a product type', () => {
    const html = render('?series=cats&type=cardBack');
    expect(productCards(html)).toHaveLength(15);
    expect(html).toMatch(/id="shop-catalog-title"[^>]*>Card backs<\/h2>/);
    expect(html).not.toContain(useI18nStore.getState().t('shop.emptyCollection'));
  });

  it('lists every product of the group without a series under the other filter', () => {
    const products = unseried(groupItems('personal'));
    const html = render('?series=other');
    expect(productCards(html)).toHaveLength(products.length);
    expect(html).toContain(`${products.length} products`);
    expect(html).toContain(selectedOption('other'));
    expect(html).not.toContain('data-shop-series=');
    expect(names(html)).toContain('Puppy ears');
    expect(names(html)).toContain('Brushed copper');
    expect(names(html)).not.toContain('Aurora weave');
    // The option follows every themed series.
    expect(html.indexOf('value="crownrealm"')).toBeLessThan(html.indexOf('value="other"'));
  });

  it.each(['avatarBorder', 'nameplate', 'stickerPack', 'cardFace'] as const)(
    'combines the other filter with the %s product type', (type) => {
      const products = SHOP_ITEMS.filter((item) => item.type === type && shopItemSeries(item) === null);
      const html = render(`?series=other&type=${type}`);
      expect(productCards(html)).toHaveLength(products.length);
      expect(html).toContain(`${products.length} products`);
      expect(html).toContain(selectedOption('other'));
      // The type chips count only products without a series.
      const group = SHOP_GROUPS.find((entry) => (entry.types as readonly string[]).includes(type));
      const total = unseried(groupItems(group?.id ?? '')).length;
      expect(html).toMatch(new RegExp(`>All products<span[^>]*>${total}</span>`));
    });

  it('shows the empty state when no unseried product matches the product type', () => {
    const html = render('?series=other&type=cardBack');
    expect(productCards(html)).toHaveLength(0);
    expect(html).toContain(selectedOption('other'));
    expect(html).toContain('role="status"');
  });

  it('keeps the other filter when switching product type and builds its query', () => {
    const next = shopSeriesQuery(new URLSearchParams('unrelated=keep'), 'nameplate', 'other');
    expect(next.get('series')).toBe('other');
    expect(next.get('type')).toBe('nameplate');
    expect(next.get('unrelated')).toBe('keep');
  });

  it('translates the other filter into Traditional Chinese', () => {
    useI18nStore.getState().setLocale('zh-TW');
    const html = render('?series=other');
    expect(html).toContain('其他');
    expect(html).not.toContain('shop.otherSeries');
  });

  it.each(['en', 'zh-TW'] as const)('explains an empty category without losing the selected collection (%s)', (locale) => {
    useI18nStore.getState().setLocale(locale);
    const html = render('?series=aurora&type=avatarBorder');
    expect(productCards(html)).toHaveLength(0);
    expect(html).toContain(selectedOption('aurora'));
    expect(html).toContain(`role="status">${useI18nStore.getState().t('shop.emptyCollection')}</p>`);
    expect(html).toContain(locale === 'en' ? '0 products' : '0 項商品');
    expect(html).toContain(locale === 'en' ? 'Northern Lights' : '極光夜旅');
    expect(html).not.toContain('shop.series.');
  });

  it('labels owned cosmetics for equipping and keeps equipped products and owned packs informational', () => {
    state.account = { ...state.account, cardBackStyle: 'card-back-aurora',
      ownedShopItems: ['card-back-aurora', 'table-tide', 'stickers-table-talk'] };
    expect(render('?type=cardBack')).toMatch(
      /aria-label="Aurora weave \(equipped\)"[^>]*>.*?Equipped<\/button>/);
    expect(render('?type=tableBackground')).toContain('aria-label="Equip Quiet lagoon"');
    expect(render('?type=stickerPack')).toMatch(/aria-label="Table talk \(owned\)"[^>]*>Owned<\/button>/);
  });

  it('shows the price or the ownership state on each card', () => {
    state.account = { ...state.account, ownedShopItems: ['card-back-aurora'] };
    const html = render('?type=cardBack');
    expect(html).toMatch(/data-state="owned"[^>]*>Owned<\/button>/);
    expect(html.match(/data-state="buy"/g)).toHaveLength(14);
    expect(html).toContain('120</button>');
  });

  it('explains visibility once beside the selected category heading, not on product cards', () => {
    expect(render()).not.toContain('Only you see this card back.');
    const cardBacks = render('?type=cardBack');
    expect(cardBacks.match(/Only you see this card back\./g)).toHaveLength(1);
    expect(cardBacks).toMatch(/<h2 id="shop-catalog-title"[^>]*>Card backs<\/h2><p[^>]*>Only you see this card back\./);
    expect(render('?type=stickerPack')).toContain('Use in room chat and private messages.');
    expect(render('?type=avatarBorder')).not.toMatch(/<h2 id="shop-catalog-title"[^>]*>[^<]*<\/h2><p/);
  });

  it.each(['en', 'zh-TW'] as const)('translates every product and its visibility (%s)', (locale) => {
    useI18nStore.getState().setLocale(locale);
    for (const group of SHOP_GROUPS.filter((entry) => entry.types.length > 0)) {
      const html = render(`?group=${group.id}`);
      for (const prefix of ['shop.item.', 'shop.visibility.', 'shop.type.', 'shop.group.']) expect(html).not.toContain(prefix);
      for (const type of group.types) expect(render(`?type=${type}`)).not.toContain('shop.visibility.');
    }
    if (locale === 'zh-TW') {
      const html = render();
      for (const text of ['商品種類', '稱號與名牌', '貼圖包', '個人形象']) expect(html).toContain(text);
      expect(render('?type=cardBack')).toContain('牌背');
      expect(render('?type=avatarBorder')).toContain('櫻花花冠');
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
