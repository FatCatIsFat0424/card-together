import type { ReactNode } from 'react';
import type { DiceStyleId } from '@shared/types';
import { DiceCup, Die, HiddenDie } from '../../games/liarsdice/Dice';
import { diceThemeVars } from '../../games/liarsdice/dice-theme';
import type { PreviewAccount } from '../preview-props';
import { DICE_DESIGNS } from './dice-designs';
import styles from './DiceStylePreview.module.css';

/** A cup beside a roll that shows the wild one, a matched die, and a hidden die. */
export function DiceStylePreview({ id }: { readonly id: DiceStyleId; readonly account: PreviewAccount }): ReactNode {
  const theme = DICE_DESIGNS[id];
  return (
    <div className={styles.preview} style={diceThemeVars(theme)} aria-hidden="true" data-dice-style={id}>
      <DiceCup className={styles.cup} glow={theme.cupGlow !== null} />
      <span className={styles.dice}>
        <Die value={1} />
        <Die value={4} state="match" />
        <Die value={6} />
        <HiddenDie />
      </span>
    </div>
  );
}
