import type { ReactNode } from 'react';
import type { AvatarId, MediaId } from '@shared/types';
import type { AvatarBorderId } from '../shop-catalog';
import { Avatar } from './Avatar';
import { AppIcon } from './AppIcon';
import styles from './AvatarBorder.module.css';

/** Decorative shop preview; the account avatar remains the source of its accessible label. */
export function AvatarBorder({ border, avatar, image, color, size = 'tile' }: {
  readonly border: AvatarBorderId | null;
  readonly avatar: AvatarId;
  readonly image?: MediaId | null;
  readonly color?: string;
  readonly size?: 'tile' | 'preview';
}): ReactNode {
  return <span className={`${styles.frame} ${styles[size]} ${border ? styles[border] : ''}`}>
    {border && <span className={styles.rim} aria-hidden="true" />}
    {(border === 'cat' || border === 'rabbit') && <>
      <span className={`${styles.ear} ${styles.leftEar}`} aria-hidden="true" />
      <span className={`${styles.ear} ${styles.rightEar}`} aria-hidden="true" />
    </>}
    <span className={styles.face}><Avatar avatar={avatar} image={image} color={border ? undefined : color} size="large" /></span>
    {border === 'starlight' && <>
      <span className={`${styles.star} ${styles.firstStar}`} aria-hidden="true"><AppIcon name="burst" /></span>
      <span className={`${styles.star} ${styles.secondStar}`} aria-hidden="true"><AppIcon name="burst" /></span>
    </>}
  </span>;
}
