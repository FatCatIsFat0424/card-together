import type { ReactNode } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import { HEARTS_SEATS } from '@shared/rules/hearts';
import type { FrameProps } from '../game-ui';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import styles from './HeartsTable.module.css';
export function HeartsFrame({ frame, name }: FrameProps): ReactNode {
  const game = useGameStore((state) => state.hearts);
  const { t } = useI18nStore();
  const index = frameLogIndex(frame);
  const entry = game && index !== null ? game.log[index] : null;
  if (entry?.type !== 'hand_end') return null;
  return <div className={styles.settlement}>
    {entry.score.moon && <strong>{t('hearts.moon', { name: name(entry.score.moon) })}</strong>}
    <div className={styles.scoreCards}>{HEARTS_SEATS.map((seat) => <div key={seat}>
      <span>{name(seat)}</span><strong>+{entry.score.added[seat]}</strong><span>{entry.totals[seat]}</span>
    </div>)}</div>
  </div>;
}
