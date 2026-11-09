import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROGRESSION_REWARDS } from '@shared/constants/progression';
import type { ProgressionStatus } from '@shared/types';
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/socket', () => ({ socket: {} }));
// SSR uses Zustand's initial snapshot; read the selected test state for locale and account fixtures.
vi.mock('../../../client/src/stores/i18n-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../client/src/stores/i18n-store')>();
  return { ...actual, useI18nStore: Object.assign(() => actual.useI18nStore.getState(), actual.useI18nStore) };
});
vi.mock('../../../client/src/stores/account-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../client/src/stores/account-store')>();
  type State = ReturnType<typeof actual.useAccountStore.getState>;
  return { ...actual, useAccountStore: Object.assign((select: (state: State) => unknown) => select(actual.useAccountStore.getState()), actual.useAccountStore) };
});
import { AchievementsPage } from '../../../client/src/pages/AchievementsPage';
import { ProgressionCollection, ProgressionGrowth } from '../../../client/src/components/ProgressionDetails';
import { useAccountStore } from '../../../client/src/stores/account-store';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import { t } from '../../../client/src/i18n';
import type { Locale } from '../../../client/src/i18n';

function status(patch: Partial<ProgressionStatus> = {}): ProgressionStatus {
  return {
    level: { level: 1, games: 0, totalXp: '0', currentLevelXp: 0, nextLevelXp: 100, gamesToNextLevel: 1 },
    familiarity: [
      { gameType: 'bigtwo', games: 0, stage: 0, nextTarget: 1, since: null },
      { gameType: 'liarsdice', games: 0, stage: 0, nextTarget: 1, since: null },
    ],
    collection: [
      { id: 'bigtwo.fullHouses', gameType: 'bigtwo', recordId: 'fullHouses', rare: false, count: null, stamps: 0, tracked: false, since: null },
      { id: 'liarsdice.callsWon', gameType: 'liarsdice', recordId: 'callsWon', rare: false, count: 0, stamps: 0, tracked: true, since: 1_700_000_000_000 },
      { id: 'liarsdice.bidsHeld', gameType: 'liarsdice', recordId: 'bidsHeld', rare: false, count: 0, stamps: 0, tracked: true, since: 1_700_000_000_000 },
      { id: 'bigtwo.dragons', gameType: 'bigtwo', recordId: 'dragons', rare: true, count: 0, stamps: 0, tracked: true, since: 1_700_000_000_000 },
      { id: 'bigtwo.straightFlushes', gameType: 'bigtwo', recordId: 'straightFlushes', rare: true, count: null, stamps: 0, tracked: false, since: null },
      { id: 'bigtwo.fourOfAKinds', gameType: 'bigtwo', recordId: 'fourOfAKinds', rare: true, count: 0, stamps: 0, tracked: true, since: 1_700_000_000_000 },
      { id: 'liarsdice.exactBids', gameType: 'liarsdice', recordId: 'exactBids', rare: true, count: 0, stamps: 0, tracked: true, since: 1_700_000_000_000 },
    ],
    stamps: 0,
    rewards: PROGRESSION_REWARDS.map((reward) => ({ id: reward.id, eligible: false, claimed: false })),
    ...patch,
  };
}

function render(kind: 'growth' | 'collection', value = status(), pending: Parameters<typeof ProgressionGrowth>[0]['pending'] = null): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(kind === 'growth' ? ProgressionGrowth : ProgressionCollection, { status: value, pending, onClaim: () => undefined })));
}

afterEach(() => {
  useI18nStore.getState().setLocale('zh-TW');
  useAccountStore.setState({ account: null });
});

describe.each(['en', 'zh-TW'] as const)('private progression views in %s', (locale: Locale) => {
  it('shows a zero-progress level, next game, and all five familiarity milestones', () => {
    useI18nStore.getState().setLocale(locale);
    const html = render('growth');
    expect(html).toContain('Lv.1');
    expect(html).toContain('0 / 100 XP');
    expect(html).toContain(t('progression.nextLevel', locale, { n: '1', level: '2' }));
    expect(html).toContain(t('progression.skill', locale));
    expect(html).toContain(t('progression.stage.0', locale));
    expect(html).toContain(t('progression.history', locale));
    for (const n of [1, 5, 15, 30, 60]) expect(html).toContain(`<strong>${n}</strong>`);
    expect(html.match(/data-reward=/g)).toHaveLength(14);
    expect(html).not.toMatch(/shop\.title\.|progression\.|gameType\./);
    expect(html).not.toContain('Claim title</button>');
  });

  it('shows current-level XP independently from lifetime XP and confirms coverage', () => {
    useI18nStore.getState().setLocale(locale);
    const value = status({
      level: { level: 4, games: 8, totalXp: '800', currentLevelXp: 200, nextLevelXp: 400, gamesToNextLevel: 2 },
      familiarity: [{ gameType: 'bigtwo', games: 8, stage: 2, nextTarget: 15, since: 1_700_000_000_000 }],
    });
    const html = render('growth', value);
    expect(html).toContain('200 / 400 XP');
    expect(html).toContain('800 XP');
    expect(html).toContain(t('progression.nextLevel', locale, { n: '2', level: '5' }));
    expect(html).toContain(t('progression.familiarityNext', locale, { n: '7' }));
    expect(html).toContain(t('progression.coverage', locale, { date: new Date(1_700_000_000_000).toLocaleDateString(locale) }));
    expect(html).not.toContain('Replay');
  });

  it('preserves exact lifetime XP beyond Number precision at the cap without inventing Lv.51', () => {
    useI18nStore.getState().setLocale(locale);
    const html = render('growth', status({
      level: { level: 50, games: 100_000, totalXp: '900719925474099300', currentLevelXp: 0, nextLevelXp: null, gamesToNextLevel: null },
    }));
    expect(html).toContain('Lv.50');
    expect(html).toContain(BigInt('900719925474099300').toLocaleString(locale));
    expect(html).toContain(t('progression.cap', locale));
    expect(html).toContain(t('progression.capHint', locale));
    expect(html).not.toContain('Lv.51');
    expect(html).not.toContain('<progress');
  });

  it('distinguishes locked, eligible, pending and claimed titles without equipping', () => {
    useI18nStore.getState().setLocale(locale);
    const value = status({ rewards: PROGRESSION_REWARDS.map((reward) => ({
      id: reward.id, eligible: reward.id === 'level-5' || reward.id === 'level-10', claimed: reward.id === 'level-10',
    })) });
    const html = render('growth', value);
    expect(html).toContain('data-reward="level-5" data-state="eligible"');
    expect(html).toContain('data-reward="level-10" data-state="claimed"');
    expect(html).toContain('data-reward="level-15" data-state="locked"');
    expect(html).toContain(t('progression.eligible', locale));
    expect(html).toContain(t('achievements.claimed', locale));
    expect(html).toContain('href="/account"');
    expect(html).toContain(t('progression.manual', locale));
    expect(html.match(/<button /g)).toHaveLength(1);
    expect(html).not.toContain('disabled=""');
    expect(render('growth', value, 'level-5')).toContain('disabled=""');
    expect(render('growth', value, 'level-5')).toContain(t('progression.claiming', locale));
  });

  it('separates absent log evidence, known zeroes, stamp milestones and rare records', () => {
    useI18nStore.getState().setLocale(locale);
    const html = render('collection');
    expect(html.match(/data-collection=/g)).toHaveLength(7);
    expect(html.match(/data-reward=/g)).toHaveLength(3);
    expect(html).toContain(t('progression.missing', locale));
    expect(html).toContain(t('progression.missingHint', locale));
    expect(html).toContain(t('progression.recordCount', locale, { n: '0' }));
    expect(html).toContain(t('progression.rareHint', locale));
    expect(html).toContain(t('progression.nextReward', locale, { n: '1' }));
    expect(html).toContain(t('progression.filter', locale));
    expect(html.match(/<option /g)).toHaveLength(3);
    expect(html.match(/data-reached="false"/g)).toHaveLength(9);
    expect(html).not.toContain('href=');
    expect(html).not.toMatch(/progression\.|stats\.record\.|gameType\.|shop\.title\./);
  });

  it('shows the highest core collection reward with no rare records collected', () => {
    useI18nStore.getState().setLocale(locale);
    const zero = status();
    const value = status({ stamps: 6,
      collection: zero.collection.map((entry) => entry.rare ? entry : { ...entry, tracked: true, count: 5, stamps: 2 }),
      rewards: zero.rewards.map((reward) => ({ ...reward, eligible: reward.id.startsWith('collection-') })),
    });
    const html = render('collection', value);
    expect(html).toContain(t('progression.stamps', locale, { n: '6' }));
    expect(html).toContain(t('progression.allRewards', locale));
    expect(html).toContain('data-reward="collection-6" data-state="eligible"');
    expect(html.match(/data-reached="true"/g)).toHaveLength(6);
    expect(html.match(/data-collected="true"/g)).toHaveLength(3);
    expect(html.match(/<button /g)).toHaveLength(3);
    expect(render('collection', value, 'collection-6').match(/disabled=""/g)).toHaveLength(3);
  });

  it('keeps recorded rare counts separate from common stamps', () => {
    useI18nStore.getState().setLocale(locale);
    const value = status();
    const html = render('collection', { ...value, collection: value.collection.map((entry) => entry.id === 'bigtwo.dragons'
      ? { ...entry, count: 2 } : entry) });
    expect(html).toContain(t('progression.recordCount', locale, { n: '2' }));
    expect(html).toContain(t('progression.collected', locale));
    expect(html).toContain(t('progression.stamps', locale, { n: '0' }));
    expect(html).not.toContain('data-state="eligible"');
  });

  it('distinguishes complete saved coverage from progress without statistics and labels reached milestones', () => {
    useI18nStore.getState().setLocale(locale);
    const value = status();
    const growth = render('growth', { ...value, familiarity: [
      { gameType: 'bigtwo', games: 5, stage: 2, nextTarget: 15, since: null },
      { gameType: 'liarsdice', games: 0, stage: 0, nextTarget: 1, since: null },
    ] });
    expect(growth).toContain(t('progression.coverageAll', locale));
    expect(growth).toContain(t('progression.coveragePending', locale));
    expect(growth).toContain(`${t('progression.stageTarget', locale, { stage: t('progression.stage.2', locale), n: '5' })}: ${t('achievements.complete', locale)}`);
    const collection = render('collection', { ...value, collection: value.collection.map((entry) => entry.id === 'bigtwo.fullHouses'
      ? { ...entry, tracked: true, count: 1, stamps: 1, since: null } : entry) });
    expect(collection).toContain(t('progression.coverageAll', locale));
    expect(collection).toContain(`${t('progression.stampTarget', locale, { n: '1' })}: ${t('progression.collected', locale)}`);
    expect(collection).toContain(`${t('progression.stampTarget', locale, { n: '5' })}: ${t('progression.locked', locale)}`);
  });

  it('defaults the page to Growth and preserves three accessible section tabs', () => {
    useI18nStore.getState().setLocale(locale);
    useAccountStore.setState({ account: {
      id: 'owner', username: 'owner', nickname: 'Owner', color: '#ffffff', avatar: 'cat', avatarImage: null,
      tableBackground: null, tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100,
      matchesPublic: false, createdAt: 1, updatedAt: 1,
    } });
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AchievementsPage)));
    expect(html).toContain('id="progression-tab-growth" aria-selected="true"');
    for (const section of ['growth', 'collection', 'achievements'] as const) expect(html).toContain(t(`progression.${section}`, locale));
    expect(html).toContain('role="tabpanel" aria-labelledby="progression-tab-growth"');
    expect(html).toContain('role="status"');
    expect(html).toContain(t('progression.private', locale));
  });
});
