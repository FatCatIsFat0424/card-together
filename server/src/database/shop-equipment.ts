import type { AccountProfile } from '@shared/types';
import { EQUIPMENT_SLOTS, getShopItem } from '@shared/constants';
import { isAchievementNameplateId } from '@shared/constants/shop';
import type { EquipmentSlot } from '@shared/constants/shop';

export { EQUIPMENT_SLOTS };
export type { EquipmentSlot };

type EquipmentInput = { readonly [Slot in EquipmentSlot]?: unknown };

export function isEquipmentStyle<Slot extends EquipmentSlot>(
  slot: Slot, value: unknown,
): value is NonNullable<AccountProfile[Slot]> {
  return (slot === 'nameplate' && isAchievementNameplateId(value)) || getShopItem(value)?.type === EQUIPMENT_SLOTS[slot];
}

/** Validate both the slot and ownership inside the same transaction as profile writes. */
export function equipmentError(
  profile: EquipmentInput, account: Pick<AccountProfile, 'ownedShopItems' | 'ownedAchievementNameplates'>,
): 'INVALID_SHOP_ITEM' | 'SHOP_ITEM_NOT_OWNED' | null {
  for (const slot of Object.keys(EQUIPMENT_SLOTS) as EquipmentSlot[]) {
    const value = profile[slot];
    if (value === undefined || value === null) continue;
    if (!isEquipmentStyle(slot, value)) return 'INVALID_SHOP_ITEM';
    if (slot === 'nameplate' && isAchievementNameplateId(value)) {
      if (!account.ownedAchievementNameplates?.includes(value)) return 'SHOP_ITEM_NOT_OWNED';
      continue;
    }
    if (!account.ownedShopItems?.some((id) => id === value)) return 'SHOP_ITEM_NOT_OWNED';
  }
  return null;
}
