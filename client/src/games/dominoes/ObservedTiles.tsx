import type { ReactNode } from 'react';
import type { DominoTile as Tile } from '@shared/games/dominoes/types';
import { dmSortHand } from '@shared/rules/dominoes';
import { useI18nStore } from '../../stores/i18n-store';
import { DominoTile } from './DominoTile';
import styles from './ObservedTiles.module.css';

/** Another seat's tiles shown face up in god view, small enough to sit under the seat plate. */
export function ObservedTiles({ tiles, owner }: { tiles: readonly Tile[]; owner: string }): ReactNode {
  const { t } = useI18nStore();
  return <div className={styles.row} role="group" aria-label={t('dominoes.observedTiles', { name: owner })}>
    {dmSortHand(tiles).map((tile) => <DominoTile key={`${tile[0]}-${tile[1]}`} left={tile[0]} right={tile[1]} />)}
  </div>;
}
