/** Server-authoritative prices for permanent avatar borders. */
export const AVATAR_BORDERS = [
  { id: 'cat', price: 150, category: 'ears' },
  { id: 'rabbit', price: 150, category: 'ears' },
  { id: 'frog', price: 160, category: 'ears' },
  { id: 'bear', price: 150, category: 'ears' },
  { id: 'dog', price: 150, category: 'ears' },
  { id: 'antlers', price: 220, category: 'ears' },
  { id: 'cthulhu', price: 280, category: 'special' },
  { id: 'copper', price: 50, category: 'metal' },
  { id: 'silver', price: 100, category: 'metal' },
  { id: 'gold', price: 300, category: 'metal' },
  { id: 'starlight', price: 200, category: 'special' },
  { id: 'rainbow', price: 250, category: 'special' },
  { id: 'neon', price: 180, category: 'special' },
  { id: 'sakura', price: 180, category: 'special' },
  { id: 'tide', price: 180, category: 'special' },
  { id: 'eclipse', price: 240, category: 'special' },
] as const;

export type AvatarBorderId = typeof AVATAR_BORDERS[number]['id'];

export function isAvatarBorderId(value: unknown): value is AvatarBorderId {
  return AVATAR_BORDERS.some((item) => item.id === value);
}

export const CARD_BACKS = [
  { id: 'card-back-aurora', type: 'cardBack', price: 120, design: 'aurora' },
  { id: 'card-back-tide', type: 'cardBack', price: 120, design: 'tide' },
  { id: 'card-back-sakura', type: 'cardBack', price: 120, design: 'sakura' },
] as const;

export const TABLE_BACKGROUNDS = [
  { id: 'table-aurora', type: 'tableBackground', price: 160, design: 'aurora' },
  { id: 'table-tide', type: 'tableBackground', price: 160, design: 'tide' },
  { id: 'table-sakura', type: 'tableBackground', price: 160, design: 'sakura' },
] as const;

export const SEAT_BACKGROUNDS = [
  { id: 'seat-aurora', type: 'seatBackground', price: 100, design: 'aurora' },
  { id: 'seat-tide', type: 'seatBackground', price: 100, design: 'tide' },
  { id: 'seat-sakura', type: 'seatBackground', price: 100, design: 'sakura' },
] as const;

/** Fixed cosmetic titles, distinct from earned achievements. */
export const NAMEPLATES = [
  { id: 'nameplate-aurora', type: 'nameplate', price: 140, design: 'aurora' },
  { id: 'nameplate-tide', type: 'nameplate', price: 140, design: 'tide' },
  { id: 'nameplate-sakura', type: 'nameplate', price: 140, design: 'sakura' },
  { id: 'nameplate-muckborn', type: 'nameplate', price: 140, design: 'muckborn' },
  { id: 'nameplate-bark-lord', type: 'nameplate', price: 160, design: 'bark-lord' },
  { id: 'nameplate-renewal', type: 'nameplate', price: 180, design: 'renewal' },
  { id: 'nameplate-rainbow-pony', type: 'nameplate', price: 200, design: 'rainbow-pony' },
  { id: 'nameplate-planetary-devastation', type: 'nameplate', price: 240, design: 'planetary-devastation' },
  { id: 'nameplate-einstein', type: 'nameplate', price: 200, design: 'einstein' },
] as const;

export const STICKER_PACKS = [
  { id: 'stickers-table-talk', type: 'stickerPack', price: 100 },
  { id: 'stickers-forest-friends', type: 'stickerPack', price: 120 },
] as const;

/** Stable identifiers are the only sticker references accepted from clients or stored in messages. */
export const SHOP_STICKERS = [
  { id: 'table-hello', packId: 'stickers-table-talk' },
  { id: 'table-nice', packId: 'stickers-table-talk' },
  { id: 'table-thanks', packId: 'stickers-table-talk' },
  { id: 'table-next', packId: 'stickers-table-talk' },
  { id: 'forest-cheer', packId: 'stickers-forest-friends' },
  { id: 'forest-think', packId: 'stickers-forest-friends' },
  { id: 'forest-wow', packId: 'stickers-forest-friends' },
  { id: 'forest-rest', packId: 'stickers-forest-friends' },
] as const;

/** Server-authoritative prices for every permanent shop product, including legacy borders. */
export const SHOP_ITEMS = [
  ...AVATAR_BORDERS.map((item) => ({ ...item, type: 'avatarBorder' as const })),
  ...CARD_BACKS, ...TABLE_BACKGROUNDS, ...SEAT_BACKGROUNDS, ...NAMEPLATES, ...STICKER_PACKS,
] as const;

export type ShopItem = typeof SHOP_ITEMS[number];
export type ShopItemId = ShopItem['id'];
export type ShopItemType = ShopItem['type'];
export type CardBackStyleId = typeof CARD_BACKS[number]['id'];
export type TableBackgroundStyleId = typeof TABLE_BACKGROUNDS[number]['id'];
export type SeatBackgroundStyleId = typeof SEAT_BACKGROUNDS[number]['id'];
export type NameplateId = typeof NAMEPLATES[number]['id'];
export type ShopStickerId = typeof SHOP_STICKERS[number]['id'];

export function getShopItem(value: unknown): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === value);
}

export function isShopItemId(value: unknown): value is ShopItemId {
  return getShopItem(value) !== undefined;
}

export function isShopStickerId(value: unknown): value is ShopStickerId {
  return SHOP_STICKERS.some((sticker) => sticker.id === value);
}

export function ownsShopItem(account: {
  readonly ownedAvatarBorders?: readonly AvatarBorderId[];
  readonly ownedShopItems?: readonly ShopItemId[];
}, item: ShopItem): boolean {
  return item.type === 'avatarBorder'
    ? account.ownedAvatarBorders?.includes(item.id) ?? false
    : account.ownedShopItems?.includes(item.id) ?? false;
}
