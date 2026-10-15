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
const ANTLER_PATH = 'M18 16 C12 5 10 -10 12 -32 M12 -13 L2 -22 L0 -34 M12 -22 L22 -32 L23 -42 M10 -2 L-1 -9 L-4 -21';
const TENTACLE_PATH = 'M0 61 C-18 70 -17 93 -4 98 C8 103 6 88 -2 89 M8 85 C-6 106 9 123 22 113 C29 108 21 99 17 107 M30 102 C25 122 43 130 46 116';

interface AvatarProps {
  avatar: AvatarId;
  /** Uploaded picture; replaces the preset emoji when present. */
  image?: MediaId | null;
  color?: string;
  border?: AvatarBorderId | null;
  size?: 'small' | 'compact' | 'medium' | 'large';
}

export function Avatar({ avatar, image, color, border, size = 'medium' }: AvatarProps): ReactNode {
  const { t } = useI18nStore();
  if (border) return <span className={`${styles.avatar} ${styles[size]} ${borderStyles.equipped} ${borderStyles[border]}`}
    data-avatar-size={size} role="img" aria-label={t(`avatar.${avatar}`)}>
    <span className={borderStyles.rim} aria-hidden="true" />
    {['cat', 'rabbit', 'frog', 'bear', 'dog'].includes(border) && <>
      <span className={`${borderStyles.ear} ${borderStyles.leftEar}`} aria-hidden="true" />
      <span className={`${borderStyles.ear} ${borderStyles.rightEar}`} aria-hidden="true" />
    </>}
    {border === 'antlers' && <svg className={borderStyles.antlerArt} viewBox="0 0 100 100" aria-hidden="true">
      <path d={ANTLER_PATH} />
      <path d={ANTLER_PATH} transform="translate(100 0) scale(-1 1)" />
    </svg>}
    {border === 'cthulhu' && <svg className={borderStyles.tentacleArt} viewBox="0 0 100 100" aria-hidden="true">
      <path d={TENTACLE_PATH} />
      <path d={TENTACLE_PATH} transform="translate(100 0) scale(-1 1)" />
    </svg>}
    {border === 'sakura' && <svg className={borderStyles.flowerArt} viewBox="0 0 100 100" aria-hidden="true">
      <g transform="translate(83 10)">
        {[0, 72, 144, 216, 288].map((angle) =>
          <ellipse key={angle} cx="0" cy="-6" rx="4" ry="7" transform={`rotate(${angle})`} />)}
        <circle r="3" />
      </g>
    </svg>}
    {border === 'tide' && <svg className={borderStyles.waveArt} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M3 70 Q15 58 28 70 T53 70 M50 97 Q64 82 78 93 T105 89" />
    </svg>}
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
