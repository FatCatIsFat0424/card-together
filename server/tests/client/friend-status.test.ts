import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../../client/src/i18n';
import type { Locale, TranslationKey } from '../../../client/src/i18n';

const state = vi.hoisted(() => ({ locale: 'zh-TW' as Locale }));
vi.mock('../../../client/src/stores/i18n-store', () => ({
  useI18nStore: () => ({ locale: state.locale,
    t: (key: TranslationKey, params?: Record<string, string>) => t(key, state.locale, params) }),
}));

import { FriendStatus, formatFriendLastSeen } from '../../../client/src/components/FriendStatus';

const NOW = Date.UTC(2026, 9, 18, 12);
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

describe('friend last online status', () => {
  afterEach(() => { vi.restoreAllMocks(); state.locale = 'zh-TW'; });

  it.each([
    [0, '剛剛', 'just now'],
    [MINUTE_MS - 1, '剛剛', 'just now'],
    [MINUTE_MS, '1 分鐘前', '1 minute ago'],
    [2 * MINUTE_MS, '2 分鐘前', '2 minutes ago'],
    [HOUR_MS - 1, '59 分鐘前', '59 minutes ago'],
    [HOUR_MS, '1 小時前', '1 hour ago'],
    [2 * HOUR_MS, '2 小時前', '2 hours ago'],
    [DAY_MS - 1, '23 小時前', '23 hours ago'],
    [DAY_MS, '1 天前', '1 day ago'],
    [29 * DAY_MS, '29 天前', '29 days ago'],
    [30 * DAY_MS, '30 天前', '30 days ago'],
    [30 * DAY_MS + 1, '30 天以上', '30+ days ago'],
    [365 * DAY_MS, '30 天以上', '30+ days ago'],
  ])('formats an elapsed duration of %i ms in both languages', (elapsed, chinese, english) => {
    expect(formatFriendLastSeen(NOW - elapsed, 'zh-TW', NOW)).toBe(`上次上線：${chinese}`);
    expect(formatFriendLastSeen(NOW - elapsed, 'en', NOW)).toBe(`Last online: ${english}`);
  });

  it.each([null, NaN, Infinity, -1, 1.5])('labels unavailable or invalid timestamps as unknown (%s)', (timestamp) => {
    expect(formatFriendLastSeen(timestamp, 'zh-TW', NOW)).toBe('上次上線：時間未知');
    expect(formatFriendLastSeen(timestamp, 'en', NOW)).toBe('Last online: unknown');
  });

  it('treats a timestamp ahead of the client clock as just now', () => {
    expect(formatFriendLastSeen(NOW + HOUR_MS, 'zh-TW', NOW)).toBe('上次上線：剛剛');
  });

  it.each(['zh-TW', 'en'] as const)('shows the online status instead of historical time (%s)', (locale) => {
    state.locale = locale;
    const html = renderToStaticMarkup(createElement(FriendStatus, { friend: { online: true, lastSeenAt: 1 } }));
    expect(html).toContain(t('friends.online', locale));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('30');
    expect(html).not.toContain(t('friends.lastSeen', locale, { time: '' }));
  });

  it.each(['zh-TW', 'en'] as const)('renders capped offline status without disclosing the exact date (%s)', (locale) => {
    state.locale = locale;
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const html = renderToStaticMarkup(createElement(FriendStatus, {
      friend: { online: false, lastSeenAt: NOW - 31 * DAY_MS },
    }));
    expect(html).toContain(t('friends.lastSeen', locale, { time: t('friends.lastSeenOver30Days', locale) }));
    expect(html).not.toContain('aria-hidden');
    expect(html).not.toContain('2026');
    expect(html).not.toContain('title=');
  });

  it('renders the unknown state for an offline legacy account', () => {
    expect(renderToStaticMarkup(createElement(FriendStatus, { friend: { online: false, lastSeenAt: null } })))
      .toContain('上次上線：時間未知');
  });
});
