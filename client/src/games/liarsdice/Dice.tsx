import type { CSSProperties, ReactNode } from 'react';
import type { DiceFace } from '@shared/types';
import { useStillArt } from '../../cosmetics/art-layers/art-layers';
import { useDiceTheme } from './dice-theme';
import styles from './Dice.module.css';

/** Which of the nine grid cells carry a pip, row by row. */
const PIP_CELLS: Readonly<Record<DiceFace, readonly number[]>> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const CELLS = Array.from({ length: 9 }, (_, cell) => cell);

export type DieState = 'plain' | 'match' | 'miss';

/**
 * One die drawn with HTML and CSS only. Colours come from the theme variables of the nearest container
 * (see `diceThemeVars`), and the size from `--die-size`.
 */
export function Die({ value, state = 'plain', label, className, style }: {
  value: DiceFace; state?: DieState; label?: string; className?: string; style?: CSSProperties;
}): ReactNode {
  const pips = PIP_CELLS[value];
  return <span className={[styles.die, value === 1 && styles.one, state === 'match' && styles.match,
    state === 'miss' && styles.miss, className].filter(Boolean).join(' ')}
    style={style} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
    {CELLS.map((cell) => <span key={cell} className={pips.includes(cell) ? styles.pip : styles.blank} />)}
  </span>;
}

/** A die whose face is not known to the viewer. */
export function HiddenDie({ className, style }: { className?: string; style?: CSSProperties }): ReactNode {
  return <span className={[styles.die, styles.hidden, className].filter(Boolean).join(' ')} style={style} aria-hidden="true" />;
}

/** A leather cup. `shaking` rattles it; `lifted` lifts it away to reveal what it covers. */
export function DiceCup({ mode = 'still', className, style, glow }: {
  mode?: 'still' | 'shaking' | 'lifted'; className?: string; style?: CSSProperties;
  /** Whether the cup's style animates; the viewer's equipped dice style by default. */
  glow?: boolean;
}): ReactNode {
  const theme = useDiceTheme();
  const still = useStillArt();
  const glowing = (glow ?? theme.cupGlow !== null) && !still;
  return <span className={[styles.cup, mode === 'shaking' && styles.shaking, mode === 'lifted' && styles.lifted,
    glowing && styles.glowing, className]
    .filter(Boolean).join(' ')} style={style} aria-hidden="true" />;
}
