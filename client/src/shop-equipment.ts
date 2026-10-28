import type { AccountProfile, ShopItem, ShopItemId, ShopItemType } from '@shared/types';
import { equipmentSlotFor } from '@shared/constants';
import type { EquipmentSlot } from '@shared/constants/shop';

/** Account field that holds the equipped product of a type; avatar borders have their own field. */
export type EquipmentTarget = 'avatarBorder' | EquipmentSlot;

/** Image slots fall back to an uploaded image when no shop product is equipped. */
export const UPLOAD_FIELDS = {
  cardBackStyle: 'cardBack',
  tableBackgroundStyle: 'tableBackground',
  seatBackgroundStyle: 'seatBackground',
} as const;
export type UploadSlot = keyof typeof UPLOAD_FIELDS;

export function isUploadSlot(target: EquipmentTarget): target is UploadSlot {
  return target in UPLOAD_FIELDS;
}

export function equipmentTarget(type: ShopItemType): EquipmentTarget | null {
  return type === 'avatarBorder' ? 'avatarBorder' : equipmentSlotFor(type);
}

export function equippedId(account: AccountProfile, target: EquipmentTarget): string | null {
  return account[target] ?? null;
}

export function isEquipped(account: AccountProfile, item: ShopItem): boolean {
  const target = equipmentTarget(item.type);
  return target !== null && equippedId(account, target) === item.id;
}

/** Profile fields that equip the product, or null for sticker packs. */
export function equipPatch(item: ShopItem): Partial<Record<EquipmentTarget, ShopItemId>> | null {
  const target = equipmentTarget(item.type);
  return target ? { [target]: item.id } : null;
}

/** What the wearer sees today in the slot a product would fill. */
export type Replacement =
  | { readonly kind: 'item'; readonly id: string }
  | { readonly kind: 'custom' }
  | { readonly kind: 'default' };

/**
 * The current look that equipping `item` replaces; null for sticker packs and for the product already
 * equipped. An uploaded image only shows while the slot has no product, so it counts as the current look then.
 */
export function replacementFor(account: AccountProfile, item: ShopItem): Replacement | null {
  const target = equipmentTarget(item.type);
  if (target === null) return null;
  const current = equippedId(account, target);
  if (current === item.id) return null;
  if (current) return { kind: 'item', id: current };
  return isUploadSlot(target) && account[UPLOAD_FIELDS[target]] ? { kind: 'custom' } : { kind: 'default' };
}
