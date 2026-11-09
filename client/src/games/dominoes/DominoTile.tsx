import type { CSSProperties, ReactNode } from 'react';
import type { DominoPip } from '@shared/games/dominoes/types';
import { diceThemeVars, useDiceTheme } from '../liarsdice/dice-theme';
import { useI18nStore } from '../../stores/i18n-store';
import styles from './DominoTile.module.css';

/** Which of the nine grid cells of one half carry a pip, row by row; blank halves carry none. */
const PIP_CELLS: Readonly<Record<DominoPip, readonly number[]>> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const CELLS = Array.from({ length: 9 }, (_, cell) => cell);

export type TileState = 'plain' | 'selected' | 'playable' | 'dim' | 'opening';

/** One half of a tile: a 3 × 3 pip grid. */
function Half({ value }: { value: DominoPip }): ReactNode {
  const pips = PIP_CELLS[value];
  return <span className={`${styles.half} ${value === 1 ? styles.one : ''}`}>
    {CELLS.map((cell) => <span key={cell} className={pips.includes(cell) ? styles.pip : styles.blank} />)}
  </span>;
}

/**
 * One domino drawn with HTML and CSS only, in the colours of the viewer's dice style. `left` and `right` are
 * the halves as they show: a horizontal tile reads left to right, a vertical one top to bottom. The size
 * comes from `--tile-s`, the edge of one half.
 */
export function DominoTile({ left, right, vertical = false, state = 'plain', hidden = false, className, style }: {
  left: DominoPip; right: DominoPip; vertical?: boolean; state?: TileState; hidden?: boolean;
  className?: string; style?: CSSProperties;
}): ReactNode {
  const { t } = useI18nStore();
  const theme = useDiceTheme();
  const label = t('dominoes.tileLabel', { a: String(Math.min(left, right)), b: String(Math.max(left, right)) });
  return <span className={[styles.tile, vertical && styles.vertical, hidden && styles.hidden,
    state !== 'plain' && styles[state], className].filter(Boolean).join(' ')}
    style={{ ...diceThemeVars(theme), ...style }} role="img" aria-label={label} title={label}>
    {hidden ? null : <>
      <Half value={left} />
      <span className={styles.divider} aria-hidden="true" />
      <Half value={right} />
    </>}
  </span>;
}
