import type { ShopSeries } from '@shared/types';
import starfleetEmblem from './assets/shop/series-starfleet-emblem.svg';
import shrineEmblem from './assets/shop/series-shrine-emblem.svg';
import ironfrontEmblem from './assets/shop/series-ironfront-emblem.svg';
import neoncityEmblem from './assets/shop/series-neoncity-emblem.svg';
import crownrealmEmblem from './assets/shop/series-crownrealm-emblem.svg';

const EMBLEMS: Readonly<Record<ShopSeries, string>> = {
  starfleet: starfleetEmblem,
  shrine: shrineEmblem,
  ironfront: ironfrontEmblem,
  neoncity: neoncityEmblem,
  crownrealm: crownrealmEmblem,
};

export function shopSeriesEmblem(series: ShopSeries, reducedMotion = false): string {
  return `${EMBLEMS[series]}${reducedMotion ? '#still' : ''}`;
}
