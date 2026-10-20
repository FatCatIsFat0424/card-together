import type { ShopSeries } from '@shared/types';
import { artByName } from './art-layers';
import type { LayeredArtwork } from './art-layers';

const LAYERS = artByName(import.meta.glob<LayeredArtwork | null>(
  '../../assets/shop/series-*-emblem.svg',
  { query: '?layers', import: 'default', eager: true },
));

/** Layered emblem for an animated collection; null when the emblem is static. */
export function layeredSeriesEmblem(series: ShopSeries): LayeredArtwork | null {
  return LAYERS.get(`series-${series}-emblem`) ?? null;
}
