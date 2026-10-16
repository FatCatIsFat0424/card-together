import type { ReactNode } from 'react';
import type { SeatFrameId } from '@shared/types';
import { Avatar } from '../../components/Avatar';
import { useMotionStore } from '../../stores/motion-store';
import type { PreviewAccount } from '../preview-props';
import { SeatFrame, seatFrameHostClass } from './SeatFrame';
import styles from './SeatFramePreview.module.css';

/**
 * The shopper's own plate on turn, so the frame and its glow are judged around their avatar and name.
 * Null shows the theme's plain turn plate.
 */
export function SeatFramePreview({ id, account }: {
  readonly id: SeatFrameId | null; readonly account: PreviewAccount;
}): ReactNode {
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  return <div className={`${styles.preview} ${seatFrameHostClass(id)}`} data-reduced-motion={reducedMotion || undefined}>
    <div className={styles.plate}>
      <SeatFrame frame={id} turn />
      <Avatar avatar={account.avatar} image={account.avatarImage} border={account.avatarBorder} color={account.color} size="compact" />
      <span className={styles.name}>{account.nickname}</span>
      <span className={styles.timeBar} aria-hidden="true"><span /></span>
    </div>
  </div>;
}
