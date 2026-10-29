import type { ReactNode } from 'react';
import type { PresentationFrame } from '@shared/game-presentation';
import type { GameSeat } from '@shared/types';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { napoleonCardText, napoleonNotice } from './napoleon-view';
import styles from './NapoleonFrame.module.css';

/**
 * Notice under a Napoleon call or summon frame. The shared frame already shows the card; this adds
 * what it means for the viewer, so the secretary learns their role and the summoned seat is alerted.
 */
export function NapoleonFrame({ frame, name }: { frame: PresentationFrame; name: (seat: GameSeat) => string }): ReactNode {
  const { t } = useI18nStore();
  const game = useGameStore((state) => state.napoleon);
  if (!game) return null;
  const notice = napoleonNotice(game, frame);
  if (!notice) return null;
  const jokerName = (joker: 'big' | 'small'): string => t(`cards.joker.${joker}`);

  if (notice.kind === 'secretaryCard') {
    const card = napoleonCardText(notice.card, jokerName);
    return <div className={styles.notice}>
      <strong className={notice.self ? styles.self : undefined}>
        {t(notice.self ? 'napoleon.notice.secretarySelf' : 'napoleon.notice.secretaryCard', { card })}
      </strong>
      {notice.holder !== undefined && <span className={styles.detail}>
        {notice.holder ? t('napoleon.notice.holder', { name: name(notice.holder) }) : t('napoleon.notice.noHolder')}
      </span>}
    </div>;
  }
  return <div className={styles.notice}>
    <strong className={notice.self ? undefined : styles.alert}>
      {t(notice.self ? `napoleon.summoned.${notice.summon}` : `napoleon.summon.${notice.summon}`)}
    </strong>
  </div>;
}
