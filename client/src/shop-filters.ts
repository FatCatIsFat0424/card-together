import type { ShopItemType, ShopSeries } from '@shared/types';

export const BORDER_SERIES = ['ears', 'metal', 'special'] as const;
export type ShopSeriesFilter = typeof BORDER_SERIES[number] | ShopSeries | 'all';

/** Preserve the visible category when a legacy series-only URL changes collection. */
export function shopSeriesQuery(
  current: URLSearchParams,
  selectedType: ShopItemType | 'all',
  series: ShopSeriesFilter,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (selectedType !== 'all') next.set('type', selectedType);
  if (BORDER_SERIES.some((legacy) => legacy === series)) next.set('type', 'avatarBorder');
  if (series === 'all') next.delete('series');
  else next.set('series', series);
  return next;
}
