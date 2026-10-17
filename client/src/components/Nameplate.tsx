import type { ReactNode } from 'react';
import type { NameplateId } from '@shared/types';
import { SHOP_SERIES } from '@shared/constants';
import { shopSeriesEmblem } from '../shop-series';
import { useMotionStore } from '../stores/motion-store';
import { useI18nStore } from '../stores/i18n-store';
import styles from './Nameplate.module.css';

interface NameplateProps {
  readonly id: NameplateId | null | undefined;
}

const MARKS: Readonly<Record<NameplateId, string>> = {
  'nameplate-table-traveler': '♠',
  'nameplate-daily-collector': '✦',
  'nameplate-aurora': '✧',
  'nameplate-tide': '≈',
  'nameplate-sakura': '❀',
  'nameplate-muckborn': '💩',
  'nameplate-bark-lord': '🐾',
  'nameplate-renewal': '🌱',
  'nameplate-rainbow-pony': '🦄',
  'nameplate-planetary-devastation': '◉',
  'nameplate-einstein': '⚛',
  'nameplate-lucky': '🍀',
  'nameplate-starfleet': '✦',
  'nameplate-shrine': '⛩',
  'nameplate-ironfront': '✚',
  'nameplate-neoncity': '◇',
  'nameplate-crownrealm': '♛',
};

/** Both shop cosmetics and exclusive earned titles share the same equipped presentation. */
export function Nameplate({ id }: NameplateProps): ReactNode {
  const { t } = useI18nStore();
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  if (!id) return null;
  const series = SHOP_SERIES.find((key) => id === `nameplate-${key}`);
  return <span data-reduced-motion={reducedMotion || undefined} data-nameplate={id} className={`${styles.title} ${styles[id]}`}>
    <span className={styles.mark} aria-hidden="true">{series
      ? <img className={styles.seriesMark} src={shopSeriesEmblem(series, reducedMotion)} alt="" /> : MARKS[id]}</span>
    {t(`shop.title.${id}`)}
  </span>;
}
