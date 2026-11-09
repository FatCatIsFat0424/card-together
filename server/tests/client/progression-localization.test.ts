import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROGRESSION_REWARDS } from '@shared/constants/progression';
import { ACHIEVEMENT_NAMEPLATES, SHOP_ITEMS } from '@shared/constants/shop';
import type { AccountProfile } from '@shared/types';
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/deployment', () => ({ APP_BASE_PATH: '/', API_BASE_URL: '', SERVER_URL: '', SOCKET_PATH: '/socket.io' }));
import { Nameplate } from '../../../client/src/components/Nameplate';
import { equipmentSlots } from '../../../client/src/components/EquipmentSettings';
import { progressionTranslations } from '../../../client/src/progression-i18n';
import { t } from '../../../client/src/i18n';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const account: AccountProfile = {
  id: 'owner', username: 'owner', nickname: 'Owner', color: '#ffffff', avatar: 'cat', avatarImage: null,
  tableBackground: null, tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100,
  matchesPublic: false, createdAt: 1, updatedAt: 1,
};

afterEach(() => { useI18nStore.getState().setLocale('zh-TW'); });

describe('progression localization and earned title integration', () => {
  it('provides identical nonempty keys and interpolation parameters in both locales', () => {
    expect(Object.keys(progressionTranslations.en).sort()).toEqual(Object.keys(progressionTranslations['zh-TW']).sort());
    for (const key of Object.keys(progressionTranslations.en) as (keyof typeof progressionTranslations.en)[]) {
      const en = progressionTranslations.en[key];
      const zh = progressionTranslations['zh-TW'][key];
      expect(en.trim()).not.toBe('');
      expect(zh.trim()).not.toBe('');
      expect(en.match(/\{\w+\}/g)?.sort() ?? []).toEqual(zh.match(/\{\w+\}/g)?.sort() ?? []);
    }
  });

  it.each(['en', 'zh-TW'] as const)('renders seventeen distinct earned titles without reusing legacy titles in %s', (locale) => {
    useI18nStore.getState().setLocale(locale);
    const titles = PROGRESSION_REWARDS.map((reward) => t(`shop.title.${reward.nameplate}`, locale));
    expect(new Set(titles).size).toBe(17);
    expect(titles).not.toContain(t('shop.title.nameplate-table-traveler', locale));
    expect(titles).not.toContain(t('shop.title.nameplate-daily-collector', locale));
    for (const reward of PROGRESSION_REWARDS) {
      const html = renderToStaticMarkup(createElement(Nameplate, { id: reward.nameplate }));
      expect(html).toContain(`data-nameplate="${reward.nameplate}"`);
      expect(html).toContain(t(`shop.title.${reward.nameplate}`, locale));
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toMatch(/<img|<svg|shop\.title\./);
    }
  });

  it.each(['en', 'zh-TW'] as const)('interpolates notification summaries and every familiarity stage in %s', (locale) => {
    expect(t('progression.notice.level', locale, { level: '5' })).toContain('5');
    expect(t('progression.notice.collection', locale, { n: '2' })).toContain('2');
    for (const stage of [0, 1, 2, 3, 4, 5] as const) {
      const game = t('gameType.bigtwo', locale);
      const name = t(`progression.stage.${stage}`, locale);
      const summary = t('progression.notice.familiarity', locale, { game, stage: name });
      expect(summary).toContain(game);
      expect(summary).toContain(name);
      expect(summary).not.toMatch(/\{|progression\./);
    }
  });

  it('offers owned milestone titles in the existing equipment slot without offering them for sale', () => {
    const owned = PROGRESSION_REWARDS.map((reward) => reward.nameplate);
    const slot = equipmentSlots({ ...account, ownedAchievementNameplates: owned, nameplate: 'nameplate-level-5' })
      .find((entry) => entry.target === 'nameplate')!;
    expect(slot.owned).toEqual(owned);
    expect(slot.current).toEqual({ kind: 'item', id: 'nameplate-level-5' });
    expect(equipmentSlots(account).find((entry) => entry.target === 'nameplate')!.owned).toEqual([]);
    for (const id of owned) {
      expect(ACHIEVEMENT_NAMEPLATES.some((item) => item.id === id)).toBe(true);
      expect(SHOP_ITEMS.some((item) => String(item.id) === id)).toBe(false);
    }
  });
});
