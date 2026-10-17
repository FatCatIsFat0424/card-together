import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SHOP_ITEMS, SHOP_SERIES, SHOP_STICKERS, shopItemSeries } from '@shared/constants';
import { Avatar } from '../../../client/src/components/Avatar';
import { Nameplate } from '../../../client/src/components/Nameplate';
import { shopArtworkUrl } from '../../../client/src/shop-art';
import { shopSeriesEmblem } from '../../../client/src/shop-series';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string): string => `/api/media/${id}` }));

const TYPES = new Set(SHOP_ITEMS.map((item) => item.type));

describe('complete themed shop collections', () => {
  it.each(SHOP_SERIES)('provides all product types and four stable stickers for %s', (series) => {
    const products = SHOP_ITEMS.filter((item) => shopItemSeries(item) === series);
    expect(products).toHaveLength(TYPES.size);
    expect(new Set(products.map((item) => item.type))).toEqual(TYPES);
    expect(SHOP_STICKERS.filter((item) => item.packId === `stickers-${series}`)).toHaveLength(4);
    for (const type of TYPES) {
      const product = products.find((item) => item.type === type)!;
      expect(SHOP_ITEMS.some((item) => item.type === type && shopItemSeries(item) === null
        && item.price === product.price)).toBe(true);
    }
  });

  it('keeps older products outside the new collections', () => {
    for (const id of ['cat', 'card-back-aurora', 'stickers-space', 'victory-tide']) {
      expect(shopItemSeries(SHOP_ITEMS.find((item) => item.id === id)!)).toBeNull();
    }
  });

  it.each(SHOP_SERIES)('bundles distinct, bounded animated vector scenes for %s', (series) => {
    const artwork = ['card-back', 'table', 'seat'].map((prefix) => {
      const product = SHOP_ITEMS.find((item) => item.id === `${prefix}-${series}`)!;
      expect(shopArtworkUrl(product.id)).toBeTruthy();
      const svg = readFileSync(resolve(__dirname, `../../../client/src/assets/shop/${product.id}.svg`), 'utf8');
      expect(svg).toContain('<svg id="still" xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('viewBox="');
      expect(svg).toContain('@keyframes');
      expect(svg).toContain('@media(prefers-reduced-motion:reduce)');
      expect(svg).not.toMatch(/<script|<foreignObject|\son\w+=|(?:href|src)="https?:/);
      return svg;
    });
    expect(new Set(artwork).size).toBe(3);
  });

  it.each(['en', 'zh-TW'] as const)('uses the series emblems and localized equipped titles (%s)', (locale) => {
    const previous = useI18nStore.getState().locale;
    useI18nStore.getState().setLocale(locale);
    try {
      for (const series of SHOP_SERIES) {
        const avatar = renderToStaticMarkup(createElement(Avatar, { avatar: 'fox', border: series }));
        const source = shopSeriesEmblem(series).replaceAll('&', '&amp;').replaceAll("'", '&#x27;').replaceAll('"', '&quot;');
        expect(avatar).toContain(source);
        expect(avatar).toContain('aria-hidden="true"');
        const title = SHOP_ITEMS.find((item) => item.type === 'nameplate' && shopItemSeries(item) === series)!;
        if (title.type !== 'nameplate') throw new Error('Missing collection nameplate');
        const nameplate = renderToStaticMarkup(createElement(Nameplate, { id: title.id }));
        expect(nameplate).toContain(source);
        expect(nameplate).not.toContain('shop.title.');
      }
    } finally {
      useI18nStore.getState().setLocale(previous);
    }
  });
});
