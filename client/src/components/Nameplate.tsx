import type { ReactNode } from 'react';
import type { NameplateId } from '@shared/types';
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
};

/** Both shop cosmetics and exclusive earned titles share the same equipped presentation. */
export function Nameplate({ id }: NameplateProps): ReactNode {
  const { t } = useI18nStore();
  if (!id) return null;
  return <span data-nameplate={id} className={`${styles.title} ${styles[id]}`}>
    <span className={styles.mark} aria-hidden="true">{MARKS[id]}</span>
    {t(`shop.title.${id}`)}
  </span>;
}
