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
      expect(html).toMatch(/<button[^>]*disabled=""/);
    }
  });
  it('enables only complete unclaimed categories, then links to equipment after claiming', () => {
    const ready = render('table', true);
    expect(ready).toContain('100%');
    expect(ready).not.toContain('disabled=""');
    expect(render('table', true, false, true)).toContain('disabled=""');
    const claimed = render('table', true, true);
    expect(claimed).toContain('disabled=""');
    expect(claimed).toContain('href="/account"');
    expect(render('daily', true)).not.toContain('href="/account"');
  });
});
