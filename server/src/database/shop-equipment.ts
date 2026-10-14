import type { AccountProfile } from '@shared/types';
import { getShopItem } from '@shared/constants';

export const EQUIPMENT_SLOTS = {
  cardBackStyle: 'cardBack',
  tableBackgroundStyle: 'tableBackground',
  seatBackgroundStyle: 'seatBackground',
  nameplate: 'nameplate',
} as const;

export type EquipmentSlot = keyof typeof EQUIPMENT_SLOTS;

type EquipmentInput = { readonly [Slot in EquipmentSlot]?: unknown };

export function isEquipmentStyle<Slot extends EquipmentSlot>(
  slot: Slot, value: unknown,
): value is NonNullable<AccountProfile[Slot]> {
  return getShopItem(value)?.type === EQUIPMENT_SLOTS[slot];
}

/** Validate both the slot and ownership inside the same transaction as profile writes. */
export function equipmentError(
  profile: EquipmentInput, account: Pick<AccountProfile, 'ownedShopItems'>,
): 'INVALID_SHOP_ITEM' | 'SHOP_ITEM_NOT_OWNED' | null {
  for (const slot of Object.keys(EQUIPMENT_SLOTS) as EquipmentSlot[]) {
    const value = profile[slot];
    if (value === undefined || value === null) continue;
    if (!isEquipmentStyle(slot, value)) return 'INVALID_SHOP_ITEM';
    if (!account.ownedShopItems?.includes(value)) return 'SHOP_ITEM_NOT_OWNED';
  }
  return null;
}
