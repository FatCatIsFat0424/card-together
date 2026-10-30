import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AccountMenuLinks } from '../../../client/src/components/AccountMenuLinks';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

describe('personal menu destinations', () => {
  it.each(['en', 'zh-TW'] as const)('distinguishes public profile from private settings in %s', (locale) => {
    useI18nStore.getState().setLocale(locale);
    const { t } = useI18nStore.getState();
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/account'] },
      createElement(AccountMenuLinks, { accountId: 'a b' })));
    expect(html).toContain('href="/players/a%20b"');
    expect(html).toContain('href="/account"');
    expect(html).toContain(t('player.myProfile'));
    expect(html).toContain(t('accountMenu.profileHint'));
    expect(html).toContain(t('accountMenu.settingsHint'));
    expect(html).toMatch(/aria-current="page"[^>]*class="[^"]*"[^>]*href="\/account"/);
    expect(html).not.toContain('#match-history');
  });
});
