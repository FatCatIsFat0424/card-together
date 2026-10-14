import type { ReactNode } from 'react';
import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import type { AchievementId } from '@shared/constants/achievements';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import styles from './AchievementItem.module.css';

/** The same milestone card is used in the achievement list and completion toast. */
export function AchievementItem({ id, progress }: {
  readonly id: AchievementId; readonly progress: number;
}): ReactNode {
  const { t } = useI18nStore();
  const category = ACHIEVEMENT_CATEGORIES.find((entry) => entry.items.some((item) => item.id === id))!;
  const tier = category.items.findIndex((item) => item.id === id);
  const item = category.items[tier];
  const complete = progress >= item.target;
  return <li className={`${styles.item} ${complete ? styles.completed : ''}`} data-achievement-id={id}>
    <div className={`${styles.medal} ${styles[`tier${Math.min(tier, 3)}`]}`} aria-hidden="true"><AppIcon name={complete ? 'agree' : 'trophy'} /></div>
    <div className={styles.itemBody}>
      <h2>{t(`achievements.${id}.name`)}</h2>
      <p>{t(`achievements.${id}.description`)}</p>
      <div className={styles.itemProgress}>
        <progress value={progress} max={item.target} aria-label={t(`achievements.${id}.name`)} />
        <span>{progress} / {item.target}</span>
      </div>
    </div>
    <span className={styles.itemStatus}><AppIcon name={complete ? 'check' : 'circle'} />
      {t(complete ? 'achievements.complete' : 'achievements.inProgress')}</span>
  </li>;
}
