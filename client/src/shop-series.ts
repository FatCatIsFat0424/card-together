import type { ShopSeries } from '@shared/types';
import auroraArtwork from './assets/shop/card-back-aurora.svg';
import tideArtwork from './assets/shop/card-back-tide.svg';
import sakuraArtwork from './assets/shop/card-back-sakura.svg';
import constellationArtwork from './assets/shop/card-back-constellation.svg';
import bambooArtwork from './assets/shop/card-back-bamboo.svg';
import gildedArtwork from './assets/shop/card-back-gilded.svg';
import emberArtwork from './assets/shop/card-back-ember.svg';
import lotusArtwork from './assets/shop/card-back-lotus.svg';
import frostArtwork from './assets/shop/card-back-frost.svg';
import duneArtwork from './assets/shop/card-back-dune.svg';
import starfleetEmblem from './assets/shop/series-starfleet-emblem.svg';
import shrineEmblem from './assets/shop/series-shrine-emblem.svg';
import ironfrontEmblem from './assets/shop/series-ironfront-emblem.svg';
import neoncityEmblem from './assets/shop/series-neoncity-emblem.svg';
import crownrealmEmblem from './assets/shop/series-crownrealm-emblem.svg';

const EMBLEMS = {
  starfleet: starfleetEmblem,
  shrine: shrineEmblem,
  ironfront: ironfrontEmblem,
  neoncity: neoncityEmblem,
  crownrealm: crownrealmEmblem,
};

const ARTWORK: Readonly<Record<ShopSeries, string>> = {
  ...EMBLEMS,
  aurora: auroraArtwork,
  tide: tideArtwork,
  sakura: sakuraArtwork,
  constellation: constellationArtwork,
  bamboo: bambooArtwork,
  gilded: gildedArtwork,
  ember: emberArtwork,
  lotus: lotusArtwork,
  frost: frostArtwork,
  dune: duneArtwork,
};

export function shopSeriesArtwork(series: ShopSeries, reducedMotion = false): string {
  return `${ARTWORK[series]}${reducedMotion ? '#still' : ''}`;
}

/** Only the animated collections add an emblem to equipped borders and titles. */
export function shopSeriesEmblem(series: ShopSeries, reducedMotion = false): string | null {
  const emblems: Readonly<Partial<Record<ShopSeries, string>>> = EMBLEMS;
  const emblem = emblems[series];
  return emblem ? `${emblem}${reducedMotion ? '#still' : ''}` : null;
}

/** Animated collections are the ones with an emblem; their art moves on equipped items. */
export function isAnimatedSeries(series: ShopSeries): boolean {
  return shopSeriesEmblem(series) !== null;
}
