import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shopSeriesStickerTranslations } from '../../../client/src/shop-series-sticker-i18n';

const series = ['starfleet', 'shrine', 'ironfront', 'neoncity', 'crownrealm'] as const;
const states = ['ready', 'think', 'cheer', 'rest'] as const;
const clientRoot = resolve(__dirname, '../../../client/src');

describe('animated series stickers', () => {
  it('provides matching pack descriptions and sticker labels in both languages', () => {
    const expected = series.flatMap((key) => [
      `shop.item.stickers-${key}.name`,
      `shop.item.stickers-${key}.description`,
      ...states.map((state) => `shop.sticker.${key}-${state}`),
    ]);
    for (const dictionary of Object.values(shopSeriesStickerTranslations)) {
      expect(Object.keys(dictionary).sort()).toEqual([...expected].sort());
      for (const value of Object.values(dictionary)) expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(series)('bundles four distinct, self-contained, motion-accessible %s images', (key) => {
    const sources = states.map((state) => readFileSync(resolve(clientRoot, `assets/shop/stickers/${key}-${state}.svg`), 'utf8'));
    expect(new Set(sources).size).toBe(4);
    const imports = readFileSync(resolve(clientRoot, 'shop-stickers.ts'), 'utf8');
    for (const [index, source] of sources.entries()) {
      expect(imports).toContain(`./assets/shop/stickers/${key}-${states[index]}.svg?no-inline`);
      expect(source).toMatch(/<svg\b[^>]*width="220"[^>]*height="220"[^>]*viewBox="0 0 220 220"/);
      expect(source).toMatch(/<title\b[^>]*>[^<]+<\/title>/);
      expect(source).toContain('@keyframes');
      expect(source).toMatch(/class="(?:float|sway|glow)"/);
      expect(source).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.float[^}]*\.sway[^}]*\.glow[^}]*animation:\s*none/s);
      expect(source).not.toMatch(/<(?:animate\b|animateTransform\b|set\b|script\b|foreignObject\b|image\b)/i);
      expect(source).not.toMatch(/(?:href\s*=|url\s*\(|@import)/i);
    }
  });
});
