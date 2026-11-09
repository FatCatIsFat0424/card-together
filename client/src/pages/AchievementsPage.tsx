import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Snackbar from '@mui/material/Snackbar';
import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import type { AchievementCategoryId } from '@shared/constants/achievements';
import type { ProgressionRewardId } from '@shared/constants/progression';
import type { AccountProfile, AchievementsStatus, ProgressionStatus } from '@shared/types';
import { apiRequest } from '../api';
import { AppIcon } from '../components/AppIcon';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { Tabs, tabElementId } from '../components/Tabs';
import { Nameplate } from '../components/Nameplate';
import { ProgressionCollection, ProgressionGrowth } from '../components/ProgressionDetails';
import { AchievementItem } from '../components/AchievementItem';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import styles from './AchievementsPage.module.css';

export function AchievementDetails({ categoryId, status, pending, onClaim }: {
  readonly categoryId: AchievementCategoryId; readonly status: AchievementsStatus;
  readonly pending: boolean; readonly onClaim: (id: AchievementCategoryId) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const category = ACHIEVEMENT_CATEGORIES.find((entry) => entry.id === categoryId)!;
  const state = status.categories.find((entry) => entry.id === categoryId);
  const progress = (id: string): number => state?.items.find((entry) => entry.id === id)?.progress ?? 0;
  const completed = category.items.filter((item) => progress(item.id) >= item.target).length;
  const percent = Math.round(completed / category.items.length * 100);
  const eligible = completed === category.items.length;
  return <section className={styles.details} aria-label={t(`achievements.${categoryId}`)}>
    <div className={styles.reward}>
      <span className={styles.rewardTitle} title={t('achievements.exclusive')}>
        <Nameplate id={category.reward} />
        <span className={styles.srOnly}>{t('achievements.exclusive')}</span>
      </span>
      <progress value={completed} max={category.items.length} aria-label={t('achievements.progress')} />
      <strong className={styles.percent}>{percent}%</strong>
      {state?.claimed ? <>
        <span className={styles.hint}><AppIcon name="check" />{t('achievements.claimed')}</span>
        <Link className={styles.manage} to="/account">{t('achievements.equip')}<AppIcon name="nextPage" /></Link>
      </> : eligible ? <Button variant="primary" size="small" className={styles.claim} disabled={pending}
        icon="trophy" onClick={() => onClaim(categoryId)}>{t('achievements.claim')}</Button>
        : <span className={styles.hint}>{t('achievements.unlockHint', { n: String(category.items.length) })}</span>}
    </div>
    <ul className={styles.items}>{category.items.map((item) =>
      <AchievementItem key={item.id} id={item.id} progress={progress(item.id)} />)}</ul>
  </section>;
}

type ProgressSection = 'growth' | 'collection' | 'achievements';
type TitleClaim = { readonly kind: 'achievement'; readonly id: AchievementCategoryId }
  | { readonly kind: 'progression'; readonly id: ProgressionRewardId };

export function AchievementsPage(): ReactNode {
  const accountId = useAccountStore((state) => state.account?.id);
  return accountId ? <AccountAchievements key={accountId} accountId={accountId} /> : null;
}

function AccountAchievements({ accountId }: { readonly accountId: string }): ReactNode {
  const { t } = useI18nStore();
  const account = useAccountStore((state) => state.account);
  const [section, setSection] = useState<ProgressSection>('growth');
  const [selected, setSelected] = useState<AchievementCategoryId>('table');
  const [status, setStatus] = useState<AchievementsStatus | null>(null);
  const [progression, setProgression] = useState<ProgressionStatus | null>(null);
  const [legacyError, setLegacyError] = useState(false);
  const [progressionError, setProgressionError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(false);
  const [pendingReward, setPendingReward] = useState<ProgressionRewardId | null>(null);
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const mounted = useRef(false);
  const version = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const onFocus = (): void => setRefresh((value) => value + 1);
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (busy.current) return;
    let active = true;
    const request = ++version.current;
    const current = (): boolean => active && request === version.current
      && useAccountStore.getState().account?.id === accountId
      && useAccountStore.getState().account?.updatedAt === account?.updatedAt
      && useAccountStore.getState().account?.coinRevision === account?.coinRevision;
    void apiRequest<{ achievements: AchievementsStatus }>('/api/auth/achievements').then((result) => {
      if (!current()) return;
      setLegacyError(!result.success);
      if (result.success) setStatus(result.achievements);
    });
    void apiRequest<{ progression: ProgressionStatus }>('/api/auth/progression').then((result) => {
      if (!current()) return;
      setProgressionError(!result.success);
      if (result.success) setProgression(result.progression);
    });
    return () => { active = false; };
  }, [accountId, account?.coinRevision, account?.updatedAt, refresh]);

  const claim = async (target: TitleClaim): Promise<void> => {
    const legacy = target.kind === 'achievement';
    if (!account || busy.current) return;
    busy.current = true;
    setPending(true);
    setPendingReward(target.kind === 'progression' ? target.id : null);
    ++version.current;
    const result = legacy
      ? await apiRequest<{ account: AccountProfile; achievements: AchievementsStatus }>(
        '/api/auth/achievements/claim', 'POST', { category: target.id },
      )
      : await apiRequest<{ account: AccountProfile; progression: ProgressionStatus }>(
        '/api/auth/progression/claim', 'POST', { reward: target.id },
      );
    busy.current = false;
    if (!mounted.current || useAccountStore.getState().account?.id !== accountId) return;
    ++version.current;
    setPending(false);
    setPendingReward(null);
    if (result.success) {
      const current = useAccountStore.getState().account;
      const stale = current && (current.updatedAt > result.account.updatedAt
        || (current.coinRevision ?? -1) > (result.account.coinRevision ?? -1));
      if (!stale) {
        if ('achievements' in result) { setStatus(result.achievements); setLegacyError(false); }
        if ('progression' in result) { setProgression(result.progression); setProgressionError(false); }
      }
      useAccountStore.getState().setAccount(result.account);
      setNotice(t(legacy ? 'achievements.success' : 'progression.success'));
    } else {
      setNotice(t(legacy ? 'achievements.claimError' : 'progression.claimError'));
    }
    setRefresh((value) => value + 1);
  };

  const completedCount = (id: AchievementCategoryId): number => {
    const category = ACHIEVEMENT_CATEGORIES.find((entry) => entry.id === id)!;
    const state = status?.categories.find((entry) => entry.id === id);
    return category.items.filter((item) => state?.items.some((entry) => entry.id === item.id && entry.progress >= item.target)).length;
  };
  const error = section === 'achievements' ? legacyError : progressionError;
  const loading = section === 'achievements' ? !status : !progression;

  return <main className={styles.page}>
    <PageHeader title={t('progression.title')} titleHidden icon="trophy" iconColor="var(--color-gold)"
      tabs={<Tabs<ProgressSection> idPrefix="progression" controls="progression-panel"
        label={t('progression.sections')} value={section} onChange={setSection}
        tabs={(['growth', 'collection', 'achievements'] as const).map((id) => ({ id, label: t(`progression.${id}`) }))} />} />
    <div id="progression-panel" role="tabpanel" aria-labelledby={tabElementId('progression', section)}>
      {error && <div className={styles.error} role="alert">{t(section === 'achievements' ? 'achievements.error' : 'progression.error')}
        <Button disabled={pending} onClick={() => setRefresh((value) => value + 1)}>{t('achievements.retry')}</Button></div>}
      {loading && !error && <p role="status">{t('common.loading')}</p>}
      {section === 'growth' && progression && <ProgressionGrowth status={progression} pending={pendingReward} busy={pending}
        onClaim={(id) => { void claim({ kind: 'progression', id }); }} />}
      {section === 'collection' && progression && <ProgressionCollection status={progression} pending={pendingReward} busy={pending}
        onClaim={(id) => { void claim({ kind: 'progression', id }); }} />}
      {section === 'achievements' && status && <>
        <Tabs<AchievementCategoryId> idPrefix="achievement" controls="achievement-panel"
          label={t('achievements.categories')} value={selected} onChange={setSelected}
          tabs={ACHIEVEMENT_CATEGORIES.map((category) => ({ id: category.id, label: <>
            {t(`achievements.${category.id}`)}
            <span className={styles.categoryCount}>{completedCount(category.id)}/{category.items.length}</span></> }))} />
        <div id="achievement-panel" className={styles.legacyPanel} role="tabpanel" aria-labelledby={tabElementId('achievement', selected)}>
          <AchievementDetails categoryId={selected} status={status} pending={pending} onClaim={(id) => { void claim({ kind: 'achievement', id }); }} />
        </div>
      </>}
    </div>
    <p className={styles.note}>{t('achievements.tracking')}<br />{t('progression.private')}</p>
    <Snackbar open={Boolean(notice)} message={notice} autoHideDuration={4500} onClose={() => setNotice('')} />
  </main>;
}
