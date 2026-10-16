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

/** Private card face decks; unequipped players see the bundled classic deck. */
export const CARD_FACES = [
  { id: 'card-face-four-color', type: 'cardFace', price: 100, design: 'four-color' },
  { id: 'card-face-aurora', type: 'cardFace', price: 160, design: 'aurora' },
  { id: 'card-face-tide', type: 'cardFace', price: 160, design: 'tide' },
  { id: 'card-face-sakura', type: 'cardFace', price: 160, design: 'sakura' },
  { id: 'card-face-constellation', type: 'cardFace', price: 160, design: 'constellation' },
  { id: 'card-face-bamboo', type: 'cardFace', price: 160, design: 'bamboo' },
  { id: 'card-face-gilded', type: 'cardFace', price: 160, design: 'gilded' },
  { id: 'card-face-ember', type: 'cardFace', price: 160, design: 'ember' },
  { id: 'card-face-lotus', type: 'cardFace', price: 160, design: 'lotus' },
  { id: 'card-face-frost', type: 'cardFace', price: 160, design: 'frost' },
  { id: 'card-face-dune', type: 'cardFace', price: 160, design: 'dune' },
] as const;

/** Private synthesized sound packs; unequipped players hear the classic tones. */
export const SOUND_PACKS = [
  { id: 'sound-aurora', type: 'soundPack', price: 120, design: 'aurora' },
  { id: 'sound-tide', type: 'soundPack', price: 120, design: 'tide' },
  { id: 'sound-sakura', type: 'soundPack', price: 120, design: 'sakura' },
  { id: 'sound-constellation', type: 'soundPack', price: 120, design: 'constellation' },
  { id: 'sound-bamboo', type: 'soundPack', price: 120, design: 'bamboo' },
  { id: 'sound-gilded', type: 'soundPack', price: 120, design: 'gilded' },
  { id: 'sound-ember', type: 'soundPack', price: 120, design: 'ember' },
  { id: 'sound-lotus', type: 'soundPack', price: 120, design: 'lotus' },
  { id: 'sound-frost', type: 'soundPack', price: 120, design: 'frost' },
  { id: 'sound-dune', type: 'soundPack', price: 120, design: 'dune' },
] as const;

/** Public seat frames and turn glow shown to everyone at the table. */
export const SEAT_FRAMES = [
  { id: 'seat-frame-aurora', type: 'seatFrame', price: 140, design: 'aurora' },
  { id: 'seat-frame-tide', type: 'seatFrame', price: 140, design: 'tide' },
  { id: 'seat-frame-sakura', type: 'seatFrame', price: 140, design: 'sakura' },
  { id: 'seat-frame-constellation', type: 'seatFrame', price: 140, design: 'constellation' },
  { id: 'seat-frame-bamboo', type: 'seatFrame', price: 140, design: 'bamboo' },
  { id: 'seat-frame-gilded', type: 'seatFrame', price: 140, design: 'gilded' },
  { id: 'seat-frame-ember', type: 'seatFrame', price: 140, design: 'ember' },
  { id: 'seat-frame-lotus', type: 'seatFrame', price: 140, design: 'lotus' },
  { id: 'seat-frame-frost', type: 'seatFrame', price: 140, design: 'frost' },
  { id: 'seat-frame-dune', type: 'seatFrame', price: 140, design: 'dune' },
] as const;

/** Public celebrations played over the table for a winner's seat. */
export const VICTORY_EFFECTS = [
  { id: 'victory-aurora', type: 'victoryEffect', price: 220, design: 'aurora' },
  { id: 'victory-tide', type: 'victoryEffect', price: 220, design: 'tide' },
  { id: 'victory-sakura', type: 'victoryEffect', price: 220, design: 'sakura' },
  { id: 'victory-constellation', type: 'victoryEffect', price: 220, design: 'constellation' },
  { id: 'victory-bamboo', type: 'victoryEffect', price: 220, design: 'bamboo' },
  { id: 'victory-gilded', type: 'victoryEffect', price: 220, design: 'gilded' },
  { id: 'victory-ember', type: 'victoryEffect', price: 220, design: 'ember' },
  { id: 'victory-lotus', type: 'victoryEffect', price: 220, design: 'lotus' },
  { id: 'victory-frost', type: 'victoryEffect', price: 220, design: 'frost' },
  { id: 'victory-dune', type: 'victoryEffect', price: 220, design: 'dune' },
] as const;

/** Private chip artwork for match-only chip amounts. */
export const CHIP_STYLES = [
  { id: 'chips-aurora', type: 'chipStyle', price: 80, design: 'aurora' },
  { id: 'chips-tide', type: 'chipStyle', price: 80, design: 'tide' },
  { id: 'chips-sakura', type: 'chipStyle', price: 80, design: 'sakura' },
  { id: 'chips-constellation', type: 'chipStyle', price: 80, design: 'constellation' },
  { id: 'chips-bamboo', type: 'chipStyle', price: 80, design: 'bamboo' },
  { id: 'chips-gilded', type: 'chipStyle', price: 80, design: 'gilded' },
  { id: 'chips-ember', type: 'chipStyle', price: 80, design: 'ember' },
  { id: 'chips-lotus', type: 'chipStyle', price: 80, design: 'lotus' },
  { id: 'chips-frost', type: 'chipStyle', price: 80, design: 'frost' },
  { id: 'chips-dune', type: 'chipStyle', price: 80, design: 'dune' },
] as const;

/** Public message frames around the sender's room chat and private messages. */
export const CHAT_FRAMES = [
  { id: 'chat-frame-aurora', type: 'chatFrame', price: 120, design: 'aurora' },
  { id: 'chat-frame-tide', type: 'chatFrame', price: 120, design: 'tide' },
  { id: 'chat-frame-sakura', type: 'chatFrame', price: 120, design: 'sakura' },
  { id: 'chat-frame-constellation', type: 'chatFrame', price: 120, design: 'constellation' },
  { id: 'chat-frame-bamboo', type: 'chatFrame', price: 120, design: 'bamboo' },
  { id: 'chat-frame-gilded', type: 'chatFrame', price: 120, design: 'gilded' },
  { id: 'chat-frame-ember', type: 'chatFrame', price: 120, design: 'ember' },
  { id: 'chat-frame-lotus', type: 'chatFrame', price: 120, design: 'lotus' },
  { id: 'chat-frame-frost', type: 'chatFrame', price: 120, design: 'frost' },
  { id: 'chat-frame-dune', type: 'chatFrame', price: 120, design: 'dune' },
] as const;

/** Server-authoritative prices for every permanent shop product, including legacy borders. */
export const SHOP_ITEMS = [
  ...AVATAR_BORDERS.map((item) => ({ ...item, type: 'avatarBorder' as const })),
  ...CARD_BACKS, ...TABLE_BACKGROUNDS, ...SEAT_BACKGROUNDS, ...NAMEPLATES, ...STICKER_PACKS,
  ...CARD_FACES, ...SOUND_PACKS, ...SEAT_FRAMES, ...VICTORY_EFFECTS, ...CHIP_STYLES, ...CHAT_FRAMES,
] as const;

export type ShopItem = typeof SHOP_ITEMS[number];
export type ShopItemId = ShopItem['id'];
export type ShopItemType = ShopItem['type'];
export type CardBackStyleId = typeof CARD_BACKS[number]['id'];
export type TableBackgroundStyleId = typeof TABLE_BACKGROUNDS[number]['id'];
export type SeatBackgroundStyleId = typeof SEAT_BACKGROUNDS[number]['id'];
export type CardFaceStyleId = typeof CARD_FACES[number]['id'];
export type SoundPackId = typeof SOUND_PACKS[number]['id'];
export type SeatFrameId = typeof SEAT_FRAMES[number]['id'];
export type VictoryEffectId = typeof VICTORY_EFFECTS[number]['id'];
export type ChipStyleId = typeof CHIP_STYLES[number]['id'];
export type ChatFrameId = typeof CHAT_FRAMES[number]['id'];
/** Account field that equips each product type; sticker packs and avatar borders are not listed. */
export const EQUIPMENT_SLOTS = {
  cardBackStyle: 'cardBack',
  tableBackgroundStyle: 'tableBackground',
  seatBackgroundStyle: 'seatBackground',
  nameplate: 'nameplate',
  cardFaceStyle: 'cardFace',
  soundPack: 'soundPack',
  seatFrame: 'seatFrame',
  victoryEffect: 'victoryEffect',
  chipStyle: 'chipStyle',
  chatFrame: 'chatFrame',
} as const;

export type EquipmentSlot = keyof typeof EQUIPMENT_SLOTS;
export type EquippableShopItemType = typeof EQUIPMENT_SLOTS[EquipmentSlot];

/** The account field that equips `type`, or null for products that need no equipment. */
export function equipmentSlotFor(type: ShopItemType): EquipmentSlot | null {
  return (Object.keys(EQUIPMENT_SLOTS) as EquipmentSlot[]).find((slot) => EQUIPMENT_SLOTS[slot] === type) ?? null;
}
/** Earned titles are deliberately absent from SHOP_ITEMS and all purchase endpoints. */
export const ACHIEVEMENT_NAMEPLATES = [
  { id: 'nameplate-table-traveler' },
  { id: 'nameplate-daily-collector' },
] as const;
export type AchievementNameplateId = typeof ACHIEVEMENT_NAMEPLATES[number]['id'];
export type NameplateId = typeof NAMEPLATES[number]['id'] | AchievementNameplateId;

export function isAchievementNameplateId(value: unknown): value is AchievementNameplateId {
  return ACHIEVEMENT_NAMEPLATES.some((item) => item.id === value);
}
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
