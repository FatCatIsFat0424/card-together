import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHIP_STYLES } from '@shared/constants';
const equipped = vi.hoisted(() => ({ style: null as string | null }));

// Server rendering reads the store's initial state, so the hook is stubbed to a chosen account value.
vi.mock('../../../client/src/cosmetics/chip-styles/use-chip-style', async () => {
  const { resolveChipStyle } = await import('../../../client/src/cosmetics/chip-styles/chip-designs');
  return { useChipStyle: () => resolveChipStyle(equipped.style) };
});

import { ChipIcon } from '../../../client/src/games/ChipIcon';
import { ChipDisc } from '../../../client/src/cosmetics/chip-styles/ChipDisc';
import { CHIP_DESIGNS, resolveChipStyle } from '../../../client/src/cosmetics/chip-styles/chip-designs';
import { chipStylesTranslations } from '../../../client/src/cosmetics/chip-styles/i18n';

describe('chip styles', () => {
  beforeEach(() => { equipped.style = null; });

  it('should design and translate every catalog chip', () => {
    for (const { id } of CHIP_STYLES) {
      expect(CHIP_DESIGNS[id]).toBeDefined();
      expect(chipStylesTranslations.en[`shop.item.${id}.name` as keyof typeof chipStylesTranslations.en]).toBeTruthy();
      expect(chipStylesTranslations['zh-TW'][`shop.item.${id}.description` as keyof typeof chipStylesTranslations.en]).toBeTruthy();
    }
    expect(Object.keys(CHIP_DESIGNS)).toHaveLength(CHIP_STYLES.length);
  });

  it('should keep every chip decorative and free of shared ids', () => {
    for (const { id } of CHIP_STYLES) {
      const html = renderToStaticMarkup(createElement(ChipDisc, { style: id }));
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toMatch(/\sid="|url\(#/);
    }
  });

  it('should resolve only catalog ids', () => {
    expect(resolveChipStyle('chips-gilded')).toBe('chips-gilded');
    expect(resolveChipStyle('chips-removed')).toBeNull();
    expect(resolveChipStyle('toString')).toBeNull();
    expect(resolveChipStyle(null)).toBeNull();
  });

  it('should keep the default chip when no style is equipped or the id is unknown', () => {
    const defaults = renderToStaticMarkup(createElement(ChipIcon));
    expect(defaults).toContain('<span');
    expect(defaults).not.toContain('<svg');
    equipped.style = 'chips-removed';
    expect(renderToStaticMarkup(createElement(ChipIcon))).toBe(defaults);
  });

  it('should draw the equipped chip in every chip icon', () => {
    equipped.style = 'chips-ember';
    const html = renderToStaticMarkup(createElement(ChipIcon));
    expect(html).toContain('<svg');
    expect(html).toContain('data-chip-style="chips-ember"');
    expect(html).toContain('aria-hidden="true"');
  });
});
