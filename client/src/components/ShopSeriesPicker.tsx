import { useState } from 'react';
import type { ReactNode } from 'react';
import Drawer from '@mui/material/Drawer';
import Popover from '@mui/material/Popover';
import useMediaQuery from '@mui/material/useMediaQuery';
import { SHOP_SERIES } from '@shared/constants';
import type { ShopSeries } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { OTHER_SERIES, isCollectionFilter } from '../shop-filters';
import type { ShopSeriesCountKey, ShopSeriesFilter } from '../shop-filters';
import { isAnimatedSeries, shopSeriesArtwork } from '../shop-series';
import { AppIcon } from './AppIcon';
import { IconButton } from './IconButton';
import styles from './ShopSeriesPicker.module.css';

/** Phone landscape and narrow layouts slide the panel in from the right instead of floating it. */
const COMPACT_QUERY = '(max-width: 52rem), (max-height: 500px) and (min-width: 600px)';

const THEMED = SHOP_SERIES.filter((series) => !isAnimatedSeries(series));
const ANIMATED = SHOP_SERIES.filter(isAnimatedSeries);

interface ShopSeriesPickerProps {
  readonly series: ShopSeriesFilter;
  /** Products per collection in the current tab. */
  readonly counts: Readonly<Record<ShopSeriesCountKey, number>>;
  /** Name of the current tab, so the counts say what they count. */
  readonly tabLabel: string;
  readonly onSelect: (series: ShopSeriesFilter) => void;
}

/** Still artwork only: the menu shows fifteen thumbnails, and animated art would run all of them. */
function SeriesThumb({ series }: { readonly series: ShopSeries }): ReactNode {
  return <img className={styles.thumb} data-animated={isAnimatedSeries(series) || undefined}
    src={shopSeriesArtwork(series, true)} alt="" loading="lazy" decoding="async" />;
}

/** The "Series" button of the shop's tab row and the panel of collections it opens. */
export function ShopSeriesPicker({ series, counts, tabLabel, onSelect }: ShopSeriesPickerProps): ReactNode {
  const { t } = useI18nStore();
  const compact = useMediaQuery(COMPACT_QUERY, { noSsr: true });
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const selected = isCollectionFilter(series) ? series : null;
  const selectedName = selected === null ? null
    : t(selected === OTHER_SERIES ? 'shop.otherSeries.name' : `shop.series.${selected}.name`);
  const choose = (next: ShopSeriesFilter): void => {
    setOpen(false);
    onSelect(next);
  };

  const tile = (key: ShopSeriesFilter, name: string, thumb: ReactNode): ReactNode => {
    const count = counts[key as ShopSeriesCountKey];
    const active = key === 'all' ? selected === null : selected === key;
    return <button key={key} type="button" className={styles.tile} aria-pressed={active}
      data-empty={count === 0 || undefined} onClick={() => choose(key)}>
      {thumb}
      <span className={styles.tileText}>
        <span className={styles.tileName}>{name}</span>
        <span className={styles.tileCount}>{t('shop.seriesMenu.count', { n: String(count) })}</span>
      </span>
      {active && <span className={styles.tileCheck} aria-hidden="true"><AppIcon name="check" /></span>}
    </button>;
  };
  const seriesTile = (key: ShopSeries): ReactNode =>
    tile(key, t(`shop.series.${key}.name`), <SeriesThumb series={key} />);

  const panel = <div className={styles.panel} data-compact={compact || undefined}>
    <header className={styles.header}>
      <div>
        <h2 id="shop-series-title">{t('shop.seriesMenu.title')}</h2>
        <p>{t('shop.seriesMenu.hint', { tab: tabLabel })}</p>
      </div>
      <IconButton icon="close" label={t('shop.seriesMenu.close')} onClick={() => setOpen(false)} />
    </header>
    <div className={styles.body}>
      <div className={styles.lead}>
        {tile('all', t('shop.seriesMenu.all'), <span className={styles.allMark} aria-hidden="true"><AppIcon name="grid" /></span>)}
        {tile(OTHER_SERIES, t('shop.otherSeries.name'), <span className={styles.allMark} aria-hidden="true"><AppIcon name="shop" /></span>)}
      </div>
      <h3 className={styles.section}>{t('shop.seriesMenu.themed')}</h3>
      <div className={styles.grid}>{THEMED.map(seriesTile)}</div>
      <h3 className={styles.section}>{t('shop.seriesMenu.animated')}
        <span className={styles.sectionBadge}>{t('shop.seriesMenu.animatedBadge')}</span></h3>
      <div className={styles.grid}>{ANIMATED.map(seriesTile)}</div>
    </div>
  </div>;

  return <div className={styles.picker} ref={setAnchor}>
    <button type="button" className={styles.button} data-selected={selected !== null || undefined}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      {selected === null
        ? <span className={styles.allMark} aria-hidden="true"><AppIcon name="grid" /></span>
        : selected === OTHER_SERIES ? <span className={styles.allMark} aria-hidden="true"><AppIcon name="shop" /></span>
          : <SeriesThumb series={selected} />}
      <span className={styles.label}>
        {selected === null && <span className={styles.prefix}>{t('shop.seriesMenu.label')}</span>}
        <span className={styles.value}>{selectedName ?? t('shop.seriesAll')}</span>
      </span>
      {selected === null && <AppIcon name="expand" />}
    </button>
    {selected !== null && <IconButton icon="close" className={styles.clear}
      label={t('shop.seriesMenu.clearNamed', { name: selectedName ?? '' })} onClick={() => onSelect('all')} />}
    {compact
      ? <Drawer anchor="right" open={open} onClose={() => setOpen(false)}
        slotProps={{ paper: { className: styles.drawer, role: 'dialog', 'aria-labelledby': 'shop-series-title' } }}>{panel}</Drawer>
      : <Popover open={open} anchorEl={anchor} onClose={() => setOpen(false)} disableScrollLock
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { className: styles.popover, role: 'dialog', 'aria-labelledby': 'shop-series-title' } }}>{panel}</Popover>}
  </div>;
}
