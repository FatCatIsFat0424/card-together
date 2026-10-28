import { describe, expect, it } from 'vitest';
import type { AccountProfile } from '@shared/types';
import { getShopItem } from '@shared/constants';
import { equipPatch, equipmentTarget, isEquipped, replacementFor } from '../../../client/src/shop-equipment';

const item = (id: string) => getShopItem(id)!;
const account = (fields: Partial<AccountProfile>): AccountProfile => fields as AccountProfile;

describe('shop equipment helpers', () => {
  it('maps product types to the account field that equips them', () => {
    expect(equipmentTarget('avatarBorder')).toBe('avatarBorder');
    expect(equipmentTarget('cardBack')).toBe('cardBackStyle');
    expect(equipmentTarget('stickerPack')).toBeNull();
    expect(equipPatch(item('copper'))).toEqual({ avatarBorder: 'copper' });
    expect(equipPatch(item('card-back-aurora'))).toEqual({ cardBackStyle: 'card-back-aurora' });
    expect(equipPatch(item('stickers-table-talk'))).toBeNull();
  });

  it('reports what equipping replaces', () => {
    const equipped = account({ cardBackStyle: 'card-back-tide', nameplate: 'nameplate-table-traveler' });
    expect(replacementFor(equipped, item('card-back-aurora'))).toEqual({ kind: 'item', id: 'card-back-tide' });
    expect(replacementFor(equipped, item('nameplate-aurora'))).toEqual({ kind: 'item', id: 'nameplate-table-traveler' });
    expect(replacementFor(equipped, item('card-back-tide'))).toBeNull();
    expect(isEquipped(equipped, item('card-back-tide'))).toBe(true);
    expect(isEquipped(equipped, item('card-back-aurora'))).toBe(false);
    expect(replacementFor(equipped, item('stickers-table-talk'))).toBeNull();
  });

  it('counts an uploaded image as the current look only while no product is equipped', () => {
    const upload = account({ tableBackground: 'media-1', seatBackground: null });
    expect(replacementFor(upload, item('table-aurora'))).toEqual({ kind: 'custom' });
    expect(replacementFor(upload, item('seat-aurora'))).toEqual({ kind: 'default' });
    expect(replacementFor(upload, item('card-back-aurora'))).toEqual({ kind: 'default' });
    expect(replacementFor({ ...upload, tableBackgroundStyle: 'table-tide' } as AccountProfile, item('table-aurora')))
      .toEqual({ kind: 'item', id: 'table-tide' });
    // Uploads do not apply to slots without an image fallback.
    expect(replacementFor(account({ tableBackground: 'media-1' }), item('seat-frame-aurora'))).toEqual({ kind: 'default' });
  });
});
