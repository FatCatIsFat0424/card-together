import type { ReactNode } from 'react';
import type { AvatarId, MediaId } from '@shared/types';
import type { AvatarBorderId } from '../shop-catalog';
import { Avatar } from './Avatar';
import styles from './AvatarBorder.module.css';

/** Shop-sized preview of the same avatar decoration used throughout the application. */
export function AvatarBorder({ border, avatar, image, color, size = 'tile' }: {
  readonly border: AvatarBorderId | null;
  readonly avatar?: AvatarId;
  readonly image?: MediaId | null;
  readonly color?: string;
  readonly size?: 'tile' | 'preview';
}): ReactNode {
  return <span className={`${styles.frame} ${styles[size]} ${border ? styles[border] : ''}`}>
    <Avatar avatar={avatar} image={image} color={color} border={border} size="large" />
  </span>;
}
