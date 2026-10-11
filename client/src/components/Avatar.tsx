import type { ReactNode } from 'react';
import type { AvatarBorderId, AvatarId, MediaId } from '@shared/types';
import { mediaUrl } from '../media';
import { useI18nStore } from '../stores/i18n-store';
import styles from './Avatar.module.css';
import borderStyles from './AvatarBorder.module.css';
import { AppIcon } from './AppIcon';

export const AVATARS: readonly AvatarId[] = ['cat', 'fox', 'owl', 'bear', 'rabbit', 'panda'];
const AVATAR_SYMBOLS: Record<AvatarId, string> = {
  cat: '🐱', fox: '🦊', owl: '🦉', bear: '🐻', rabbit: '🐰', panda: '🐼',
};

interface AvatarProps {
  avatar: AvatarId;
  /** Uploaded picture; replaces the preset emoji when present. */
  image?: MediaId | null;
  color?: string;
  border?: AvatarBorderId | null;
  size?: 'small' | 'medium' | 'large';
}

export function Avatar({ avatar, image, color, border, size = 'medium' }: AvatarProps): ReactNode {
  const { t } = useI18nStore();
  if (border) return <span className={`${styles.avatar} ${styles[size]} ${borderStyles.equipped} ${borderStyles[border]}`}
    data-avatar-size={size} role="img" aria-label={t(`avatar.${avatar}`)}>
    <span className={borderStyles.rim} aria-hidden="true" />
    {(border === 'cat' || border === 'rabbit') && <>
      <span className={`${borderStyles.ear} ${borderStyles.leftEar}`} aria-hidden="true" />
      <span className={`${borderStyles.ear} ${borderStyles.rightEar}`} aria-hidden="true" />
    </>}
    <span className={borderStyles.face} aria-hidden="true"><Avatar avatar={avatar} image={image} size={size} /></span>
    {border === 'starlight' && <>
      <span className={`${borderStyles.star} ${borderStyles.firstStar}`} aria-hidden="true"><AppIcon name="burst" /></span>
      <span className={`${borderStyles.star} ${borderStyles.secondStar}`} aria-hidden="true"><AppIcon name="burst" /></span>
    </>}
  </span>;
  return (
    <span className={`${styles.avatar} ${styles[size]}`} role="img" aria-label={t(`avatar.${avatar}`)}>
      {color && <svg className={styles.ring} viewBox="0 0 116 116" aria-hidden="true">
        <circle cx="58" cy="58" r="54" fill="none" stroke={color} strokeWidth="8" />
      </svg>}
      {image ? <img className={styles.image} src={mediaUrl(image)} alt="" /> : AVATAR_SYMBOLS[avatar]}
    </span>
  );
}
