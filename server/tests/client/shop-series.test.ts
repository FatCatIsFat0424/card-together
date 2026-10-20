import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SHOP_ITEMS, SHOP_SERIES, SHOP_STICKERS, getShopItem, shopItemSeries } from '@shared/constants';
import { Avatar } from '../../../client/src/components/Avatar';
import { Nameplate } from '../../../client/src/components/Nameplate';
import { shopArtworkUrl } from '../../../client/src/shop-art';
import { shopSeriesArtwork, shopSeriesEmblem } from '../../../client/src/shop-series';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import { layeredSeriesEmblem } from '../../../client/src/cosmetics/art-layers/emblem-art-layers';

vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string): string => `/api/media/${id}` }));

const TYPES = new Set(SHOP_ITEMS.map((item) => item.type));
const ANIMATED_SERIES = ['starfleet', 'shrine', 'ironfront', 'neoncity', 'crownrealm'] as const;

describe('existing products grouped by theme', () => {
  it.each([
    ['aurora', ['card-back-aurora', 'nameplate-aurora', 'victory-aurora']],
    ['tide', ['tide', 'card-back-tide', 'nameplate-tide', 'stickers-ocean']],
    ['sakura', ['sakura', 'card-back-sakura', 'nameplate-sakura']],
    ['constellation', ['starlight', 'eclipse', 'card-back-constellation', 'stickers-space']],
    ['bamboo', ['card-back-bamboo', 'sound-bamboo']],
    ['gilded', ['gold', 'card-back-gilded']],
    ['ember', ['card-back-ember', 'stickers-dragons']],
    ['lotus', ['frog', 'card-back-lotus']],
    ['frost', ['card-back-frost', 'seat-frame-frost']],
    ['dune', ['card-back-dune', 'chips-dune']],
    ['cats', ['cat', 'stickers-cats']],
    ['forest', ['rabbit', 'bear', 'antlers', 'stickers-forest-friends']],
    ['dog', ['dog', 'nameplate-bark-lord']],
    ['rainbow', ['rainbow', 'nameplate-rainbow-pony', 'stickers-weather']],
    ['garden', ['nameplate-renewal', 'nameplate-lucky', 'stickers-garden']],
    ['neoncity', ['neon', 'stickers-arcade']],
  ] as const)('groups matching products under %s without changing their identity', (series, ids) => {
    expect(SHOP_SERIES).toContain(series);
    for (const id of ids) {
      const product = getShopItem(id)!;
      expect(product.id).toBe(id);
      expect(shopItemSeries(product)).toBe(series);
    }
  });

  it('keeps unrelated standalone products outside collections', () => {
    for (const id of ['copper', 'silver', 'cthulhu', 'card-face-four-color', 'stickers-snacks',
      'stickers-table-talk', 'nameplate-muckborn', 'nameplate-einstein', 'nameplate-planetary-devastation']) {
      expect(shopItemSeries(getShopItem(id)!)).toBeNull();
    }
  });

  it.each(SHOP_SERIES)('provides representative artwork and localized text for %s', (series) => {
    expect(SHOP_ITEMS.some((item) => shopItemSeries(item) === series)).toBe(true);
    const artwork = shopSeriesArtwork(series);
    expect(artwork).toBeTruthy();
    expect(artwork).not.toContain('undefined');
    expect(shopSeriesArtwork(series, true)).toBe(`${artwork}#still`);
    const previous = useI18nStore.getState().locale;
    try {
      for (const locale of ['en', 'zh-TW'] as const) {
        useI18nStore.getState().setLocale(locale);
        for (const suffix of ['name', 'description'] as const) {
          const key = `shop.series.${series}.${suffix}` as const;
          expect(useI18nStore.getState().t(key)).not.toBe(key);
        }
      }
    } finally {
      useI18nStore.getState().setLocale(previous);
    }
  });

  it('preserves the original marks and border decoration on existing equipment', () => {
    for (const [series, mark] of [['aurora', '✧'], ['tide', '≈'], ['sakura', '❀']] as const) {
      expect(shopSeriesEmblem(series)).toBeNull();
      const title = renderToStaticMarkup(createElement(Nameplate, { id: `nameplate-${series}` }));
      expect(title).toContain(mark);
      expect(title).not.toContain('<img');
    }
    for (const border of ['sakura', 'tide', 'dog', 'rainbow'] as const) {
      const avatar = renderToStaticMarkup(createElement(Avatar, { avatar: 'fox', border }));
      expect(avatar).not.toContain('<img');
      if (border === 'sakura' || border === 'tide') expect(avatar).toContain('<svg');
    }
  });
});

describe('complete themed shop collections', () => {
  it.each(ANIMATED_SERIES)('provides all product types and four stable stickers for %s', (series) => {
    const products = SHOP_ITEMS.filter((item) => shopItemSeries(item) === series);
    expect(new Set(products.map((item) => item.type))).toEqual(TYPES);
    expect(SHOP_STICKERS.filter((item) => item.packId === `stickers-${series}`)).toHaveLength(4);
    for (const type of TYPES) {
      const product = products.find((item) => item.type === type)!;
      expect(SHOP_ITEMS.some((item) => item.type === type && !item.id.endsWith(`-${series}`) && item.id !== series
        && item.price === product.price)).toBe(true);
    }
  });

  it.each(ANIMATED_SERIES)('bundles distinct, bounded animated vector scenes for %s', (series) => {
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
      for (const series of ANIMATED_SERIES) {
        const avatar = renderToStaticMarkup(createElement(Avatar, { avatar: 'fox', border: series }));
        // Emblems that animate are drawn as composited layers; static ones keep the original image.
        const layers = layeredSeriesEmblem(series)?.layers.flatMap((layer) => 'image' in layer ? [layer.image] : []);
        const sources = (layers ?? [shopSeriesEmblem(series)!])
          .map((source) => source.replaceAll('&', '&amp;').replaceAll("'", '&#x27;').replaceAll('"', '&quot;'));
        for (const source of sources) expect(avatar).toContain(source);
        expect(avatar).toContain('aria-hidden="true"');
        const title = SHOP_ITEMS.find((item) => item.type === 'nameplate' && shopItemSeries(item) === series)!;
        if (title.type !== 'nameplate') throw new Error('Missing collection nameplate');
        const nameplate = renderToStaticMarkup(createElement(Nameplate, { id: title.id }));
        for (const source of sources) expect(nameplate).toContain(source);
        expect(nameplate).not.toContain('shop.title.');
      }
    } finally {
      useI18nStore.getState().setLocale(previous);
    }
  });
});
