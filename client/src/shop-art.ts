import type { CardBackStyleId, SeatBackgroundStyleId, ShopItemId, TableBackgroundStyleId } from '@shared/types';
import cardBackAurora from './assets/shop/card-back-aurora.svg';
import cardBackTide from './assets/shop/card-back-tide.svg';
import cardBackSakura from './assets/shop/card-back-sakura.svg';
import tableAurora from './assets/shop/table-aurora.svg';
import tableTide from './assets/shop/table-tide.svg';
import tableSakura from './assets/shop/table-sakura.svg';
import seatAurora from './assets/shop/seat-aurora.svg';
import seatTide from './assets/shop/seat-tide.svg';
import seatSakura from './assets/shop/seat-sakura.svg';
import cardBackConstellation from './assets/shop/card-back-constellation.svg';
import tableConstellation from './assets/shop/table-constellation.svg';
import seatConstellation from './assets/shop/seat-constellation.svg';
import cardBackBamboo from './assets/shop/card-back-bamboo.svg';
import tableBamboo from './assets/shop/table-bamboo.svg';
import seatBamboo from './assets/shop/seat-bamboo.svg';
import cardBackGilded from './assets/shop/card-back-gilded.svg';
import tableGilded from './assets/shop/table-gilded.svg';
import seatGilded from './assets/shop/seat-gilded.svg';
import cardBackEmber from './assets/shop/card-back-ember.svg';
import tableEmber from './assets/shop/table-ember.svg';
import seatEmber from './assets/shop/seat-ember.svg';
import cardBackLotus from './assets/shop/card-back-lotus.svg';
import tableLotus from './assets/shop/table-lotus.svg';
import seatLotus from './assets/shop/seat-lotus.svg';
import cardBackFrost from './assets/shop/card-back-frost.svg';
import tableFrost from './assets/shop/table-frost.svg';
import seatFrost from './assets/shop/seat-frost.svg';
import cardBackDune from './assets/shop/card-back-dune.svg';
import tableDune from './assets/shop/table-dune.svg';
import seatDune from './assets/shop/seat-dune.svg';

import cardBackStarfleet from './assets/shop/card-back-starfleet.svg';
import tableStarfleet from './assets/shop/table-starfleet.svg';
import seatStarfleet from './assets/shop/seat-starfleet.svg';
import cardBackShrine from './assets/shop/card-back-shrine.svg';
import tableShrine from './assets/shop/table-shrine.svg';
import seatShrine from './assets/shop/seat-shrine.svg';
import cardBackIronfront from './assets/shop/card-back-ironfront.svg';
import tableIronfront from './assets/shop/table-ironfront.svg';
import seatIronfront from './assets/shop/seat-ironfront.svg';
import cardBackNeoncity from './assets/shop/card-back-neoncity.svg';
import tableNeoncity from './assets/shop/table-neoncity.svg';
import seatNeoncity from './assets/shop/seat-neoncity.svg';
import cardBackCrownrealm from './assets/shop/card-back-crownrealm.svg';
import tableCrownrealm from './assets/shop/table-crownrealm.svg';
import seatCrownrealm from './assets/shop/seat-crownrealm.svg';

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
  'card-back-constellation': cardBackConstellation,
  'table-constellation': tableConstellation,
  'seat-constellation': seatConstellation,
  'card-back-bamboo': cardBackBamboo,
  'table-bamboo': tableBamboo,
  'seat-bamboo': seatBamboo,
  'card-back-gilded': cardBackGilded,
  'table-gilded': tableGilded,
  'seat-gilded': seatGilded,
  'card-back-ember': cardBackEmber,
  'table-ember': tableEmber,
  'seat-ember': seatEmber,
  'card-back-lotus': cardBackLotus,
  'table-lotus': tableLotus,
  'seat-lotus': seatLotus,
  'card-back-frost': cardBackFrost,
  'table-frost': tableFrost,
  'seat-frost': seatFrost,
  'card-back-dune': cardBackDune,
  'table-dune': tableDune,
  'seat-dune': seatDune,
  'card-back-starfleet': cardBackStarfleet,
  'table-starfleet': tableStarfleet,
  'seat-starfleet': seatStarfleet,
  'card-back-shrine': cardBackShrine,
  'table-shrine': tableShrine,
  'seat-shrine': seatShrine,
  'card-back-ironfront': cardBackIronfront,
  'table-ironfront': tableIronfront,
  'seat-ironfront': seatIronfront,
  'card-back-neoncity': cardBackNeoncity,
  'table-neoncity': tableNeoncity,
  'seat-neoncity': seatNeoncity,
  'card-back-crownrealm': cardBackCrownrealm,
  'table-crownrealm': tableCrownrealm,
  'seat-crownrealm': seatCrownrealm,
} satisfies Record<CardBackStyleId | TableBackgroundStyleId | SeatBackgroundStyleId, string>;

/** Bundled original artwork follows Vite's asset base for subpath deployments. */
export function shopArtworkUrl(id: ShopItemId, reducedMotion = false): string | undefined {
  const url = ARTWORK[id];
  return url && reducedMotion ? `${url}#still` : url;
}
