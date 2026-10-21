import type { ShopItemId } from '@shared/types';
import { artByName } from './art-layers';
import type { LayeredArtwork } from './art-layers';

// Kept apart from the emblems so only game, room and shop pages bundle card back and table layers.
const LAYERS = artByName(import.meta.glob<LayeredArtwork | null>(
  ['../../assets/shop/card-back-*.svg', '../../assets/shop/table-*.svg'],
  { query: '?layers', import: 'default', eager: true },
));

/** Layered card back or table artwork; null for static items, which keep their CSS background. */
export function layeredShopArt(id: ShopItemId | null | undefined): LayeredArtwork | null {
  return id ? LAYERS.get(id) ?? null : null;
}
