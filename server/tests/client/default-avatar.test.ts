import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AvatarId } from '@shared/types';

vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string): string => `/api/media/${id}` }));

import { Avatar } from '../../../client/src/components/Avatar';
import { AvatarBorder } from '../../../client/src/components/AvatarBorder';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const render = (props: Parameters<typeof Avatar>[0]): string => renderToStaticMarkup(createElement(Avatar, props));
const LEGACY: readonly AvatarId[] = ['cat', 'fox', 'owl', 'bear', 'rabbit', 'panda'];
const EMOJI = /[\u{1F400}-\u{1FAFF}]/u;

afterEach(() => useI18nStore.getState().setLocale('zh-TW'));

describe('default avatar', () => {
  it('shows one picture for every legacy preset and for none at all', () => {
    const plain = render({});
    expect(plain.match(/<img /g)).toHaveLength(1);
    expect(plain).not.toMatch(EMOJI);
    for (const avatar of LEGACY) expect(render({ avatar })).toBe(plain);
  });

  it('prefers an uploaded picture over the default', () => {
    const html = render({ avatar: 'fox', image: 'a'.repeat(64) + '.png' });
    expect(html).toContain('/api/media/');
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).not.toContain('data:image/svg+xml');
  });

  it('keeps the owl for seats filled by bots only', () => {
    const bot = render({ avatar: 'bot' });
    expect(bot).toContain('🦉');
    expect(bot).not.toContain('<img');
    expect(render({ avatar: 'owl' })).not.toContain('🦉');
  });

  it.each([['en', 'Avatar'], ['zh-TW', '頭像']] as const)('names the picture in %s', (locale, name) => {
    useI18nStore.getState().setLocale(locale);
    expect(render({})).toContain(`aria-label="${name}"`);
  });

  it('draws the default picture inside every border decoration', () => {
    for (const border of ['cat', 'antlers', 'cthulhu', 'sakura', 'gold'] as const) {
      const framed = render({ border });
      expect(framed.match(/<img /g)).toHaveLength(1);
      expect(framed).not.toMatch(EMOJI);
    }
    const preview = renderToStaticMarkup(createElement(AvatarBorder, { border: 'antlers' }));
    expect(preview.match(/<img /g)).toHaveLength(1);
  });
});
