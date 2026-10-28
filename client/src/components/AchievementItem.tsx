import type { ReactNode } from 'react';
import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import type { AchievementId } from '@shared/constants/achievements';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import styles from './AchievementItem.module.css';

/**
 * Milestone tile shared by the achievement list and the completion toast: medal, name and count on the first
 * line, then the description once complete or the progress bar while in progress.
 */
export function AchievementItem({ id, progress }: {
  readonly id: AchievementId; readonly progress: number;
}): ReactNode {
  const { t } = useI18nStore();
  const category = ACHIEVEMENT_CATEGORIES.find((entry) => entry.items.some((item) => item.id === id))!;
  const tier = category.items.findIndex((item) => item.id === id);
  const item = category.items[tier];
  const complete = progress >= item.target;
  const name = t(`achievements.${id}.name`);
  const description = t(`achievements.${id}.description`);
  return <li className={`${styles.item} ${complete ? styles.completed : ''}`} data-achievement-id={id}
    title={complete ? undefined : description}>
    <div className={`${styles.medal} ${styles[`tier${Math.min(tier, 3)}`]}`} aria-hidden="true"><AppIcon name={complete ? 'agree' : 'trophy'} /></div>
    <div className={styles.itemBody}>
      <div className={styles.head}>
        <h3>{name}</h3>
        <span className={styles.count}>
          {complete && <AppIcon name="check" />}
          <span className={styles.statusText}>{t(complete ? 'achievements.complete' : 'achievements.inProgress')}</span>
          {Math.min(progress, item.target)}/{item.target}
        </span>
      </div>
      {complete ? <p>{description}</p> : <>
        <progress value={progress} max={item.target} aria-label={name} />
        <span className={styles.statusText}>{description}</span>
      </>}
    </div>
  </li>;
}
