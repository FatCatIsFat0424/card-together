import type { ReactNode } from 'react';
import type { ShopStickerId } from '@shared/types';
import { shopStickerUrl } from '../shop-stickers';
import { useI18nStore } from '../stores/i18n-store';
import styles from './ShopSticker.module.css';

export function ShopSticker({ id, small = false }: { id: ShopStickerId; small?: boolean }): ReactNode {
  const { t } = useI18nStore();
  return <img className={`${styles.sticker} ${small ? styles.small : ''}`}
    src={shopStickerUrl(id)} alt={t(`shop.sticker.${id}`)} draggable={false} />;
}
