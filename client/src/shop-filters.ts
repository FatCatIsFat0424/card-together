import { SHOP_SERIES, shopItemSeries } from '@shared/constants';
import type { ShopItem, ShopItemType, ShopSeries } from '@shared/types';

export const BORDER_SERIES = ['ears', 'metal', 'special'] as const;
/** URL value for products that belong to no themed series. */
export const OTHER_SERIES = 'other';
export type ShopSeriesFilter = typeof BORDER_SERIES[number] | ShopSeries | typeof OTHER_SERIES | 'all';

/**
 * Top-level shop sections, in tab order. A group shows only while at least one of its types has
 * products, so adding a product type to `types` is all a new category needs.
 */
export const SHOP_GROUPS = [
  { id: 'personal', types: ['avatarBorder', 'nameplate', 'chatFrame', 'stickerPack'] },
  { id: 'table', types: ['tableBackground', 'seatBackground', 'seatFrame', 'victoryEffect', 'soundPack'] },
  { id: 'cards', types: ['cardBack', 'cardFace', 'chipStyle'] },
  { id: 'chess', types: ['pieceStyle', 'boardStyle'] },
  { id: 'dice', types: ['diceStyle'] },
] as const satisfies readonly { readonly id: string; readonly types: readonly ShopItemType[] }[];

export type ShopGroupId = typeof SHOP_GROUPS[number]['id'];
type ShopGroup = { readonly id: ShopGroupId; readonly types: readonly ShopItemType[] };

const GROUPS: readonly ShopGroup[] = SHOP_GROUPS;
const PRODUCT_TYPES: readonly ShopItemType[] = GROUPS.flatMap((group) => group.types);

export function shopGroupOf(type: ShopItemType): ShopGroupId | null {
  return GROUPS.find((group) => group.types.includes(type))?.id ?? null;
}

/** Product types that belong to no group would never be reachable in the shop. */
export function ungroupedShopTypes(items: readonly ShopItem[]): ShopItemType[] {
  return [...new Set(items.map((item) => item.type))].filter((type) => !PRODUCT_TYPES.includes(type));
}

export interface ShopView {
  /** Groups that currently have products, in tab order. */
  readonly groups: readonly ShopGroupId[];
  readonly group: ShopGroupId;
  /** Types of the selected group that have products. */
  readonly types: readonly ShopItemType[];
  readonly type: ShopItemType | 'all';
  readonly series: ShopSeriesFilter;
}

function inSeries(item: ShopItem, series: ShopSeriesFilter): boolean {
  if (series === OTHER_SERIES) return shopItemSeries(item) === null;
  return SHOP_SERIES.some((entry) => entry === series) ? shopItemSeries(item) === series : true;
}

/**
 * Resolves the URL's `group`, `type` and `series` into one consistent selection. Unknown values fall
 * back to the first group; a legacy border series implies the avatar border type, and is ignored
 * for any other type.
 */
export function resolveShopView(params: URLSearchParams, items: readonly ShopItem[]): ShopView {
  const present = new Set(items.map((item) => item.type));
  const groups = GROUPS.filter((group) => group.types.some((type) => present.has(type)));
  const seriesParam = params.get('series');
  const collection = SHOP_SERIES.find((series) => series === seriesParam);
  const border = collection ? undefined : BORDER_SERIES.find((series) => series === seriesParam);
  const requested = PRODUCT_TYPES.find((type) => type === params.get('type')) ?? (border ? 'avatarBorder' : undefined);
  const type = requested && present.has(requested) ? requested : 'all';
  const series: ShopSeriesFilter = collection ?? (type === 'avatarBorder' ? border : undefined)
    ?? (seriesParam === OTHER_SERIES ? OTHER_SERIES : 'all');
  const requestedGroup = type === 'all' ? groups.find((group) => group.id === params.get('group')) : undefined;
  const group = (type !== 'all' ? groups.find((entry) => entry.id === shopGroupOf(type)) : requestedGroup)
    ?? (series === 'all' ? undefined : groups.find((entry) => items.some((item) => entry.types.includes(item.type)
      && inSeries(item, series))))
    ?? groups[0];
  return { groups: groups.map((entry) => entry.id), group: group?.id ?? 'personal',
    types: (group?.types ?? []).filter((entry) => present.has(entry)), type, series };
}

/** Products of the selected group, kept in type order, narrowed by type and series. */
export function shopProducts(items: readonly ShopItem[], view: ShopView): ShopItem[] {
  const border = BORDER_SERIES.find((series) => series === view.series);
  return view.types.flatMap((type) => items.filter((item) => item.type === type
    && (view.type === 'all' || view.type === type)
    && inSeries(item, view.series)
    && (!border || item.type !== 'avatarBorder' || item.category === border)));
}

/** Chip count: products of one type (or the whole group) in the selected collection; legacy border filters do not apply. */
export function shopTypeCount(items: readonly ShopItem[], view: ShopView, type: ShopItemType | 'all'): number {
  const series = BORDER_SERIES.some((entry) => entry === view.series) ? 'all' : view.series;
  return shopProducts(items, { ...view, type, series }).length;
}

/**
 * Preserve the visible category when a legacy series-only URL changes collection. With every type
 * showing, `group` pins the tab, which would otherwise jump to the first group holding the series.
 */
export function shopSeriesQuery(
  current: URLSearchParams,
  selectedType: ShopItemType | 'all',
  series: ShopSeriesFilter,
  group?: ShopGroupId,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (selectedType !== 'all') next.set('type', selectedType);
  else if (group) next.set('group', group);
  if (BORDER_SERIES.some((legacy) => legacy === series)) next.set('type', 'avatarBorder');
  if (series === 'all') next.delete('series');
  else next.set('series', series);
  return next;
}

/** Switching group drops the type, which belongs to the previous group. */
export function shopGroupQuery(current: URLSearchParams, group: ShopGroupId): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete('type');
  next.set('group', group);
  if (BORDER_SERIES.some((legacy) => legacy === next.get('series'))) next.delete('series');
  return next;
}

/** A type chip keeps the group implicit; a legacy border series only applies to avatar borders. */
export function shopTypeQuery(current: URLSearchParams, type: ShopItemType | 'all', group: ShopGroupId): URLSearchParams {
  const next = new URLSearchParams(current);
  if (type === 'all') {
    next.delete('type');
    next.set('group', group);
  } else {
    next.set('type', type);
    next.delete('group');
  }
  if (BORDER_SERIES.some((legacy) => legacy === next.get('series'))) next.delete('series');
  return next;
}

/** Keys of `shopSeriesCounts`: every collection, the products without one, and the whole tab. */
export type ShopSeriesCountKey = ShopSeries | typeof OTHER_SERIES | 'all';

/**
 * Products per collection in the selected group and type. The collection filter itself does not
 * narrow the counts, so the series menu shows what each choice would list.
 */
export function shopSeriesCounts(items: readonly ShopItem[], view: ShopView): Readonly<Record<ShopSeriesCountKey, number>> {
  const counts = Object.fromEntries([...SHOP_SERIES, OTHER_SERIES, 'all'].map((key) => [key, 0])) as Record<ShopSeriesCountKey, number>;
  for (const item of shopProducts(items, { ...view, series: 'all' })) {
    counts.all += 1;
    counts[shopItemSeries(item) ?? OTHER_SERIES] += 1;
  }
  return counts;
}

/** Whether the selection is a themed collection or the products without one (not a legacy border category). */
export function isCollectionFilter(series: ShopSeriesFilter): series is ShopSeries | typeof OTHER_SERIES {
  return series === OTHER_SERIES || SHOP_SERIES.some((entry) => entry === series);
}
