import type { ShopItemId } from '@shared/types';
import cardBackAurora from './assets/shop/card-back-aurora.svg';
import cardBackTide from './assets/shop/card-back-tide.svg';
import cardBackSakura from './assets/shop/card-back-sakura.svg';
import tableAurora from './assets/shop/table-aurora.svg';
import tableTide from './assets/shop/table-tide.svg';
import tableSakura from './assets/shop/table-sakura.svg';
import seatAurora from './assets/shop/seat-aurora.svg';
import seatTide from './assets/shop/seat-tide.svg';
import seatSakura from './assets/shop/seat-sakura.svg';

const ARTWORK: Partial<Record<ShopItemId, string>> = {
  'card-back-aurora': cardBackAurora,
  'card-back-tide': cardBackTide,
  'card-back-sakura': cardBackSakura,
  'table-aurora': tableAurora,
  'table-tide': tableTide,
  'table-sakura': tableSakura,
  'seat-aurora': seatAurora,
  'seat-tide': seatTide,
  'seat-sakura': seatSakura,
};

/** Bundled original artwork follows Vite's asset base for subpath deployments. */
export function shopArtworkUrl(id: ShopItemId): string | undefined {
  return ARTWORK[id];
}
