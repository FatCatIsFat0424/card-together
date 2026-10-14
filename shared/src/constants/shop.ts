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
  { id: 'card-back-constellation', type: 'cardBack', price: 120, design: 'constellation' },
  { id: 'card-back-bamboo', type: 'cardBack', price: 120, design: 'bamboo' },
  { id: 'card-back-gilded', type: 'cardBack', price: 120, design: 'gilded' },
  { id: 'card-back-ember', type: 'cardBack', price: 120, design: 'ember' },
  { id: 'card-back-lotus', type: 'cardBack', price: 120, design: 'lotus' },
  { id: 'card-back-frost', type: 'cardBack', price: 120, design: 'frost' },
  { id: 'card-back-dune', type: 'cardBack', price: 120, design: 'dune' },
] as const;

export const TABLE_BACKGROUNDS = [
  { id: 'table-aurora', type: 'tableBackground', price: 160, design: 'aurora' },
  { id: 'table-tide', type: 'tableBackground', price: 160, design: 'tide' },
  { id: 'table-sakura', type: 'tableBackground', price: 160, design: 'sakura' },
  { id: 'table-constellation', type: 'tableBackground', price: 160, design: 'constellation' },
  { id: 'table-bamboo', type: 'tableBackground', price: 160, design: 'bamboo' },
  { id: 'table-gilded', type: 'tableBackground', price: 160, design: 'gilded' },
  { id: 'table-ember', type: 'tableBackground', price: 160, design: 'ember' },
  { id: 'table-lotus', type: 'tableBackground', price: 160, design: 'lotus' },
  { id: 'table-frost', type: 'tableBackground', price: 160, design: 'frost' },
  { id: 'table-dune', type: 'tableBackground', price: 160, design: 'dune' },
] as const;

export const SEAT_BACKGROUNDS = [
  { id: 'seat-aurora', type: 'seatBackground', price: 100, design: 'aurora' },
  { id: 'seat-tide', type: 'seatBackground', price: 100, design: 'tide' },
  { id: 'seat-sakura', type: 'seatBackground', price: 100, design: 'sakura' },
  { id: 'seat-constellation', type: 'seatBackground', price: 100, design: 'constellation' },
  { id: 'seat-bamboo', type: 'seatBackground', price: 100, design: 'bamboo' },
  { id: 'seat-gilded', type: 'seatBackground', price: 100, design: 'gilded' },
  { id: 'seat-ember', type: 'seatBackground', price: 100, design: 'ember' },
  { id: 'seat-lotus', type: 'seatBackground', price: 100, design: 'lotus' },
  { id: 'seat-frost', type: 'seatBackground', price: 100, design: 'frost' },
  { id: 'seat-dune', type: 'seatBackground', price: 100, design: 'dune' },
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
  { id: 'nameplate-lucky', type: 'nameplate', price: 160, design: 'lucky' },
] as const;

export const STICKER_PACKS = [
  { id: 'stickers-table-talk', type: 'stickerPack', price: 100 },
  { id: 'stickers-forest-friends', type: 'stickerPack', price: 120 },
  { id: 'stickers-space', type: 'stickerPack', price: 120 },
  { id: 'stickers-cats', type: 'stickerPack', price: 120 },
  { id: 'stickers-ocean', type: 'stickerPack', price: 120 },
  { id: 'stickers-snacks', type: 'stickerPack', price: 120 },
  { id: 'stickers-weather', type: 'stickerPack', price: 120 },
  { id: 'stickers-garden', type: 'stickerPack', price: 120 },
  { id: 'stickers-arcade', type: 'stickerPack', price: 120 },
  { id: 'stickers-dragons', type: 'stickerPack', price: 120 },
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
  { id: 'space-launch', packId: 'stickers-space' },
  { id: 'space-think', packId: 'stickers-space' },
  { id: 'space-star', packId: 'stickers-space' },
  { id: 'space-sleep', packId: 'stickers-space' },
  { id: 'cats-hello', packId: 'stickers-cats' },
  { id: 'cats-focus', packId: 'stickers-cats' },
  { id: 'cats-love', packId: 'stickers-cats' },
  { id: 'cats-nap', packId: 'stickers-cats' },
  { id: 'ocean-wave', packId: 'stickers-ocean' },
  { id: 'ocean-think', packId: 'stickers-ocean' },
  { id: 'ocean-cheer', packId: 'stickers-ocean' },
  { id: 'ocean-rest', packId: 'stickers-ocean' },
  { id: 'snacks-hello', packId: 'stickers-snacks' },
  { id: 'snacks-wait', packId: 'stickers-snacks' },
  { id: 'snacks-yay', packId: 'stickers-snacks' },
  { id: 'snacks-full', packId: 'stickers-snacks' },
  { id: 'weather-sunny', packId: 'stickers-weather' },
  { id: 'weather-cloudy', packId: 'stickers-weather' },
  { id: 'weather-rainbow', packId: 'stickers-weather' },
  { id: 'weather-night', packId: 'stickers-weather' },
  { id: 'garden-hello', packId: 'stickers-garden' },
  { id: 'garden-grow', packId: 'stickers-garden' },
  { id: 'garden-bloom', packId: 'stickers-garden' },
  { id: 'garden-rest', packId: 'stickers-garden' },
  { id: 'arcade-ready', packId: 'stickers-arcade' },
  { id: 'arcade-think', packId: 'stickers-arcade' },
  { id: 'arcade-win', packId: 'stickers-arcade' },
  { id: 'arcade-pause', packId: 'stickers-arcade' },
  { id: 'dragons-hello', packId: 'stickers-dragons' },
  { id: 'dragons-ponder', packId: 'stickers-dragons' },
  { id: 'dragons-fire', packId: 'stickers-dragons' },
  { id: 'dragons-sleep', packId: 'stickers-dragons' },
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
