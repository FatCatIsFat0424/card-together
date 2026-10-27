import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Snackbar from '@mui/material/Snackbar';
import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import type { AchievementCategoryId } from '@shared/constants/achievements';
import type { AccountProfile, AchievementsStatus } from '@shared/types';
import { apiRequest } from '../api';
import { AppIcon } from '../components/AppIcon';
import { Button } from '../components/Button';
import { Tabs, tabElementId } from '../components/Tabs';
import { Nameplate } from '../components/Nameplate';
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
      <div className={styles.rewardBody}>
        <span className={styles.eyebrow}>{t('achievements.exclusive')}</span>
        <Nameplate id={category.reward} />
        <div className={styles.progressLabel}><span>{t('achievements.progress')}</span><strong>{percent}%</strong></div>
        <progress value={completed} max={category.items.length} aria-label={t('achievements.progress')} />
      </div>
      <div className={styles.rewardActions}>
        <Button variant="primary" disabled={pending || !eligible || state?.claimed}
          icon={state?.claimed ? 'check' : eligible ? 'trophy' : 'lock'} onClick={() => onClaim(categoryId)}>
          {t(state?.claimed ? 'achievements.claimed' : eligible ? 'achievements.claim' : 'achievements.locked')}
        </Button>
        {state?.claimed && <Link to="/account">{t('achievements.equip')}<AppIcon name="nextPage" /></Link>}
      </div>
    </div>
    <ul className={styles.items}>{category.items.map((item) =>
      <AchievementItem key={item.id} id={item.id} progress={progress(item.id)} />)}</ul>
  </section>;
}

export function AchievementsPage(): ReactNode {
  const { t } = useI18nStore();
  const account = useAccountStore((state) => state.account);
  const [selected, setSelected] = useState<AchievementCategoryId>('table');
  const [status, setStatus] = useState<AchievementsStatus | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const mounted = useRef(false);
  const version = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const onFocus = (): void => setRefresh((value) => value + 1);
    window.addEventListener('focus', onFocus);
    return () => { mounted.current = false; window.removeEventListener('focus', onFocus); };
  }, []);

  useEffect(() => {
    let active = true;
    const request = ++version.current;
    void apiRequest<{ achievements: AchievementsStatus }>('/api/auth/achievements').then((result) => {
      if (!active || request !== version.current) return;
      setError(!result.success);
      if (result.success) setStatus(result.achievements);
    });
    return () => { active = false; };
  }, [account?.id, account?.coinRevision, account?.updatedAt, refresh]);

  const claim = async (category: AchievementCategoryId): Promise<void> => {
    if (!account || busy.current) return;
    busy.current = true;
    setPending(true);
    ++version.current;
    const result = await apiRequest<{ account: AccountProfile; achievements: AchievementsStatus }>(
      '/api/auth/achievements/claim', 'POST', { category },
    );
    busy.current = false;
    if (!mounted.current || useAccountStore.getState().account?.id !== account.id) return;
    ++version.current;
    setPending(false);
    if (result.success) {
      setStatus(result.achievements);
      setError(false);
      useAccountStore.getState().setAccount(result.account);
      setNotice(t('achievements.success'));
    } else {
      setNotice(t('achievements.claimError'));
      setRefresh((value) => value + 1);
    }
  };

  const completedCount = (id: AchievementCategoryId): number => {
    const category = ACHIEVEMENT_CATEGORIES.find((entry) => entry.id === id)!;
    const state = status?.categories.find((entry) => entry.id === id);
    return category.items.filter((item) => state?.items.some((entry) => entry.id === item.id && entry.progress >= item.target)).length;
  };
  const done = ACHIEVEMENT_CATEGORIES.reduce((sum, category) => sum + completedCount(category.id), 0);
  const total = ACHIEVEMENT_CATEGORIES.reduce((sum, category) => sum + category.items.length, 0);

  return <main className={styles.page}>
    <header className={styles.header}>
      <h1><AppIcon name="trophy" />{t('achievements.title')}</h1>
      {status && <span className={styles.total}><AppIcon name="agree" />{t('achievements.total', { done: String(done), total: String(total) })}</span>}
    </header>
    {error && <div className={styles.error} role="alert">{t('achievements.error')}
      <Button onClick={() => setRefresh((value) => value + 1)}>{t('achievements.retry')}</Button></div>}
    {!status && !error && <p role="status">{t('common.loading')}</p>}
    {status && <>
      <Tabs<AchievementCategoryId> idPrefix="achievement" controls="achievement-panel" label={t('achievements.categories')}
        value={selected} onChange={setSelected} className={styles.categories}
        tabs={ACHIEVEMENT_CATEGORIES.map((category) => ({ id: category.id, label: <>
          {t(`achievements.${category.id}`)}
          <span className={styles.categoryCount}>{completedCount(category.id)}/{category.items.length}</span></> }))} />
      <div id="achievement-panel" role="tabpanel" aria-labelledby={tabElementId('achievement', selected)}>
        <AchievementDetails categoryId={selected} status={status} pending={pending} onClaim={(id) => { void claim(id); }} />
      </div>
    </>}
    <p className={styles.note}>{t('achievements.tracking')}</p>
    <Snackbar open={Boolean(notice)} message={notice} autoHideDuration={4500} onClose={() => setNotice('')} />
  </main>;
}
