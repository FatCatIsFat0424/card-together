import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import type { AchievementCategoryId } from '@shared/constants/achievements';
import type { AchievementsStatus } from '@shared/types';
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
import { AchievementDetails } from '../../../client/src/pages/AchievementsPage';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

function render(categoryId: AchievementCategoryId, complete = false, claimed = false, pending = false): string {
  const status: AchievementsStatus = { categories: ACHIEVEMENT_CATEGORIES.map((category) => ({ id: category.id, claimed,
    items: category.items.map((item) => ({ id: item.id, progress: complete ? item.target : 0 })) })) };
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AchievementDetails, {
    categoryId, status, pending, onClaim: () => undefined,
  })));
}

describe('achievement categories', () => {
  it.each(['en', 'zh-TW'] as const)('renders every localized milestone and the exclusive title for each category in %s', (locale) => {
    useI18nStore.getState().setLocale(locale);
    for (const category of ACHIEVEMENT_CATEGORIES) {
      const html = render(category.id);
      expect(html.match(/<li /g)).toHaveLength(category.items.length);
      for (const item of category.items) expect(html).toContain(`data-achievement-id="${item.id}"`);
      expect(html).toContain(`data-nameplate="${category.reward}"`);
      expect(html).toContain('0%');
      expect(html).not.toMatch(/achievements\.|shop\.title\./);
      // An unfinished category shows the unlock hint instead of a claim button, and every tile a progress bar.
      expect(html).not.toContain('<button');
      expect(html).toContain(String(category.items.length));
      expect(html.match(/<progress /g)).toHaveLength(category.items.length + 1);
    }
  });
  it('shows the unlock hint for an unfinished category', () => {
    useI18nStore.getState().setLocale('zh-TW');
    expect(render('table')).toContain('完成全部 11 項解鎖');
    expect(render('table', true)).not.toContain('完成全部');
  });
  it('shows the description of a completed tile and a progress bar for a tile in progress', () => {
    useI18nStore.getState().setLocale('en');
    const complete = render('table', true);
    expect(complete.match(/<progress /g)).toHaveLength(1);
    expect(complete).toContain('Finish your first game.');
    expect(complete).toContain('1/1');
    expect(render('table')).toContain('0/1');
  });
  it('enables only complete unclaimed categories, then links to equipment after claiming', () => {
    useI18nStore.getState().setLocale('en');
    const ready = render('table', true);
    expect(ready).toContain('100%');
    expect(ready).toContain('Claim title');
    expect(ready).not.toContain('disabled=""');
    expect(render('table', true, false, true)).toContain('disabled=""');
    const claimed = render('table', true, true);
    expect(claimed).not.toContain('<button');
    expect(claimed).toContain('Title claimed');
    expect(claimed).toContain('href="/account"');
    expect(render('daily', true)).not.toContain('href="/account"');
  });
});
