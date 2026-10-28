import type { ReactNode } from 'react';
import type { AccountProfile, NameplateId } from '@shared/types';
import { getShopItem } from '@shared/constants';
import type { TranslationKey } from '../i18n';
import { mediaUrl } from '../media';
import { UPLOAD_FIELDS, isUploadSlot } from '../shop-equipment';
import type { EquipmentTarget, Replacement } from '../shop-equipment';
import { useI18nStore } from '../stores/i18n-store';
import { FitArt, SHOP_THUMB_CLASS, ShopThumb } from './ShopProductArt';
import { Avatar } from './Avatar';
import { Nameplate } from './Nameplate';
import styles from './EquipmentThumb.module.css';

/** Name of what a slot currently shows: a product, the uploaded image, or the built-in look. */
export function equipmentValueName(
  t: (key: TranslationKey, params?: Record<string, string>) => string,
  target: EquipmentTarget,
  value: Replacement,
): string {
  if (value.kind === 'custom') return t('equipment.customImage');
  if (value.kind === 'default') {
    return t(target === 'nameplate' ? 'shop.dialog.noTitle' : target === 'avatarBorder' ? 'shop.original' : 'shop.useDefault');
  }
  return getShopItem(value.id) ? t(`shop.item.${value.id}.name` as TranslationKey) : t(`shop.title.${value.id}` as TranslationKey);
}

/** A thumbnail of what fills an equipment slot; size it with `--thumb-w` and `--thumb-h` on a parent or `className`. */
export function EquipmentThumb({ target, value, account, className }: {
  readonly target: EquipmentTarget;
  readonly value: Replacement;
  readonly account: AccountProfile;
  readonly className?: string;
}): ReactNode {
  const { t } = useI18nStore();
  const box = [SHOP_THUMB_CLASS, className].filter(Boolean).join(' ');
  if (value.kind === 'custom') {
    const media = isUploadSlot(target) ? account[UPLOAD_FIELDS[target]] : null;
    return <span className={box}>{media && <img className={styles.image} src={mediaUrl(media)} alt="" loading="lazy" />}</span>;
  }
  if (value.kind === 'default' && target === 'avatarBorder') {
    return <span className={box}><FitArt fill={false}>
      <Avatar avatar={account.avatar} image={account.avatarImage} border={null} color={account.color} size="row" />
    </FitArt></span>;
  }
  if (value.kind === 'default') return <span className={`${box} ${styles.empty}`}>{t('shop.useDefault')}</span>;
  const item = getShopItem(value.id);
  if (item) return <ShopThumb item={item} account={account} className={className} />;
  // Earned titles are not products; they still show as a fitted plate.
  return <span className={box}>
    <FitArt fill={false}><Nameplate id={value.id as NameplateId} /></FitArt>
  </span>;
}
