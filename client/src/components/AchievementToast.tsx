import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import type { AchievementId } from '@shared/constants/achievements';
import { useAccountStore } from '../stores/account-store';
import { useAchievementNoticeStore } from '../stores/achievement-notice-store';
import { useMotionStore } from '../stores/motion-store';
import { AchievementItem } from './AchievementItem';
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

export function AchievementToast(): ReactNode {
  const accountId = useAccountStore((state) => state.account?.id);
  const noticeAccount = useAchievementNoticeStore((state) => state.accountId);
  const id = useAchievementNoticeStore((state) => state.queue[0]);
  return <div className={styles.toasts} role="status" aria-live="polite" aria-atomic="true">
    {accountId && accountId === noticeAccount && id && <Notice key={`${accountId}:${id}`} id={id} />}
  </div>;
}
