import type { ShopItemId } from '@shared/types';
import { artByName } from './art-layers';
import type { LayeredArtwork } from './art-layers';

// Only the shop needs these layers; keep them out of the shared game artwork module.
const LAYERS = artByName(import.meta.glob<LayeredArtwork | null>(
  ['../../assets/shop/seat-*.svg',
    // This scene rotates inside a non-uniform scale; preserve its original SVG.
    '!../../assets/shop/seat-ironfront.svg'],
  { query: '?layers', import: 'default', eager: true },
));

export function layeredSeatPreview(id: ShopItemId): LayeredArtwork | null {
  return LAYERS.get(id) ?? null;
}
