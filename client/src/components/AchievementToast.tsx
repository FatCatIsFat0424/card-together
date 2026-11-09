import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import type { AchievementId } from '@shared/constants/achievements';
import { useAccountStore } from '../stores/account-store';
import { useAchievementNoticeStore } from '../stores/achievement-notice-store';
import { useProgressionNoticeStore } from '../stores/progression-notice-store';
import type { ProgressionNotice } from '../stores/progression-notice-store';
import { useI18nStore } from '../stores/i18n-store';
import { useMotionStore } from '../stores/motion-store';
import { AchievementItem } from './AchievementItem';
import { AppIcon } from './AppIcon';
import styles from './AchievementToast.module.css';

function Notice({ id }: { readonly id: AchievementId }): ReactNode {
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const systemReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const still = reducedMotion || systemReducedMotion;
  const [leaving, setLeaving] = useState(false);
  const item = ACHIEVEMENT_CATEGORIES.map((category) => category.items.find((entry) => entry.id === id))
    .find((entry) => entry !== undefined)!;
  useEffect(() => {
    const motionMs = still ? 0 : 200;
    const exit = window.setTimeout(() => setLeaving(true), motionMs + 3000);
    const finish = window.setTimeout(() => useAchievementNoticeStore.getState().dismiss(id), motionMs * 2 + 3000);
    return () => { window.clearTimeout(exit); window.clearTimeout(finish); };
  }, [id, still]);
  return <ul className={`${styles.notice} ${leaving ? styles.leaving : ''} ${still ? styles.still : ''}`}>
    <AchievementItem id={id} progress={item.target} />
  </ul>;
}

export function ProgressionNoticeContent({ notice }: { readonly notice: ProgressionNotice }): ReactNode {
  const { t } = useI18nStore();
  const stageKeys = ['progression.stage.0', 'progression.stage.1', 'progression.stage.2',
    'progression.stage.3', 'progression.stage.4', 'progression.stage.5'] as const;
  const text = notice.kind === 'level' ? t('progression.notice.level', { level: String(notice.level) })
    : notice.kind === 'collection' ? t('progression.notice.collection', { n: String(notice.stamps) })
      : t('progression.notice.familiarity', { game: t(`gameType.${notice.gameType}`),
        stage: t(stageKeys[notice.stage] ?? stageKeys[0]) });
  return <div className={styles.progression} data-progression-notice={notice.kind}>
    <AppIcon name="trophy" /><strong>{text}</strong>
  </div>;
}

function ProgressionToast({ notice }: { readonly notice: ProgressionNotice }): ReactNode {
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const systemReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const still = reducedMotion || systemReducedMotion;
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const motionMs = still ? 0 : 200;
    const exit = window.setTimeout(() => setLeaving(true), motionMs + 3000);
    const finish = window.setTimeout(() => useProgressionNoticeStore.getState().dismiss(notice.id), motionMs * 2 + 3000);
    return () => { window.clearTimeout(exit); window.clearTimeout(finish); };
  }, [notice.id, still]);
  return <div className={`${styles.notice} ${leaving ? styles.leaving : ''} ${still ? styles.still : ''}`}>
    <ProgressionNoticeContent notice={notice} />
  </div>;
}

export function AchievementToast(): ReactNode {
  const accountId = useAccountStore((state) => state.account?.id);
  const noticeAccount = useAchievementNoticeStore((state) => state.accountId);
  const id = useAchievementNoticeStore((state) => state.queue[0]);
  const progressAccount = useProgressionNoticeStore((state) => state.accountId);
  const progressNotice = useProgressionNoticeStore((state) => state.queue[0]);
  const legacyVisible = accountId && accountId === noticeAccount && id;
  return <div className={styles.toasts} role="status" aria-live="polite" aria-atomic="true">
    {legacyVisible ? <Notice key={`${accountId}:${id}`} id={id} />
      : accountId && accountId === progressAccount && progressNotice
        && <ProgressionToast key={`${accountId}:${progressNotice.id}`} notice={progressNotice} />}
  </div>;
}
