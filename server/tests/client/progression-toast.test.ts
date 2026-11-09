import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/socket', () => ({ disconnectSocket: vi.fn() }));
import { ProgressionNoticeContent } from '../../../client/src/components/AchievementToast';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import type { ProgressionNotice } from '../../../client/src/stores/progression-notice-store';

describe('progression toast content', () => {
  it.each(['en', 'zh-TW'] as const)('renders every summary in %s without untranslated keys', (locale) => {
    useI18nStore.getState().setLocale(locale);
    const notices: readonly ProgressionNotice[] = [
      { id: 'level:5', kind: 'level', level: 5 },
      { id: 'collection:3', kind: 'collection', stamps: 2 },
      { id: 'familiarity:bigtwo:2', kind: 'familiarity', gameType: 'bigtwo', stage: 2 },
      { id: 'familiarity:liarsdice:5', kind: 'familiarity', gameType: 'liarsdice', stage: 5 },
    ];
    const html = notices.map((notice) => renderToStaticMarkup(createElement(ProgressionNoticeContent, { notice })));
    expect(html[0]).toContain('Lv.5');
    expect(html[1]).toContain('2');
    expect(html[2]).toContain(locale === 'en' ? 'Big Two' : '大老二');
    expect(html[3]).toContain(locale === 'en' ? 'Old friend' : '老友');
    for (const item of html) {
      expect(item).not.toMatch(/progression\.|gameType\.|\{(?:n|level|game|stage)\}/);
      expect(item).not.toContain('<button');
    }
  });
});
